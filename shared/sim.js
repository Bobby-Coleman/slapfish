// Slap Fish - shared game simulation.
// Runs authoritatively on the server for online play, and in the browser for solo/bot play.
// Pure logic: no rendering, no DOM. Works as a browser global (SlapSim) or a CommonJS module.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.SlapSim = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- tuning
  const CFG = {
    roundSeconds: 600, // timed mode length
    mode: 'rounds', // 'rounds': die and you're out until the next round; 'timed': most KOs, fast respawn
    winRounds: 5, // rounds mode: first to this many round wins takes the match
    roundCap: 100, // rounds mode: a round that runs this long goes to whoever has the most health
    roundBreak: 3, // seconds between rounds
    tickRate: 30,
    playerSpeed: 7.6,
    heavySpeed: 6.6,
    playerRadius: 0.55,
    maxHp: 100,
    healHp: 45, // Fish & Chips
    maxArmor: 50,
    respawnSeconds: 1.5, // timed mode
    spawnInvuln: 1.2,
    dashSpeed: 30,
    dashTime: 0.2, // about 6 units
    dashCharges: 2,
    dashRecharge: 1.2, // per charge
    dashIframes: 0.15, // can't be hit at the start of a dash
    waterDash: { up: 9, speed: 12 }, // dashing out of the water hops you onto anything close
    kbScale: 1.0, // global knockback tuning
    dmgScale: 1, // global damage tuning
    usesScale: 1, // global ammo tuning
    hurtScale: 120, // knockback grows as you lose health: kb * (1 + missingHp / hurtScale)
    launchUp: 0.45, // vertical share of a launch
    airThreshold: 6, // launches weaker than this just slide you along the ground
    gravity: 30,
    blastRadius: 40, // fly or swim past this ring and you're KO'd instantly
    waterY: -0.9,
    swimSpeed: 5,
    climbTime: 0.35,
    creditWindow: 8, // seconds a hit counts for KO credit
    rackRespawn: 4,
    fishMinBite: 0.5, // reel in any time after this and you always get something
    reelTime: 0.3,
    autoReel: 12,
    pierTipMult: 1.35,
    catchUpGap: 3,
    catchUpMult: 1.25,
    pelicanFirst: 25,
    pelicanEvery: 40,
    pelicanJitter: 10,
    groundFishLife: 20,
    biteWindow: 0.5, // reel while the bobber is pulled under for a perfect catch
    biteEvery: [1.5, 3], // seconds between bites
    perfectBonus: 1, // perfect catch: this many extra uses
  };

  const MAP = {
    coreHalf: 12,
    pierHalf: 3,
    pierLen: 28,
    tipStart: 21,
    rack: { x: 0, z: 0, r: 1.1, grab: 2.3 },
    obstacles: [
      { x: 7, z: 7, r: 0.85 }, { x: -7, z: 7, r: 0.85 }, { x: 7, z: -7, r: 0.85 }, { x: -7, z: -7, r: 0.85 },
      { x: 0, z: 17, r: 0.7 }, { x: 0, z: -17, r: 0.7 }, { x: 17, z: 0, r: 0.7 }, { x: -17, z: 0, r: 0.7 },
    ],
    spawns: [[-9, -9], [9, 9], [9, -9], [-9, 9], [0, -9.5], [0, 9.5], [-9.5, 0], [9.5, 0]],
  };

  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const RARITY_COLORS = { none: '#ffffff', common: '#cfd8dc', uncommon: '#5ee07a', rare: '#45a8ff', epic: '#c86bff', legendary: '#ffb22e' };

  // Depth tiers: the longer the line is in, the deeper it sinks. Weights are per rarity, in RARITIES order.
  const TIERS = [
    { id: 'shallow', name: 'Shallows', from: 0, w: [100, 0, 0, 0, 0] },
    { id: 'reef', name: 'Reef', from: 2, w: [50, 45, 5, 0, 0] },
    { id: 'deep', name: 'Deep', from: 4, w: [5, 35, 40, 18, 2] },
    { id: 'abyss', name: 'Abyss', from: 7, w: [0, 10, 35, 35, 20] },
  ];

  // Every fish is a weapon. Power budget (uses x damage, plus knockback and area) climbs with rarity.
  const WEAPONS = {
    // common: decent, never ring anyone out on their own
    boomerang: { name: 'Boomerang Mackerel', rarity: 'common', kind: 'boomerang', dmg: 28, kb: 6, cd: 0.5, uses: 3, speed: 24, reach: 12, rad: 0.55, desc: 'Throw it, it comes back. Hits going out and coming home.' },
    sardine: { name: 'Sardine Burst', rarity: 'common', kind: 'shot', dmg: 9, kb: 2.5, cd: 0.45, uses: 3, pellets: 4, spread: 0.13, speed: 34, life: 0.42, rad: 0.25, desc: 'Shotgun spray. Brutal up close.' },
    herring: { name: 'Herring Club', rarity: 'common', kind: 'melee', dmg: 32, kb: 7, cd: 0.45, uses: 3, range: 2.4, arc: 0.3, desc: 'A wide, meaty swing.' },
    // uncommon: tricks
    squid: { name: 'Squid Ink Blaster', rarity: 'uncommon', kind: 'shot', dmg: 12, kb: 2, cd: 0.4, uses: 3, pellets: 3, spread: 0.2, speed: 24, life: 0.55, rad: 0.35, slow: 1.5, splat: 2.5, desc: 'Ink spray. Splats their screen.' },
    icecod: { name: 'Ice Cod', rarity: 'uncommon', kind: 'lob', dmg: 15, kb: 2, cd: 0.6, uses: 2, maxRange: 12, aoe: 3, flight: 0.55, freeze: 1.1, desc: 'Freezes everyone in the splash solid.' },
    puffer: { name: 'Bouncy Puffer', rarity: 'uncommon', kind: 'lob', dmg: 42, kb: 8, cd: 0.7, uses: 2, maxRange: 11, aoe: 3, flight: 0.5, bounces: 2, desc: 'A grenade that bounces twice, then pops.' },
    eel: { name: 'Grapple Eel', rarity: 'uncommon', kind: 'zap', dmg: 20, kb: -9, cd: 0.5, uses: 2, range: 11, cone: 0.85, chain: 0, stun: 0.6, desc: 'Lashes the nearest enemy and yanks them to you.' },
    // rare: power moves
    ghost: { name: 'Ghost Flounder', rarity: 'rare', kind: 'phase', dmg: 40, kb: 12, cd: 0.35, uses: 3, speed: 34, time: 0.26, desc: 'Phase-dash through walls and people. Hurts what you pass through.' },
    swordfish: { name: 'Swordfish', rarity: 'rare', kind: 'melee', dmg: 60, kb: 16, cd: 0.6, uses: 2, range: 3.3, arc: 0.5, lunge: 22, desc: 'Huge lunge. Crosses gaps.' },
    angler: { name: 'Anglerfish', rarity: 'rare', kind: 'blind', dmg: 0, kb: 0, cd: 0.5, uses: 1, blind: 3.5, desc: 'Lights out for everyone but you.' },
    tuna: { name: 'Tuna Cannon', rarity: 'rare', kind: 'shot', dmg: 50, kb: 22, cd: 0.8, uses: 2, speed: 28, life: 0.9, rad: 0.8, desc: 'A cannonball fish. Massive knockback.' },
    // epic: ring-out machines
    mantis: { name: 'Mantis Shrimp', rarity: 'epic', kind: 'melee', dmg: 55, kb: 34, cd: 0.5, uses: 1, range: 2.6, arc: 0.4, desc: 'One punch. Sends them into next week.' },
    hammerhead: { name: 'Hammerhead', rarity: 'epic', kind: 'slam', dmg: 70, kb: 26, cd: 0.9, uses: 2, aoe: 2.8, reach: 1.8, heavy: true, desc: 'Ground slam. Heavy.' },
    // legendary: one-shots
    shark: { name: 'Shark Torpedo', rarity: 'legendary', kind: 'rocket', dmg: 100, kb: 30, cd: 1, uses: 1, speed: 16, life: 2.4, rad: 0.5, aoe: 3, homing: 3.2, desc: 'A homing torpedo. One-shot kill.' },
    narwhal: { name: 'Narwhal Railgun', rarity: 'legendary', kind: 'pierce', dmg: 100, kb: 24, cd: 1, uses: 1, speed: 80, life: 0.55, rad: 0.4, walls: true, desc: 'A lance through walls. One-shot kill.' },
    kraken: { name: 'Kraken Ink Storm', rarity: 'legendary', kind: 'storm', dmg: 0, kb: 0, cd: 1, uses: 1, time: 4, dps: 10, desc: 'Ink rains on everyone else: slow, blind, hurting.' },
  };
  const BY_RARITY = {};
  for (const id in WEAPONS) {
    const r = WEAPONS[id].rarity;
    (BY_RARITY[r] = BY_RARITY[r] || []).push(id);
  }

  // Gadget fish: a second slot next to your main fish. Q (or the GADGET button) uses one charge.
  // You can use gadgets while fishing, so they double as protection for your cast.
  const GADGETS = {
    flounder: { name: 'Flounder Mine', w: 22, charges: 2, desc: 'Lay it flat on the boards. Boom when someone steps on it.', dmg: 14, kb: 12, aoe: 2.2, arm: 1.0, life: 40, trigger: 1.3 },
    urchin: { name: 'Urchin Scatter', w: 20, charges: 2, desc: 'Throw a spray of spiky urchins that sting and slow.', dmg: 6, kb: 4, slow: 1.6, life: 20, spikes: 4, maxRange: 10, flight: 0.55, trigger: 0.8 },
    jelly: { name: 'Jellyfish Trap', w: 18, charges: 2, desc: 'Drop a jelly. Whoever touches it gets zapped and bounced.', dmg: 5, kb: 9, stun: 0.9, life: 30, trigger: 1.1, uses: 2 },
    ink: { name: 'Octopus Ink Bomb', w: 16, charges: 1, desc: 'An ink cloud that hides and slows everyone inside.', radius: 3.8, life: 6, maxRange: 12, flight: 0.6 },
    clam: { name: 'Giant Clam Wall', w: 12, charges: 1, desc: 'A clam that blocks shots and bodies. Great cover while fishing.', r: 1.25, life: 10 },
    grouper: { name: 'Grouper Turret', w: 12, charges: 1, desc: 'Plants a grouper that spits bombs at the nearest enemy.', life: 9, every: 1.4, range: 14, dmg: 10, kb: 8, aoe: 2.2, flight: 0.7 },
  };
  // chance that a catch also brings up a gadget, by depth tier
  const BYCATCH = { shallow: 0.2, reef: 0.3, deep: 0.4, abyss: 0.55 };

  // Pelican air drops.
  const DROPS = {
    heal: { name: 'Fish & Chips', w: 26, desc: '+45 health' },
    armor: { name: 'Crab Shell', w: 20, desc: '+50 armor' },
    bubble: { name: 'Bubble Bobber', w: 16, desc: 'Next fishing trip: 2 hits blocked' },
    lure: { name: 'Golden Lure', w: 12, desc: 'Next 2 casts sink twice as fast' },
    cooler: { name: 'Mystery Cooler', w: 12, desc: 'A random rare-or-better fish' },
    tackle: { name: 'Tackle Box', w: 14, desc: 'A random gadget fish with an extra charge' },
  };

  const COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#5ee07a', '#c86bff', '#ff9f43', '#2ee6d6', '#ff6bcb'];

  // ---------------------------------------------------------------- helpers
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function len(x, z) { return Math.sqrt(x * x + z * z); }
  function pickWeighted(weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  }
  function onPlatformPoint(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax <= MAP.coreHalf && az <= MAP.coreHalf) return true;
    if (ax <= MAP.pierHalf && az <= MAP.pierLen) return true;
    if (az <= MAP.pierHalf && ax <= MAP.pierLen) return true;
    return false;
  }
  function onPlatform(x, z, m) {
    if (!m) return onPlatformPoint(x, z);
    return onPlatformPoint(x + m, z) && onPlatformPoint(x - m, z) && onPlatformPoint(x, z + m) && onPlatformPoint(x, z - m);
  }
  function isPierTip(x, z) { return Math.abs(x) > MAP.tipStart || Math.abs(z) > MAP.tipStart; }
  function tierFor(depth) {
    let t = TIERS[0];
    for (const tier of TIERS) if (depth >= tier.from) t = tier;
    return t;
  }
  function randomPlatformPoint(preferPier) {
    for (let i = 0; i < 50; i++) {
      let x, z;
      if (preferPier) {
        const along = rand(MAP.coreHalf + 2, MAP.pierLen - 1.5) * (Math.random() < 0.5 ? -1 : 1);
        const across = rand(-MAP.pierHalf + 1, MAP.pierHalf - 1);
        if (Math.random() < 0.5) { x = along; z = across; } else { x = across; z = along; }
      } else {
        x = rand(-MAP.coreHalf + 1.5, MAP.coreHalf - 1.5);
        z = rand(-MAP.coreHalf + 1.5, MAP.coreHalf - 1.5);
      }
      if (!blockedByObstacle(x, z, 1.2) && len(x, z) > 3) return { x, z };
    }
    return { x: 5, z: 5 };
  }
  function blockedByObstacle(x, z, r) {
    for (const o of MAP.obstacles) if (len(x - o.x, z - o.z) < o.r + r) return true;
    if (len(x - MAP.rack.x, z - MAP.rack.z) < MAP.rack.r + r) return true;
    return false;
  }
  // Returns the outward water direction if the point is close enough to an edge to cast, else null.
  function waterDirection(x, z, aimX, aimZ) {
    let best = null, bestDot = -2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      if (!onPlatformPoint(x + dx * 1.7, z + dz * 1.7)) {
        const d = dx * aimX + dz * aimZ;
        if (d > bestDot) { bestDot = d; best = { x: dx, z: dz }; }
      }
    }
    return best;
  }


  // Barrels, the rod rack, and any giant clams currently deployed.
  function solidObstacles(S) {
    const list = MAP.obstacles.concat([MAP.rack]);
    if (S) for (const t of S.traps) if (t.kind === 'clam') list.push({ x: t.x, z: t.z, r: GADGETS.clam.r });
    return list;
  }

  // Closest point on the pier to (x, z), used for swimming back and climbing out.
  function nearestPlatformPoint(x, z) {
    const rects = [
      [-MAP.coreHalf, MAP.coreHalf, -MAP.coreHalf, MAP.coreHalf],
      [-MAP.pierHalf, MAP.pierHalf, -MAP.pierLen, MAP.pierLen],
      [-MAP.pierLen, MAP.pierLen, -MAP.pierHalf, MAP.pierHalf],
    ];
    let best = null, bd = 1e9;
    for (const [x0, x1, z0, z1] of rects) {
      const px = clamp(x, x0, x1), pz = clamp(z, z0, z1);
      const d = len(px - x, pz - z);
      if (d < bd) { bd = d; best = { x: px, z: pz }; }
    }
    return best;
  }

  // Plain walking step (no dash or knockback). Mirrors integrate() so online clients can predict their own movement.
  function walkStep(p, mx, mz, dt) {
    const C = CFG;
    const heavy = p.weapon && WEAPONS[p.weapon.id] && WEAPONS[p.weapon.id].heavy;
    let speed = heavy ? C.heavySpeed : C.playerSpeed;
    if (p.slowT > 0) speed *= 0.6;
    const ml = len(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const k = 1 - Math.exp(-14 * dt);
    p.vx += (mx * speed - p.vx) * k;
    p.vz += (mz * speed - p.vz) * k;
    const m = C.playerRadius * 0.7;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    const mm = onPlatform(p.x, p.z, m) ? m : 0.05;
    if (!onPlatform(nx, p.z, mm)) { nx = p.x; p.vx = 0; }
    if (!onPlatform(nx, nz, mm)) { nz = p.z; p.vz = 0; }
    for (const o of MAP.obstacles.concat([MAP.rack])) {
      const dx = nx - o.x, dz = nz - o.z, d = len(dx, dz), min = o.r + C.playerRadius;
      if (d < min && d > 0.0001) { nx = o.x + (dx / d) * min; nz = o.z + (dz / d) * min; }
    }
    p.x = nx; p.z = nz;
  }

  // Spots the bot likes to fish from.
  const FISH_SPOTS = [
    { x: 0, z: 27.2, tip: true }, { x: 0, z: -27.2, tip: true }, { x: 27.2, z: 0, tip: true }, { x: -27.2, z: 0, tip: true },
    { x: 11.4, z: 7.5 }, { x: 11.4, z: -7.5 }, { x: -11.4, z: 7.5 }, { x: -11.4, z: -7.5 },
    { x: 7.5, z: 11.4 }, { x: -7.5, z: 11.4 }, { x: 7.5, z: -11.4 }, { x: -7.5, z: -11.4 },
    { x: 2.4, z: 20 }, { x: -2.4, z: -20 }, { x: 20, z: -2.4 }, { x: -20, z: 2.4 },
  ];

  // ---------------------------------------------------------------- game
  function createGame(opts) {
    opts = opts || {};
    const g = {
      cfg: Object.assign({}, CFG, opts.cfg || {}),
      state: {
        phase: 'lobby', // lobby | play | over
        mode: (opts.cfg && opts.cfg.mode) || opts.mode || CFG.mode,
        round: 0, // rounds mode: current round number
        roundT: 0, // time into the current round
        breakT: 0, // rounds mode: countdown to the next round (0 = a round is running)
        roundWinner: null,
        time: 0,
        roundLeft: (opts.roundSeconds || CFG.roundSeconds),
        roundSeconds: (opts.roundSeconds || CFG.roundSeconds),
        players: {},
        projectiles: [],
        items: [], // ground pickups: rods, fish, drops
        traps: [], // placed gadgets: mines, spikes, jellies, ink clouds, clams, turrets
        pelicans: [],
        rack: [],
        winner: null,
        nextPelican: CFG.pelicanFirst,
      },
      inputs: {},
      events: [],
      nextId: 1,
    };
    const S = g.state;
    const C = g.cfg;
    S.roundLeft = S.roundSeconds;

    function emit(type, data) { g.events.push(Object.assign({ type, t: S.time }, data)); }
    function uid() { return g.nextId++; }

    function rackSize() { return Math.min(6, Math.max(3, Object.keys(S.players).length + 1)); }
    function syncRack() {
      const n = rackSize();
      while (S.rack.length < n) S.rack.push({ ready: true, t: 0 });
      while (S.rack.length > n) S.rack.pop();
    }

    g.addPlayer = function (id, name, isBot, difficulty) {
      const used = new Set(Object.values(S.players).map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
      const p = {
        id, name: (name || 'Angler').slice(0, 16), color, bot: !!isBot, difficulty: difficulty || 'normal',
        x: 0, z: 0, y: 0, vx: 0, vz: 0, ax: 1, az: 0,
        hp: CFG.maxHp, armor: 0, alive: false, dashN: CFG.dashCharges, dashRT: 0, dashIF: 0, roundWins: 0, respawnT: 0.5, invulnT: 0, vy: 0, air: false, swim: false, climbT: 0, cx: 0, cz: 0,
        hasRod: false, weapon: null, cd: 0, dashCd: 0, dashT: 0, kbT: 0, slowT: 0, stunT: 0, freezeT: 0, splatT: 0, blindT: 0, phaseT: 0, dotT: 0, dotBy: null, lastW: null, lastHitW: null,
        fishing: null, bubble: 0, lure: 0, gadget: null,
        kos: 0, deaths: 0, caught: 0, lastHitBy: null, lastHitT: -99, swingT: 0,
        brain: isBot ? { spot: null, target: 0, stuckT: 0, lastX: 0, lastZ: 0, think: 0, strafe: 1, aimErr: 0 } : null,
      };
      S.players[id] = p;
      g.inputs[id] = { mx: 0, mz: 0, ax: 1, az: 0, fire: false, dash: false, fish: false, use: false, gadget: false };
      syncRack();
      return p;
    };
    g.removePlayer = function (id) {
      delete S.players[id];
      delete g.inputs[id];
      syncRack();
    };
    g.setInput = function (id, inp) {
      const cur = g.inputs[id];
      if (!cur) return;
      cur.mx = clamp(+inp.mx || 0, -1, 1);
      cur.mz = clamp(+inp.mz || 0, -1, 1);
      const al = len(+inp.ax || 0, +inp.az || 0);
      if (al > 0.001) { cur.ax = inp.ax / al; cur.az = inp.az / al; }
      cur.aimDist = clamp(+inp.aimDist || 8, 0, 40);
      cur.fire = !!inp.fire;
      if (inp.seq != null) cur.seq = inp.seq;
      // edge-triggered buttons latch until the sim consumes them
      cur.dash = cur.dash || !!inp.dash;
      cur.fish = cur.fish || !!inp.fish;
      cur.use = cur.use || !!inp.use;
      cur.gadget = cur.gadget || !!inp.gadget;
    };
    g.start = function () {
      S.phase = 'play';
      S.time = 0;
      S.roundLeft = S.roundSeconds;
      S.projectiles = [];
      S.traps = [];
      S.items = [];
      S.pelicans = [];
      S.winner = null;
      S.nextPelican = C.pelicanFirst;
      syncRack();
      for (const r of S.rack) { r.ready = true; r.t = 0; }
      let i = 0;
      for (const p of Object.values(S.players)) {
        Object.assign(p, { kos: 0, deaths: 0, caught: 0, roundWins: 0, alive: false, respawnT: 0.2 + i * 0.05, weapon: null, hasRod: false, fishing: null, armor: 0, bubble: 0, lure: 0, gadget: null });
        i++;
      }
      S.round = 0;
      S.roundWinner = null;
      emit('start', { mode: S.mode });
      if (S.mode === 'rounds') startRound();
    };

    // rounds mode: wipe the pier and drop everyone back in at full health
    function startRound() {
      S.round++;
      S.roundT = 0;
      S.breakT = 0;
      S.roundWinner = null;
      S.projectiles = [];
      S.traps = [];
      S.items = [];
      S.pelicans = [];
      S.nextPelican = 18;
      for (const r of S.rack) { r.ready = true; r.t = 0; }
      for (const p of Object.values(S.players)) {
        Object.assign(p, { alive: false, weapon: null, hasRod: false, fishing: null, armor: 0, bubble: 0, lure: 0, gadget: null });
      }
      for (const p of Object.values(S.players)) spawnPlayer(p);
      emit('round', { n: S.round });
    }

    function endRound(winner) {
      S.breakT = C.roundBreak;
      S.roundWinner = winner ? winner.id : null;
      if (winner) winner.roundWins++;
      emit('roundover', { n: S.round, winner: S.roundWinner });
      if (winner && winner.roundWins >= C.winRounds) {
        S.phase = 'over';
        S.winner = winner.id;
        emit('over', { winner: S.winner });
      }
    }

    function spawnPlayer(p) {
      const others = Object.values(S.players).filter((o) => o !== p && o.alive);
      let best = MAP.spawns[0], bestD = -1;
      for (const s of MAP.spawns) {
        let d = 999;
        for (const o of others) d = Math.min(d, len(o.x - s[0], o.z - s[1]));
        d += Math.random() * 3;
        if (d > bestD) { bestD = d; best = s; }
      }
      Object.assign(p, {
        x: best[0], z: best[1], y: 0, vx: 0, vz: 0, vy: 0, hp: C.maxHp, dashN: C.dashCharges, dashRT: 0, dashIF: 0, alive: true, air: false, swim: false, climbT: 0,
        invulnT: C.spawnInvuln, kbT: 0, slowT: 0, stunT: 0, freezeT: 0, splatT: 0, blindT: 0, phaseT: 0, dotT: 0, lastHitW: null, fishing: null, dashT: 0, cd: 0, lastHitBy: null,
      });
      const l = len(-p.x, -p.z) || 1;
      p.ax = -p.x / l; p.az = -p.z / l;
      emit('spawn', { id: p.id });
    }

    function leaderKos() {
      let m = 0;
      for (const p of Object.values(S.players)) m = Math.max(m, S.mode === 'rounds' ? p.roundWins : p.kos);
      return m;
    }

    function kill(p, cause) {
      if (!p.alive) return;
      const credit = p.lastHitBy && S.time - p.lastHitT <= C.creditWindow && S.players[p.lastHitBy] ? S.players[p.lastHitBy] : null;
      if (credit && credit !== p) credit.kos++;
      p.deaths++;
      p.alive = false;
      p.hp = 0;
      // rounds mode: you're out until the next round
      p.respawnT = S.mode === 'rounds' ? Infinity : C.respawnSeconds;
      // whatever you were carrying is lost at sea
      p.gadget = null;
      p.weapon = null;
      p.hasRod = false;
      p.fishing = null;
      p.armor = 0;
      emit('ko', { id: p.id, by: credit ? credit.id : null, cause, w: credit ? p.lastHitW : null, x: p.x, z: p.z });
    }

    function hit(t, attacker, dmg, dirx, dirz, kb, extra) {
      if (!t.alive || t.invulnT > 0) return false;
      if (attacker && attacker.id === t.id) return false;
      if (t.dashIF > 0) { emit('dodge', { id: t.id, x: t.x, z: t.z }); return false; }
      if (t.fishing && t.bubble > 0) {
        t.bubble--;
        emit('bubble', { id: t.id, left: t.bubble });
        return true;
      }
      if (t.fishing) {
        t.fishing = null;
        emit('snap', { id: t.id });
      }
      dmg *= C.dmgScale;
      const absorbed = Math.min(t.armor, dmg);
      t.armor -= absorbed;
      dmg -= absorbed;
      t.hp -= dmg;
      // the less health you have left, the harder you fly
      const power = kb * C.kbScale * (1 + (C.maxHp - Math.max(0, t.hp)) / C.hurtScale) * (t.armor > 0 ? 0.8 : 1);
      const l = len(dirx, dirz) || 1;
      const dx = dirx / l, dz = dirz / l;
      if (t.climbT > 0) { t.climbT = 0; t.swim = true; t.y = C.waterY; }
      if (kb < 0) {
        t.vx = dx * power * 1.6; t.vz = dz * power * 1.6;
        t.kbT = Math.max(t.kbT, 0.3);
      } else if (t.swim) {
        t.vx += dx * power * 0.6; t.vz += dz * power * 0.6;
        t.kbT = Math.max(t.kbT, 0.35);
      } else if (power > C.airThreshold) {
        t.vx = dx * power; t.vz = dz * power;
        t.vy = power * C.launchUp + 2;
        t.y = Math.max(t.y, 0.01);
        t.air = true;
        t.kbT = Math.max(t.kbT, 0.15 + power * 0.015);
        if (t.fishing) t.fishing = null;
        emit('launch', { id: t.id, power: Math.round(power) });
      } else {
        t.vx += dx * power; t.vz += dz * power;
        t.kbT = Math.max(t.kbT, 0.12 + power * 0.012);
      }
      if (extra && extra.slow) t.slowT = Math.max(t.slowT, extra.slow);
      if (extra && extra.stun) t.stunT = Math.max(t.stunT, extra.stun);
      if (extra && extra.freeze) { t.stunT = Math.max(t.stunT, extra.freeze); t.freezeT = Math.max(t.freezeT, extra.freeze); t.vx *= 0.2; t.vz *= 0.2; }
      if (extra && extra.splat) t.splatT = Math.max(t.splatT, extra.splat);
      if (attacker) { t.lastHitBy = attacker.id; t.lastHitT = S.time; t.lastHitW = (extra && extra.w) || attacker.lastW; }
      emit('hit', { id: t.id, by: attacker ? attacker.id : null, dmg: Math.round(dmg + absorbed), armor: absorbed > 0, x: t.x, z: t.z, y: t.y, hp: Math.max(0, Math.round(t.hp)) });
      if (t.hp <= 0) kill(t, 'hp');
      return true;
    }

    function explode(owner, x, z, w, wid) {
      emit('boom', { x, z, r: w.aoe, ice: !!w.freeze });
      for (const t of Object.values(S.players)) {
        if (t === owner) continue;
        const d = len(t.x - x, t.z - z);
        if (d < w.aoe + C.playerRadius) {
          const f = 1 - 0.5 * clamp(d / w.aoe, 0, 1);
          hit(t, owner, w.dmg * f, t.x - x + 0.001, t.z - z, w.kb * f, { freeze: w.freeze, w: wid });
        }
      }
    }

    function useWeapon(p, inp) {
      if (!p.weapon) {
        // no slapping: you have to fish for a weapon
        if (p.cd <= 0) { p.cd = 0.8; emit('noweapon', { id: p.id }); }
        return;
      }
      const wid = p.weapon.id;
      const w = WEAPONS[wid];
      p.cd = w.cd;
      p.swingT = 0.2;
      p.lastW = wid;
      const ax = p.ax, az = p.az;
      const X = { w: wid };
      emit('fire', { id: p.id, w: wid, x: p.x, z: p.z, ax, az });
      if (w.kind === 'melee' || w.kind === 'slam') {
        if (w.lunge) { p.dashT = 0.14; p.vx = ax * w.lunge; p.vz = az * w.lunge; }
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive || Math.abs(t.y - p.y) > 2) continue;
          if (w.kind === 'slam') {
            const cx = p.x + ax * w.reach, cz = p.z + az * w.reach;
            if (len(t.x - cx, t.z - cz) < w.aoe + C.playerRadius) hit(t, p, w.dmg, t.x - p.x, t.z - p.z, w.kb, X);
          } else {
            const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz);
            if (d < w.range + C.playerRadius && (d < 0.6 || (dx * ax + dz * az) / d >= w.arc)) hit(t, p, w.dmg, dx, dz, w.kb, X);
          }
        }
        if (w.kind === 'slam') emit('boom', { x: p.x + ax * w.reach, z: p.z + az * w.reach, r: w.aoe, slam: true });
      } else if (w.kind === 'shot' || w.kind === 'rocket' || w.kind === 'pierce') {
        const n = w.pellets || 1;
        for (let i = 0; i < n; i++) {
          const a = n > 1 ? (i - (n - 1) / 2) * w.spread + rand(-0.04, 0.04) : 0;
          const ca = Math.cos(a), sa = Math.sin(a);
          const dx = ax * ca - az * sa, dz = ax * sa + az * ca;
          S.projectiles.push({ id: uid(), w: wid, owner: p.id, x: p.x + dx * 0.8, z: p.z + dz * 0.8, vx: dx * w.speed, vz: dz * w.speed, life: w.life, rad: w.rad, hitIds: [] });
        }
      } else if (w.kind === 'boomerang') {
        S.projectiles.push({ id: uid(), w: wid, owner: p.id, x: p.x + ax * 0.8, z: p.z + az * 0.8, vx: ax * w.speed, vz: az * w.speed, out: w.reach, back: false, life: 3, rad: w.rad, spin: true, hitIds: [] });
      } else if (w.kind === 'lob') {
        const dist = clamp(inp.aimDist || 8, 2, w.maxRange);
        S.projectiles.push({ id: uid(), w: wid, owner: p.id, x: p.x, z: p.z, sx: p.x, sz: p.z, tx: p.x + ax * dist, tz: p.z + az * dist, flight: w.flight, life: w.flight, lob: true, rad: 0.4, bounces: w.bounces || 0, hitIds: [] });
      } else if (w.kind === 'phase') {
        // ghost dash: through walls and people, hurting everyone you pass through
        p.phaseT = w.time; p.dashT = w.time; p.dashIF = w.time;
        p.vx = ax * w.speed; p.vz = az * w.speed;
        p.phaseHit = [];
      } else if (w.kind === 'blind') {
        for (const t of Object.values(S.players)) if (t !== p && t.alive) { t.blindT = w.blind; t.lastHitBy = p.id; t.lastHitT = S.time; t.lastHitW = wid; }
        emit('blind', { id: p.id, x: p.x, z: p.z, t: w.blind });
      } else if (w.kind === 'storm') {
        for (const t of Object.values(S.players)) if (t !== p && t.alive) { t.dotT = w.time; t.dotBy = p.id; t.slowT = Math.max(t.slowT, w.time); t.splatT = Math.max(t.splatT, w.time); }
        emit('storm', { id: p.id, t: w.time });
      } else if (w.kind === 'zap') {
        let first = null, bestD = 999;
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive) continue;
          const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz);
          if (d < w.range && (dx * ax + dz * az) / d > w.cone && d < bestD) { bestD = d; first = t; }
        }
        const chain = [];
        if (first) {
          chain.push(first);
          if (w.chain) {
          let second = null; bestD = 999;
          for (const t of Object.values(S.players)) {
            if (t === p || t === first || !t.alive) continue;
            const d = len(t.x - first.x, t.z - first.z);
            if (d < w.chain && d < bestD) { bestD = d; second = t; }
          }
          if (second) chain.push(second);
          }
        }
        const pts = [{ x: p.x, z: p.z }];
        if (chain.length) {
          for (const t of chain) { pts.push({ x: t.x, z: t.z }); hit(t, p, w.dmg, t.x - p.x, t.z - p.z, w.kb, { stun: w.stun, w: wid }); }
        } else {
          pts.push({ x: p.x + ax * w.range * 0.6, z: p.z + az * w.range * 0.6 });
        }
        emit('zap', { pts });
      }
      if (p.weapon) {
        p.weapon.uses--;
        if (p.weapon.uses <= 0) { emit('empty', { id: p.id, w: wid }); p.weapon = null; }
      }
    }

    function rollFish(p, depth) {
      const tier = tierFor(depth);
      const ri = pickWeighted(tier.w);
      const list = BY_RARITY[RARITIES[ri]];
      const wid = list[Math.floor(Math.random() * list.length)];
      return { wid, tier: tier.id };
    }

    function randomGadget() {
      const keys = Object.keys(GADGETS);
      return keys[pickWeighted(keys.map((k) => GADGETS[k].w))];
    }
    function giveGadget(p, gid, extra) {
      const gd = GADGETS[gid];
      if (p.gadget && p.gadget.id === gid) p.gadget.n = Math.min(3, p.gadget.n + gd.charges + extra);
      else p.gadget = { id: gid, n: gd.charges + extra };
      emit('gadget', { id: p.id, g: gid, n: p.gadget.n });
    }

    function giveWeapon(p, wid, uses) {
      p.weapon = { id: wid, uses: uses != null ? uses : Math.max(1, Math.round(WEAPONS[wid].uses * C.usesScale)) };
      p.cd = Math.min(p.cd, 0.2);
    }

    function tryPickups(p, inp) {
      // Rods from the central rack
      if (!p.hasRod && len(p.x - MAP.rack.x, p.z - MAP.rack.z) < MAP.rack.grab) {
        const slot = S.rack.find((r) => r.ready);
        if (slot) { slot.ready = false; slot.t = C.rackRespawn; p.hasRod = true; emit('rod', { id: p.id }); }
      }
      for (let i = S.items.length - 1; i >= 0; i--) {
        const it = S.items[i];
        if (it.y > 0.05) continue;
        const d = len(p.x - it.x, p.z - it.z);
        if (d > 1.4) continue;
        let take = false;
        if (it.kind === 'rod') { if (!p.hasRod) { p.hasRod = true; take = true; } }
        else if (it.kind === 'fish') {
          if (!p.weapon || inp.use) { if (p.weapon && p.weapon.uses > 0) S.items.push({ id: uid(), kind: 'fish', weapon: p.weapon.id, uses: p.weapon.uses, x: p.x, z: p.z, life: C.groundFishLife }); giveWeapon(p, it.weapon, it.uses); take = true; inp.use = false; }
        } else if (it.kind === 'heal') { if (p.hp < C.maxHp) { p.hp = Math.min(C.maxHp, p.hp + C.healHp); take = true; } }
        else if (it.kind === 'armor') { if (p.armor < C.maxArmor) { p.armor = C.maxArmor; take = true; } }
        else if (it.kind === 'bubble') { p.bubble = 2; take = true; }
        else if (it.kind === 'lure') { p.lure = 2; take = true; }
        else if (it.kind === 'tackle') { giveGadget(p, randomGadget(), 1); take = true; }
        else if (it.kind === 'cooler') {
          const ri = 2 + pickWeighted([60, 30, 10]);
          const list = BY_RARITY[RARITIES[ri]];
          if (p.weapon && p.weapon.uses > 0) S.items.push({ id: uid(), kind: 'fish', weapon: p.weapon.id, uses: p.weapon.uses, x: p.x, z: p.z, life: C.groundFishLife });
          giveWeapon(p, list[Math.floor(Math.random() * list.length)]);
          take = true;
        }
        if (take) {
          S.items.splice(i, 1);
          emit('pickup', { id: p.id, kind: it.kind, w: p.weapon ? p.weapon.id : null });
        }
      }
    }

    function stepPlayer(p, inp, dt) {
      if (!p.alive) {
        if (S.phase === 'play') {
          p.respawnT -= dt;
          if (p.respawnT <= 0) spawnPlayer(p);
        }
        return;
      }
      if (p.climbT > 0) {
        p.climbT = Math.max(0, p.climbT - dt);
        p.invulnT = Math.max(0, p.invulnT - dt);
        p.y = C.waterY * Math.max(0, p.climbT / C.climbTime);
        if (p.climbT === 0) {
          p.x = p.cx; p.z = p.cz; p.y = 0; p.vx = p.vz = p.vy = 0; p.swim = false; p.air = false;
          emit('climbed', { id: p.id });
        }
        return;
      }
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.cd = Math.max(0, p.cd - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);
      p.dashIF = Math.max(0, p.dashIF - dt);
      if (p.dashN < C.dashCharges) {
        p.dashRT += dt;
        if (p.dashRT >= C.dashRecharge) { p.dashRT = 0; p.dashN++; }
      } else p.dashRT = 0;
      p.slowT = Math.max(0, p.slowT - dt);
      p.stunT = Math.max(0, p.stunT - dt);
      p.freezeT = Math.max(0, p.freezeT - dt);
      p.splatT = Math.max(0, p.splatT - dt);
      p.blindT = Math.max(0, p.blindT - dt);
      if (p.dotT > 0) {
        // kraken ink storm: a little damage every tick
        p.dotT -= dt;
        const by = S.players[p.dotBy];
        p.hp -= WEAPONS.kraken.dps * dt;
        if (by) { p.lastHitBy = by.id; p.lastHitT = S.time; p.lastHitW = 'kraken'; }
        if (p.hp <= 0) { kill(p, 'hp'); return; }
      }
      if (p.phaseT > 0) {
        p.phaseT -= dt;
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive || p.phaseHit.includes(t.id) || len(t.x - p.x, t.z - p.z) > 1.3) continue;
          p.phaseHit.push(t.id);
          hit(t, p, WEAPONS.ghost.dmg, t.x - p.x + p.vx * 0.05, t.z - p.z + p.vz * 0.05, WEAPONS.ghost.kb, { w: 'ghost' });
        }
      }
      p.kbT = Math.max(0, p.kbT - dt);
      p.dashT = Math.max(0, p.dashT - dt);
      p.swingT = Math.max(0, p.swingT - dt);

      const stunned = p.stunT > 0;
      if (!stunned && (inp.ax || inp.az)) { p.ax = inp.ax; p.az = inp.az; }

      // in the water you can only swim back; in the air you can still attack once out of hitstun
      if (p.swim || p.air) {
        if (p.swim && inp.dash && !stunned && p.kbT <= 0) { inp.dash = false; waterDash(p, inp); }
        inp.fish = false; inp.dash = false; inp.use = false; inp.gadget = false;
        if (p.air && inp.fire && p.cd <= 0 && p.kbT <= 0 && !stunned) useWeapon(p, inp);
        integrate(p, dt, stunned ? 0 : inp.mx, stunned ? 0 : inp.mz);
        checkBlast(p);
        return;
      }

      if (inp.gadget) { inp.gadget = false; if (!stunned) useGadget(p, inp); }

      // ---- fishing
      if (p.fishing) {
        const f = p.fishing;
        p.vx *= Math.exp(-10 * dt); p.vz *= Math.exp(-10 * dt);
        if (f.reelT > 0) {
          f.reelT -= dt;
          if (f.reelT <= 0) {
            const r = rollFish(p, f.depth);
            if (p.weapon && p.weapon.uses > 0 && p.weapon.id !== r.wid) {
              // the old fish flops onto the pier so it isn't simply lost
              S.items.push({ id: uid(), kind: 'fish', weapon: p.weapon.id, uses: p.weapon.uses, x: p.x - f.dx * 1.2, z: p.z - f.dz * 1.2, life: C.groundFishLife });
            }
            giveWeapon(p, r.wid, f.perfect ? Math.max(1, Math.round(WEAPONS[r.wid].uses * C.usesScale)) + C.perfectBonus : null);
            p.caught++;
            p.fishing = null;
            emit('catch', { id: p.id, w: r.wid, rarity: WEAPONS[r.wid].rarity, tier: r.tier, depth: f.depth, perfect: f.perfect });
            if (Math.random() < BYCATCH[r.tier]) giveGadget(p, randomGadget(), 0);
          }
        } else {
          f.biteT = Math.max(0, f.biteT - dt);
          if (f.depth >= C.fishMinBite) {
            f.biteIn -= dt;
            if (f.biteIn <= 0) { f.biteT = C.biteWindow; f.biteIn = rand(C.biteEvery[0], C.biteEvery[1]); emit('bite', { id: p.id, x: f.bx, z: f.bz }); }
          }
          const prevTier = tierFor(f.depth).id;
          f.depth += dt * f.mult;
          const nt = tierFor(f.depth).id;
          if (nt !== prevTier) emit('tier', { id: p.id, tier: nt });
          if (inp.fish) {
            inp.fish = false;
            if (f.depth < C.fishMinBite) { p.fishing = null; emit('cancel', { id: p.id }); }
            else { f.perfect = f.biteT > 0; f.reelT = C.reelTime; emit('reel', { id: p.id, perfect: f.perfect }); }
          } else if (f.depth >= C.autoReel) {
            f.reelT = C.reelTime; emit('reel', { id: p.id });
          }
          if (inp.dash) { inp.dash = false; p.fishing = null; emit('cancel', { id: p.id }); doDash(p, inp); }
        }
        integrate(p, dt, 0, 0);
        return;
      }

      if (inp.fish) {
        inp.fish = false;
        if (p.hasRod && !stunned) {
          const dir = waterDirection(p.x, p.z, p.ax, p.az);
          if (dir) {
            let mult = isPierTip(p.x, p.z) ? C.pierTipMult : 1;
            if (p.lure > 0) { mult *= 2; p.lure--; }
            if (p.kos <= leaderKos() - C.catchUpGap) mult *= C.catchUpMult;
            p.fishing = { depth: 0, mult, dx: dir.x, dz: dir.z, bx: p.x + dir.x * 5, bz: p.z + dir.z * 5, reelT: 0, tip: isPierTip(p.x, p.z), biteIn: C.fishMinBite + rand(0.3, 1.2), biteT: 0, perfect: false };
            p.ax = dir.x; p.az = dir.z;
            emit('cast', { id: p.id, x: p.fishing.bx, z: p.fishing.bz, mult });
            integrate(p, dt, 0, 0);
            return;
          } else emit('noedge', { id: p.id });
        } else if (!p.hasRod) emit('norod', { id: p.id });
      }

      if (inp.dash) { inp.dash = false; if (!stunned) doDash(p, inp); }
      if (inp.fire && p.cd <= 0 && !stunned && p.dashT <= 0) useWeapon(p, inp);
      tryPickups(p, inp);
      inp.use = false;

      let mx = stunned ? 0 : inp.mx, mz = stunned ? 0 : inp.mz;
      const ml = len(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      integrate(p, dt, mx, mz);
      checkBlast(p);
    }

    function useGadget(p, inp) {
      if (!p.gadget) return;
      const gid = p.gadget.id, gd = GADGETS[gid];
      const ax = p.ax, az = p.az;
      const ahead = (d) => {
        let x = p.x + ax * d, z = p.z + az * d;
        for (let i = 0; i < 10 && !onPlatform(x, z, 0.5); i++) { x = p.x + (x - p.x) * 0.7; z = p.z + (z - p.z) * 0.7; }
        return { x, z };
      };
      const add = (t) => { t.id = uid(); t.owner = p.id; t.kind = t.kind || gid; S.traps.push(t); return t; };
      if (gid === 'flounder') {
        // laid right behind you, so it guards your back while you fish
        const pt = ahead(-1.1);
        const mine = S.traps.filter((t) => t.kind === 'flounder' && t.owner === p.id);
        if (mine.length >= 3) S.traps.splice(S.traps.indexOf(mine[0]), 1);
        add({ x: pt.x, z: pt.z, life: gd.life, arm: gd.arm, rot: Math.atan2(ax, az) });
      } else if (gid === 'jelly') {
        const pt = ahead(1.6);
        add({ x: pt.x, z: pt.z, life: gd.life, arm: 0.4, uses: gd.uses });
      } else if (gid === 'clam') {
        const pt = ahead(1.9);
        add({ x: pt.x, z: pt.z, life: gd.life, rot: Math.atan2(ax, az) });
      } else if (gid === 'grouper') {
        const pt = ahead(1.4);
        add({ x: pt.x, z: pt.z, life: gd.life, cd: 0.6, rot: Math.atan2(ax, az) });
      } else if (gid === 'urchin' || gid === 'ink') {
        const dist = clamp(inp.aimDist || 8, 2, gd.maxRange);
        S.projectiles.push({ id: uid(), w: gid, gadget: true, owner: p.id, x: p.x, z: p.z, sx: p.x, sz: p.z, tx: p.x + ax * dist, tz: p.z + az * dist, flight: gd.flight, life: gd.flight, lob: true, rad: 0.4, hitIds: [] });
      }
      emit('usegadget', { id: p.id, g: gid, x: p.x, z: p.z });
      p.gadget.n--;
      if (p.gadget.n <= 0) p.gadget = null;
    }

    function stepTraps(dt) {
      const players = Object.values(S.players);
      for (let i = S.traps.length - 1; i >= 0; i--) {
        const t = S.traps[i];
        const owner = S.players[t.owner];
        t.life -= dt;
        if (t.arm > 0) t.arm -= dt;
        let gone = t.life <= 0;
        const victims = (r) => players.filter((q) => q.alive && q.id !== t.owner && !q.air && q.climbT <= 0 && len(q.x - t.x, q.z - t.z) < r);
        if (t.kind === 'flounder' && !(t.arm > 0)) {
          const v = victims(GADGETS.flounder.trigger);
          if (v.length) {
            gone = true;
            const gd = GADGETS.flounder;
            emit('boom', { x: t.x, z: t.z, r: gd.aoe, mine: true });
            for (const q of players) {
              if (!q.alive || q.id === t.owner) continue;
              const d = len(q.x - t.x, q.z - t.z);
              if (d < gd.aoe + C.playerRadius) hit(q, owner, gd.dmg, q.x - t.x + 0.001, q.z - t.z, gd.kb, { w: 'flounder' });
            }
          }
        } else if (t.kind === 'spike') {
          const v = victims(GADGETS.urchin.trigger);
          if (v.length) {
            const gd = GADGETS.urchin;
            hit(v[0], owner, gd.dmg, v[0].vx || 0.01, v[0].vz || 0.01, gd.kb, { slow: gd.slow, w: 'urchin' });
            emit('spike', { x: t.x, z: t.z });
            gone = true;
          }
        } else if (t.kind === 'jelly' && !(t.arm > 0)) {
          const v = victims(GADGETS.jelly.trigger);
          if (v.length) {
            const gd = GADGETS.jelly;
            for (const q of v) hit(q, owner, gd.dmg, q.x - t.x + 0.001, q.z - t.z, gd.kb, { stun: gd.stun, w: 'jelly' });
            emit('zapjelly', { x: t.x, z: t.z });
            t.uses--; t.arm = 0.8;
            if (t.uses <= 0) gone = true;
          }
        } else if (t.kind === 'ink') {
          for (const q of players) if (q.alive && len(q.x - t.x, q.z - t.z) < GADGETS.ink.radius) q.slowT = Math.max(q.slowT, 0.3);
        } else if (t.kind === 'grouper') {
          t.cd -= dt;
          if (t.cd <= 0) {
            const gd = GADGETS.grouper;
            let best = null, bd = gd.range;
            for (const q of players) {
              if (!q.alive || q.id === t.owner || q.air) continue;
              const d = len(q.x - t.x, q.z - t.z);
              if (d < bd) { bd = d; best = q; }
            }
            if (best) {
              t.cd = gd.every;
              t.rot = Math.atan2(best.x - t.x, best.z - t.z);
              S.projectiles.push({ id: uid(), w: 'grouper', gadget: true, owner: t.owner, x: t.x, z: t.z, sx: t.x, sz: t.z, tx: best.x + (best.vx || 0) * gd.flight * 0.6, tz: best.z + (best.vz || 0) * gd.flight * 0.6, flight: gd.flight, life: gd.flight, lob: true, rad: 0.3, hitIds: [] });
              emit('spit', { x: t.x, z: t.z });
            } else t.cd = 0.3;
          }
        }
        if (gone) S.traps.splice(i, 1);
      }
    }

    // what lobbed gadgets do when they land
    function landGadget(pr, owner) {
      const gd = GADGETS[pr.w];
      if (pr.w === 'urchin') {
        for (let k = 0; k < gd.spikes; k++) {
          const a = (k / gd.spikes) * Math.PI * 2 + Math.random();
          const x = pr.x + Math.cos(a) * rand(0.6, 1.6), z = pr.z + Math.sin(a) * rand(0.6, 1.6);
          if (onPlatformPoint(x, z)) S.traps.push({ id: uid(), kind: 'spike', owner: pr.owner, x, z, life: gd.life });
        }
        emit('scatter', { x: pr.x, z: pr.z });
      } else if (pr.w === 'ink') {
        S.traps.push({ id: uid(), kind: 'ink', owner: pr.owner, x: pr.x, z: pr.z, life: gd.life });
        emit('inkcloud', { x: pr.x, z: pr.z, r: gd.radius });
      } else if (pr.w === 'grouper') {
        explode(owner, pr.x, pr.z, gd, 'grouper');
      }
    }

    function checkBlast(p) {
      if (p.alive && len(p.x, p.z) > C.blastRadius) {
        emit('blast', { id: p.id, x: p.x, z: p.z });
        kill(p, 'blast');
      }
    }

    // Two charges, a long burst, a moment of dodge frames, and it carries you over water gaps.
    function doDash(p, inp) {
      if (p.dashN <= 0 || p.dashCd > 0) return;
      let dx = inp.mx, dz = inp.mz;
      if (len(dx, dz) < 0.1) { dx = p.ax; dz = p.az; }
      const l = len(dx, dz);
      p.vx = (dx / l) * C.dashSpeed; p.vz = (dz / l) * C.dashSpeed;
      p.dashT = C.dashTime; p.dashCd = 0.12; p.dashIF = C.dashIframes;
      p.dashN--;
      emit('dash', { id: p.id });
    }

    // Dash while swimming: hop up out of the water toward where you're steering (or the nearest boards).
    function waterDash(p, inp) {
      if (p.dashN <= 0) return;
      let dx = inp.mx, dz = inp.mz;
      if (len(dx, dz) < 0.1) { const np = nearestPlatformPoint(p.x, p.z); dx = np.x - p.x; dz = np.z - p.z; }
      const l = len(dx, dz) || 1;
      p.swim = false; p.air = true;
      p.vx = (dx / l) * C.waterDash.speed; p.vz = (dz / l) * C.waterDash.speed; p.vy = C.waterDash.up;
      p.dashN--; p.dashIF = C.dashIframes; p.kbT = 0;
      emit('dash', { id: p.id, water: true, x: p.x, z: p.z });
    }

    function integrate(p, dt, mx, mz) {
      const heavy = p.weapon && WEAPONS[p.weapon.id].heavy;
      let speed = heavy ? C.heavySpeed : C.playerSpeed;
      if (p.slowT > 0) speed *= 0.6;
      const ml = len(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      if (p.swim) {
        // swim back to the pier; touching it starts a short climb
        const k = 1 - Math.exp(-(p.kbT > 0 ? 1.2 : 4) * dt);
        p.vx += (mx * C.swimSpeed - p.vx) * k;
        p.vz += (mz * C.swimSpeed - p.vz) * k;
        const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
        p.y = C.waterY;
        const np = nearestPlatformPoint(nx, nz);
        if (p.kbT <= 0 && (onPlatformPoint(nx, nz) || len(np.x - nx, np.z - nz) < 0.45)) {
          const l = len(np.x - p.x, np.z - p.z) || 1;
          p.cx = np.x + ((np.x - p.x) / l) * 0.8;
          p.cz = np.z + ((np.z - p.z) / l) * 0.8;
          // make sure we land comfortably on the boards, nudging toward the middle if needed
          for (let i = 0; i < 20 && !onPlatform(p.cx, p.cz, 0.6); i++) {
            const cl = len(p.cx, p.cz) || 1;
            p.cx -= (p.cx / cl) * 0.3; p.cz -= (p.cz / cl) * 0.3;
          }
          p.climbT = C.climbTime;
          p.vx = p.vz = 0;
          emit('climb', { id: p.id });
          return;
        }
        if (!onPlatformPoint(nx, nz)) { p.x = nx; p.z = nz; }
        return;
      }
      if (p.air) {
        // a little air control (DI); otherwise ballistic
        const ctrl = p.kbT > 0 ? 3 : 10;
        p.vx += mx * ctrl * dt; p.vz += mz * ctrl * dt;
        p.vx *= Math.exp(-0.35 * dt); p.vz *= Math.exp(-0.35 * dt);
        if (p.kbT <= 0) {
          const hs = len(p.vx, p.vz);
          if (hs > speed && mx * p.vx + mz * p.vz <= 0) { p.vx *= Math.exp(-2 * dt); p.vz *= Math.exp(-2 * dt); }
        }
        p.vy -= C.gravity * dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
        if (p.y < 1.4) {
          for (const o of solidObstacles(S)) {
            const dx = p.x - o.x, dz = p.z - o.z, d = len(dx, dz), min = o.r + C.playerRadius;
            if (d < min && d > 0.0001) { p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
          }
        }
        if (p.y <= 0 && p.vy < 0 && onPlatformPoint(p.x, p.z) && p.y > -0.5) {
          p.y = 0; p.vy = 0; p.air = false;
          p.vx *= 0.3; p.vz *= 0.3;
          emit('land', { id: p.id, x: p.x, z: p.z, player: true });
        } else if (p.y <= C.waterY) {
          p.y = C.waterY; p.vy = 0; p.air = false; p.swim = true;
          p.vx *= 0.3; p.vz *= 0.3;
          p.kbT = Math.min(p.kbT, 0.2);
          emit('splash', { id: p.id, x: p.x, z: p.z });
        }
        return;
      }
      if (p.dashT > 0) {
        // keep dash velocity
      } else if (p.kbT > 0) {
        const k = 1 - Math.exp(-2.2 * dt);
        p.vx += (mx * speed - p.vx) * k * 0.5;
        p.vz += (mz * speed - p.vz) * k * 0.5;
        p.vx *= Math.exp(-1.6 * dt); p.vz *= Math.exp(-1.6 * dt);
      } else {
        const k = 1 - Math.exp(-14 * dt);
        p.vx += (mx * speed - p.vx) * k;
        p.vz += (mz * speed - p.vz) * k;
      }
      const free = p.kbT > 0 || p.dashT > 0; // knockback and dashes can carry you off the edge; walking cannot
      const m = C.playerRadius * 0.7;
      let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (!free) {
        const mm = onPlatform(p.x, p.z, m) ? m : 0.05;
        if (!onPlatform(nx, p.z, mm)) { nx = p.x; p.vx = 0; }
        if (!onPlatform(nx, nz, mm)) { nz = p.z; p.vz = 0; }
      }
      // obstacles (a ghost dash goes straight through)
      if (!(p.phaseT > 0)) for (const o of solidObstacles(S)) {
        const dx = nx - o.x, dz = nz - o.z, d = len(dx, dz), min = o.r + C.playerRadius;
        if (d < min && d > 0.0001) { nx = o.x + (dx / d) * min; nz = o.z + (dz / d) * min; }
      }
      p.x = nx; p.z = nz;
      if (!onPlatform(p.x, p.z, 0)) {
        // off the edge: a dash keeps flying until it ends, then you drop toward the water
        if (p.dashT > 0) return;
        p.air = true; p.vy = 0; p.y = 0;
        p.fishing = null;
        emit('fall', { id: p.id });
      }
    }

    function separatePlayers() {
      const ps = Object.values(S.players).filter((p) => p.alive && !p.air && !p.swim && p.climbT <= 0);
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = len(dx, dz), min = C.playerRadius * 2;
        if (d < min && d > 0.0001) {
          const push = (min - d) / 2;
          const nax = a.x - (dx / d) * push, naz = a.z - (dz / d) * push;
          const nbx = b.x + (dx / d) * push, nbz = b.z + (dz / d) * push;
          if (onPlatform(nax, naz, 0.3)) { a.x = nax; a.z = naz; }
          if (onPlatform(nbx, nbz, 0.3)) { b.x = nbx; b.z = nbz; }
        }
      }
    }

    function stepProjectiles(dt) {
      for (let i = S.projectiles.length - 1; i >= 0; i--) {
        const pr = S.projectiles[i];
        const w = WEAPONS[pr.w] || GADGETS[pr.w];
        const owner = S.players[pr.owner];
        pr.life -= dt;
        if (pr.lob) {
          const k = 1 - Math.max(0, pr.life) / pr.flight;
          pr.x = pr.sx + (pr.tx - pr.sx) * k;
          pr.z = pr.sz + (pr.tz - pr.sz) * k;
          pr.h = Math.sin(k * Math.PI) * (pr.hop || 4);
          if (pr.life <= 0) {
            if (!onPlatformPoint(pr.x, pr.z)) emit('splash', { x: pr.x, z: pr.z, small: true });
            else if (pr.gadget) landGadget(pr, owner);
            else if (pr.bounces > 0) {
              // bouncy puffer: hop on in the same direction, shorter each time
              const dx = pr.tx - pr.sx, dz = pr.tz - pr.sz;
              pr.sx = pr.x; pr.sz = pr.z; pr.tx = pr.x + dx * 0.55; pr.tz = pr.z + dz * 0.55;
              pr.flight *= 0.7; pr.life = pr.flight; pr.hop = (pr.hop || 4) * 0.55; pr.bounces--;
              emit('bounce', { x: pr.x, z: pr.z });
              continue;
            } else explode(owner, pr.x, pr.z, w, pr.w);
            S.projectiles.splice(i, 1);
          }
          continue;
        }
        if (pr.spin) {
          // boomerang: fly out, then home back to whoever threw it
          if (!pr.back) {
            pr.out -= len(pr.vx, pr.vz) * dt;
            if (pr.out <= 0) { pr.back = true; pr.hitIds = []; emit('boomturn', { x: pr.x, z: pr.z }); }
          } else if (owner && owner.alive) {
            const dx = owner.x - pr.x, dz = owner.z - pr.z, d = len(dx, dz) || 1;
            if (d < 1) { S.projectiles.splice(i, 1); emit('catchback', { id: owner.id }); continue; }
            pr.vx += ((dx / d) * w.speed - pr.vx) * Math.min(1, dt * 6);
            pr.vz += ((dz / d) * w.speed - pr.vz) * Math.min(1, dt * 6);
          }
        }
        if (w.homing && pr.life < w.life - 0.25) {
          // shark torpedo: turn toward the nearest target in front of it
          let best = null, bd = 18;
          for (const t of Object.values(S.players)) {
            if (t.id === pr.owner || !t.alive) continue;
            const dx = t.x - pr.x, dz = t.z - pr.z, d = len(dx, dz);
            if (d < bd && (dx * pr.vx + dz * pr.vz) > 0) { bd = d; best = t; }
          }
          if (best) {
            const sp = len(pr.vx, pr.vz) || 1, dx = best.x - pr.x, dz = best.z - pr.z, d = len(dx, dz) || 1;
            const k = Math.min(1, w.homing * dt);
            pr.vx += ((dx / d) * sp - pr.vx) * k; pr.vz += ((dz / d) * sp - pr.vz) * k;
            const l = len(pr.vx, pr.vz) || 1; pr.vx = (pr.vx / l) * sp; pr.vz = (pr.vz / l) * sp;
          }
        }
        pr.x += pr.vx * dt; pr.z += pr.vz * dt;
        let dead = pr.life <= 0;
        if (!pr.spin && !w.walls) {
          for (const o of solidObstacles(S)) {
            if (len(pr.x - o.x, pr.z - o.z) < o.r + pr.rad) { dead = true; break; }
          }
        }
        if (!dead) {
          for (const t of Object.values(S.players)) {
            if (t.id === pr.owner || !t.alive || t.y > 2.2 || t.climbT > 0 || pr.hitIds.includes(t.id)) continue;
            if (len(t.x - pr.x, t.z - pr.z) < C.playerRadius + pr.rad) {
              if (w.kind === 'rocket') { dead = true; break; }
              hit(t, owner, w.dmg, pr.vx, pr.vz, w.kb, { slow: w.slow, splat: w.splat, w: pr.w });
              pr.hitIds.push(t.id);
              if (w.kind !== 'pierce' && w.kind !== 'boomerang') { dead = true; break; }
            }
          }
        }
        if (dead) {
          if (w.kind === 'rocket') explode(owner, pr.x, pr.z, w, pr.w);
          S.projectiles.splice(i, 1);
        }
      }
    }

    function stepWorld(dt) {
      for (const r of S.rack) if (!r.ready) { r.t -= dt; if (r.t <= 0) r.ready = true; }
      for (let i = S.items.length - 1; i >= 0; i--) {
        const it = S.items[i];
        if (it.y > 0) { it.y = Math.max(0, it.y - dt * 7); if (it.y === 0) emit('land', { x: it.x, z: it.z, kind: it.kind }); }
        if (it.life != null) { it.life -= dt; if (it.life <= 0) S.items.splice(i, 1); }
      }
      // pelicans
      S.nextPelican -= dt;
      if (S.nextPelican <= 0) {
        S.nextPelican = C.pelicanEvery + rand(-C.pelicanJitter, C.pelicanJitter);
        const keys = Object.keys(DROPS);
        const kind = keys[pickWeighted(keys.map((k) => DROPS[k].w))];
        const target = randomPlatformPoint(Math.random() < 0.5);
        const ang = Math.random() * Math.PI * 2;
        const startD = 38;
        S.pelicans.push({ id: uid(), x: target.x - Math.cos(ang) * startD, z: target.z - Math.sin(ang) * startD, dx: Math.cos(ang), dz: Math.sin(ang), tx: target.x, tz: target.z, kind, dropped: false, life: 9 });
        emit('pelican', { x: target.x, z: target.z, kind });
      }
      for (let i = S.pelicans.length - 1; i >= 0; i--) {
        const pe = S.pelicans[i];
        pe.x += pe.dx * 10 * dt; pe.z += pe.dz * 10 * dt; pe.life -= dt;
        if (!pe.dropped && (pe.x - pe.tx) * pe.dx + (pe.z - pe.tz) * pe.dz >= 0) {
          pe.dropped = true;
          S.items.push({ id: uid(), kind: pe.kind, x: pe.tx, z: pe.tz, y: 9, life: 30 });
          emit('drop', { x: pe.tx, z: pe.tz, kind: pe.kind });
        }
        if (pe.life <= 0) S.pelicans.splice(i, 1);
      }
    }

    g.step = function (dt) {
      if (S.phase === 'lobby') return;
      if (S.phase === 'over') { S.time += dt; return; }
      S.time += dt;
      const rounds = S.mode === 'rounds';
      if (rounds && S.breakT > 0) {
        // between rounds: the survivor gets a short victory lap, then everyone drops back in
        S.breakT -= dt;
        if (S.breakT <= 0) { startRound(); return; }
      }
      if (!rounds) S.roundLeft -= dt;
      else if (S.breakT <= 0) S.roundT += dt;
      for (const p of Object.values(S.players)) if (p.bot) g.setInput(p.id, botThink(g, p, dt));
      for (const p of Object.values(S.players)) stepPlayer(p, g.inputs[p.id], dt);
      separatePlayers();
      stepProjectiles(dt);
      stepTraps(dt);
      stepWorld(dt);
      if (rounds) {
        if (S.breakT > 0) return;
        const all = Object.values(S.players);
        const alive = all.filter((p) => p.alive);
        if (all.length >= 2 && alive.length <= 1) endRound(alive[0] || null);
        else if (S.roundT >= C.roundCap && all.length >= 2) {
          // too long: whoever is healthiest takes it
          alive.sort((a, b) => b.hp - a.hp);
          endRound(alive[0]);
        }
        return;
      }
      if (S.roundLeft <= 0) {
        const ranked = Object.values(S.players).sort((a, b) => b.kos - a.kos || a.deaths - b.deaths);
        const top = ranked[0];
        const tied = ranked[1] && ranked[1].kos === top.kos && ranked[1].deaths === top.deaths;
        if (tied && S.roundLeft > -60) {
          if (!S.overtime) { S.overtime = true; emit('overtime', {}); }
        } else {
          S.phase = 'over';
          S.winner = top ? top.id : null;
          emit('over', { winner: S.winner });
        }
      }
    };

    g.drainEvents = function () { const e = g.events; g.events = []; return e; };

    g.snapshot = function () {
      const r2 = (v) => Math.round(v * 100) / 100;
      return {
        phase: S.phase, time: r2(S.time), roundLeft: r2(S.roundLeft), roundSeconds: S.roundSeconds, overtime: !!S.overtime, winner: S.winner,
        mode: S.mode, round: S.round, roundT: r2(S.roundT), breakT: r2(S.breakT), roundWinner: S.roundWinner, winRounds: C.winRounds, roundCap: C.roundCap,
        players: Object.values(S.players).map((p) => ({
          id: p.id, name: p.name, color: p.color, bot: p.bot, x: r2(p.x), z: r2(p.z), y: r2(p.y), ax: r2(p.ax), az: r2(p.az),
          hp: Math.max(0, Math.round(p.hp)), armor: Math.round(p.armor), alive: p.alive, out: p.respawnT === Infinity, air: p.air, swim: p.swim, climbT: r2(p.climbT), respawnT: p.respawnT === Infinity ? -1 : r2(p.respawnT), dashN: p.dashN, dashRT: r2(p.dashRT), dashIF: r2(p.dashIF), invulnT: r2(p.invulnT),
          hasRod: p.hasRod, weapon: p.weapon, cd: r2(p.cd), dashCd: r2(p.dashCd), dashT: r2(p.dashT), slowT: r2(p.slowT), stunT: r2(p.stunT), freezeT: r2(p.freezeT), splatT: r2(p.splatT), blindT: r2(p.blindT), phaseT: r2(p.phaseT), dotT: r2(p.dotT), swingT: r2(p.swingT),
          fishing: p.fishing ? { depth: r2(p.fishing.depth), mult: p.fishing.mult, bx: r2(p.fishing.bx), bz: r2(p.fishing.bz), dx: p.fishing.dx, dz: p.fishing.dz, reelT: r2(p.fishing.reelT), tip: p.fishing.tip, biteT: r2(p.fishing.biteT) } : null,
          bubble: p.bubble, lure: p.lure, gadget: p.gadget, roundWins: p.roundWins, kos: p.kos, deaths: p.deaths, caught: p.caught,
          vx: r2(p.vx), vz: r2(p.vz), kbT: r2(p.kbT), ack: g.inputs[p.id] ? g.inputs[p.id].seq : null,
        })),
        traps: S.traps.map((t) => ({ id: t.id, kind: t.kind, owner: t.owner, x: r2(t.x), z: r2(t.z), life: r2(t.life), armed: !(t.arm > 0), rot: t.rot ? r2(t.rot) : 0 })),
        projectiles: S.projectiles.map((p) => ({ id: p.id, w: p.w, back: p.back || undefined, x: r2(p.x), z: r2(p.z), h: p.h ? r2(p.h) : 0, vx: r2(p.vx || 0), vz: r2(p.vz || 0) })),
        items: S.items.map((i) => ({ id: i.id, kind: i.kind, weapon: i.weapon, x: r2(i.x), z: r2(i.z), y: r2(i.y || 0) })),
        pelicans: S.pelicans.map((p) => ({ id: p.id, x: r2(p.x), z: r2(p.z), dx: p.dx, dz: p.dz, tx: p.tx, tz: p.tz, kind: p.kind, dropped: p.dropped })),
        rack: S.rack.map((r) => r.ready),
      };
    };

    return g;
  }

  // ---------------------------------------------------------------- bot
  // Routes around water: walking from the core to a pier tip goes via the pier base.
  function navTarget(p, tx, tz) {
    const onPierX = (x, z) => Math.abs(z) <= MAP.pierHalf && Math.abs(x) > MAP.coreHalf;
    const onPierZ = (x, z) => Math.abs(x) <= MAP.pierHalf && Math.abs(z) > MAP.coreHalf;
    const pierOf = (x, z) => (onPierX(x, z) ? 'x' + Math.sign(x) : onPierZ(x, z) ? 'z' + Math.sign(z) : null);
    const mine = pierOf(p.x, p.z), theirs = pierOf(tx, tz);
    if (mine === theirs) return { x: tx, z: tz };
    if (mine) {
      // walk back toward the core along the pier centreline
      const base = mine[0] === 'x' ? { x: Math.sign(p.x) * (MAP.coreHalf - 1.5), z: 0 } : { x: 0, z: Math.sign(p.z) * (MAP.coreHalf - 1.5) };
      return base;
    }
    if (theirs) {
      const base = theirs[0] === 'x' ? { x: Math.sign(tx) * (MAP.coreHalf - 1), z: 0 } : { x: 0, z: Math.sign(tz) * (MAP.coreHalf - 1) };
      if (len(p.x - base.x, p.z - base.z) > 1.2 && (Math.abs(p.x) < MAP.coreHalf - 0.5 && Math.abs(p.z) < MAP.coreHalf - 0.5)) return base;
      return { x: tx, z: tz };
    }
    return { x: tx, z: tz };
  }

  const BOT_SKILL = {
    easy: { aimErr: 0.35, react: 0.5, fireRate: 0.5, greed: 0.6 },
    normal: { aimErr: 0.18, react: 0.25, fireRate: 0.8, greed: 1 },
    hard: { aimErr: 0.07, react: 0.12, fireRate: 1, greed: 1.2 },
  };

  function botThink(g, p, dt) {
    const S = g.state;
    const b = p.brain;
    const skill = BOT_SKILL[p.difficulty] || BOT_SKILL.normal;
    const out = { mx: 0, mz: 0, ax: p.ax, az: p.az, fire: false, dash: false, fish: false, use: false, gadget: false, aimDist: 8 };
    if (!p.alive || p.climbT > 0) { b.spot = null; return out; }
    if (p.swim || p.air) {
      // swim (or drift) back toward the nearest bit of pier, aiming for the middle when airborne
      b.spot = null;
      const t = p.swim ? nearestPlatformPoint(p.x, p.z) : { x: 0, z: 0 };
      const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz) || 1;
      out.mx = dx / d; out.mz = dz / d;
      // hop out of the water once the boards are in reach
      if (p.swim && d < 4.5 && p.dashN > 0 && Math.random() < 0.15) out.dash = true;
      return out;
    }

    let enemy = null, ed = 999;
    for (const o of Object.values(S.players)) {
      if (o === p || !o.alive || o.air || o.climbT > 0) continue;
      const d = len(o.x - p.x, o.z - p.z);
      if (d < ed) { ed = d; enemy = o; }
    }
    const enemyArmed = enemy && enemy.weapon;

    const moveTo = (tx, tz, stopAt) => {
      const n = navTarget(p, tx, tz);
      let dx = n.x - p.x, dz = n.z - p.z;
      const d = len(dx, dz);
      if (d < (stopAt || 0.3)) return true;
      dx /= d; dz /= d;
      // steer around barrels and the rack
      for (const o of MAP.obstacles.concat([MAP.rack])) {
        if (len(o.x - tx, o.z - tz) < o.r + 1.5) continue;
        const ox = o.x - p.x, oz = o.z - p.z;
        const along = ox * dx + oz * dz;
        const lat = ox * -dz + oz * dx;
        if (along > 0 && along < 3 && Math.abs(lat) < o.r + 0.8) {
          const side = lat > 0 ? -1 : 1;
          const px = -dz * side * 1.3, pz = dx * side * 1.3;
          dx += px; dz += pz;
          const l2 = len(dx, dz) || 1; dx /= l2; dz /= l2;
        }
      }
      out.mx = dx; out.mz = dz;
      return false;
    };

    // stuck detection
    b.stuckT += dt;
    if (b.stuckT > 1.5) {
      if (len(p.x - b.lastX, p.z - b.lastZ) < 0.5 && !p.fishing) b.spot = null;
      b.stuckT = 0; b.lastX = p.x; b.lastZ = p.z;
    }

    // --- gadgets: guard the cast, or toss throwables at whoever is close
    if (p.gadget && enemy && ed < 9 && Math.random() < (p.fishing ? 0.08 : 0.025)) {
      const gid = p.gadget.id;
      const tx = enemy.x - p.x, tz = enemy.z - p.z, tl = len(tx, tz) || 1;
      if (gid === 'urchin' || gid === 'ink' || gid === 'clam' || gid === 'grouper' || gid === 'jelly') {
        out.ax = tx / tl; out.az = tz / tl; out.aimDist = ed;
        out.gadget = true;
        return out;
      }
      if (gid === 'flounder') { out.ax = -tx / tl; out.az = -tz / tl; out.gadget = true; return out; }
    }

    // --- fishing: decide when to reel
    if (p.fishing) {
      const f = p.fishing;
      out.ax = f.dx; out.az = f.dz;
      if (f.reelT > 0) return out;
      const threat = enemy && ed < (enemyArmed ? 8 : 4.5);
      if (threat) {
        if (f.depth >= g.cfg.fishMinBite) out.fish = true;
        else if (ed < 4) out.dash = true; // bail out
      } else if (f.depth >= b.target && (f.biteT > 0 || f.depth >= b.target + 1.5 || p.difficulty === 'easy')) out.fish = true;
      return out;
    }

    // --- grab useful drops nearby
    let bestItem = null, bestScore = 0;
    for (const it of S.items) {
      if (it.y > 0.5) continue;
      const d = len(it.x - p.x, it.z - p.z);
      let v = 0;
      if (it.kind === 'heal') v = p.hp < 60 ? 10 : 0;
      else if (it.kind === 'armor') v = p.armor < 25 ? 8 : 0;
      else if (it.kind === 'cooler') v = 12;
      else if (it.kind === 'tackle') v = p.gadget ? 3 : 7;
      else if (it.kind === 'fish') v = p.weapon ? 0 : 9;
      else if (it.kind === 'rod') v = p.hasRod ? 0 : 6;
      else if (it.kind === 'bubble' || it.kind === 'lure') v = 4;
      const score = v / (1 + d * 0.15);
      if (v > 0 && d < 16 && score > bestScore) { bestScore = score; bestItem = it; }
    }

    // --- fight if armed
    if (p.weapon && enemy) {
      const w = WEAPONS[p.weapon.id];
      const melee = w.kind === 'melee' || w.kind === 'slam';
      const want = melee ? 1.6 : w.kind === 'phase' ? 4 : w.kind === 'lob' ? 7 : w.kind === 'zap' ? 7 : w.kind === 'blind' || w.kind === 'storm' ? 10 : 8;
      // aim with some lead and a wandering error
      b.think -= dt;
      if (b.think <= 0) { b.think = skill.react; b.aimErr = rand(-skill.aimErr, skill.aimErr); b.strafe = Math.random() < 0.5 ? -1 : 1; }
      const sp = w.speed || 30;
      const lead = melee ? 0 : ed / sp;
      let tx = enemy.x + enemy.vx * lead - p.x, tz = enemy.z + enemy.vz * lead - p.z;
      const tl = len(tx, tz) || 1;
      const ca = Math.cos(b.aimErr), sa = Math.sin(b.aimErr);
      out.ax = (tx / tl) * ca - (tz / tl) * sa; out.az = (tx / tl) * sa + (tz / tl) * ca;
      out.aimDist = ed;
      if (bestItem && bestItem.kind !== 'fish' && len(bestItem.x - p.x, bestItem.z - p.z) < 5) {
        moveTo(bestItem.x, bestItem.z);
      } else if (ed > want + 1) moveTo(enemy.x, enemy.z);
      else if (ed < want - 1.5 && !melee) { out.mx = -tx / tl; out.mz = -tz / tl; }
      else { out.mx = (-tz / tl) * b.strafe * 0.7; out.mz = (tx / tl) * b.strafe * 0.7; }
      // don't hug the edge: drift back toward the middle when near water
      if (!onPlatform(p.x + out.mx * 1.5, p.z + out.mz * 1.5, 0.8)) {
        const home = navTarget(p, 0, 0);
        const hx = home.x - p.x, hz = home.z - p.z, hl = len(hx, hz) || 1;
        out.mx = out.mx * 0.4 + (hx / hl) * 0.9; out.mz = out.mz * 0.4 + (hz / hl) * 0.9;
        const l = len(out.mx, out.mz) || 1; out.mx /= l; out.mz /= l;
      }
      const range = melee ? (w.range || w.reach + w.aoe) + 0.3 : w.kind === 'zap' ? w.range : w.kind === 'lob' ? w.maxRange : w.kind === 'boomerang' ? w.reach : w.kind === 'phase' ? w.speed * w.time : w.kind === 'blind' || w.kind === 'storm' ? 16 : sp * (w.life || 1);
      if (ed < range && Math.random() < skill.fireRate) out.fire = true;
      if (melee && ed < 5 && ed > 2.2 && p.dashN > 0 && Math.random() < 0.03) out.dash = true;
      // sidestep incoming fire
      else if (enemyArmed && ed < 9 && p.dashN > 1 && enemy.swingT > 0 && Math.random() < 0.3 * skill.fireRate) {
        out.mx = (-tz / tl) * b.strafe; out.mz = (tx / tl) * b.strafe; out.dash = true;
      }
      return out;
    }

    // --- unarmed with an armed enemy close by: dash away (there's no slapping)
    if (enemy && !p.weapon && enemyArmed && ed < 4.5 && p.dashN > 0 && Math.random() < 0.08) {
      const tx = enemy.x - p.x, tz = enemy.z - p.z, tl = len(tx, tz) || 1;
      const home = navTarget(p, 0, 0), hx = home.x - p.x, hz = home.z - p.z, hl = len(hx, hz) || 1;
      out.mx = -tx / tl * 0.6 + hx / hl * 0.4; out.mz = -tz / tl * 0.6 + hz / hl * 0.4;
      out.dash = true;
      return out;
    }

    if (bestItem) { moveTo(bestItem.x, bestItem.z); return out; }

    if (!p.hasRod) { moveTo(MAP.rack.x, MAP.rack.z, 1.5); return out; }

    // --- go fishing
    if (!b.spot) {
      let best = null, bs = -1e9;
      for (const s of FISH_SPOTS) {
        let score = -len(s.x - p.x, s.z - p.z) * 0.5 + Math.random() * 6;
        if (enemy) score += Math.min(len(s.x - enemy.x, s.z - enemy.z), 20);
        if (s.tip) score += 3 * skill.greed;
        if (score > bs) { bs = score; best = s; }
      }
      b.spot = best;
      const greedy = !enemy || !enemyArmed ? 1 : 0.5;
      const roll = Math.random() * skill.greed * greedy;
      b.target = roll > 0.85 ? rand(7, 8.5) : roll > 0.55 ? rand(4, 5.5) : roll > 0.25 ? rand(2, 3) : rand(0.6, 1.4);
    }
    if (moveTo(b.spot.x, b.spot.z, 0.6)) {
      const dir = waterDirection(p.x, p.z, p.x, p.z) || { x: Math.sign(p.x), z: 0 };
      out.ax = dir.x; out.az = dir.z;
      out.fish = true;
      b.spot = null;
    }
    return out;
  }

  return { walkStep, nearestPlatformPoint, GADGETS, BYCATCH, CFG, MAP, WEAPONS, TIERS, RARITIES, RARITY_COLORS, DROPS, BY_RARITY, createGame, onPlatform, onPlatformPoint, tierFor, waterDirection, isPierTip };
});
