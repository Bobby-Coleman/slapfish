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
    roundSeconds: 600,
    tickRate: 30,
    playerSpeed: 7.2,
    heavySpeed: 6.0,
    playerRadius: 0.55,
    maxHp: 100,
    maxArmor: 50,
    respawnSeconds: 5,
    spawnInvuln: 1.5,
    dashSpeed: 19,
    dashTime: 0.16,
    dashCooldown: 1.4,
    kbScale: 0.7, // global knockback tuning
    dmgScale: 1, // global damage tuning
    usesScale: 1, // global ammo tuning
    kbDamageScale: 1.0, // knockback multiplier = 1 + (1 - hp/100) * this
    creditWindow: 6, // seconds a hit counts for a ring-out credit
    rackRespawn: 6,
    fishMinBite: 2.5,
    reelTime: 0.6,
    autoReel: 30,
    pierTipMult: 1.35,
    catchUpGap: 3,
    catchUpMult: 1.25,
    pelicanFirst: 25,
    pelicanEvery: 40,
    pelicanJitter: 10,
    groundFishLife: 20,
    fallTime: 0.8,
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
    { id: 'shallow', name: 'Shallows', from: 0, w: [70, 25, 5, 0, 0] },
    { id: 'reef', name: 'Reef', from: 6, w: [35, 42, 20, 3, 0] },
    { id: 'deep', name: 'Deep', from: 12, w: [12, 33, 38, 15, 2] },
    { id: 'abyss', name: 'Abyss', from: 20, w: [3, 17, 40, 30, 10] },
  ];

  // Every fish is a weapon. Power budget (uses x damage, plus knockback and area) climbs with rarity.
  const WEAPONS = {
    slap: { name: 'Slap', rarity: 'none', kind: 'melee', dmg: 6, kb: 7, cd: 0.45, uses: Infinity, range: 1.9, arc: 0.5 },
    sardine: { name: 'Sardine Shooter', rarity: 'common', kind: 'shot', dmg: 8, kb: 3.5, cd: 0.25, uses: 28, speed: 32, life: 0.55, rad: 0.25, desc: 'Fast little pistol.' },
    mackerel: { name: 'Mackerel Slapper', rarity: 'common', kind: 'melee', dmg: 12, kb: 10, cd: 0.5, uses: 20, range: 2.3, arc: 0.4, desc: 'A proper slap.' },
    squid: { name: 'Squid Ink Blaster', rarity: 'uncommon', kind: 'shot', dmg: 6, kb: 2, cd: 0.3, uses: 25, pellets: 3, spread: 0.22, speed: 22, life: 0.5, rad: 0.35, slow: 2, desc: 'Ink spray that slows.' },
    puffer: { name: 'Pufferfish Grenade', rarity: 'uncommon', kind: 'lob', dmg: 30, kb: 17, cd: 0.9, uses: 8, maxRange: 13, aoe: 3.4, flight: 0.6, desc: 'Lobbed, pops on landing.' },
    swordfish: { name: 'Swordfish', rarity: 'rare', kind: 'melee', dmg: 22, kb: 17, cd: 0.65, uses: 16, range: 3.3, arc: 0.55, lunge: 15, desc: 'Lunging blade. Get close.' },
    tuna: { name: 'Tuna Cannon', rarity: 'rare', kind: 'shot', dmg: 18, kb: 22, cd: 0.95, uses: 10, speed: 26, life: 0.9, rad: 0.8, desc: 'Slow, huge knockback.' },
    hammerhead: { name: 'Hammerhead', rarity: 'epic', kind: 'slam', dmg: 32, kb: 24, cd: 1.1, uses: 12, aoe: 2.6, reach: 1.8, heavy: true, desc: 'Ground slam. Heavy.' },
    eel: { name: 'Electric Eel', rarity: 'epic', kind: 'zap', dmg: 13, kb: 6, cd: 0.5, uses: 20, range: 13, cone: 0.85, chain: 6, stun: 0.5, desc: 'Auto-aim zap, chains, stuns.' },
    shark: { name: 'Shark Rocket', rarity: 'legendary', kind: 'rocket', dmg: 38, kb: 28, cd: 1.25, uses: 7, speed: 20, life: 1.5, rad: 0.5, aoe: 3.6, desc: 'Explosive. Clears piers.' },
    narwhal: { name: 'Golden Narwhal', rarity: 'legendary', kind: 'pierce', dmg: 45, kb: 22, cd: 1.3, uses: 7, speed: 60, life: 0.5, rad: 0.35, desc: 'Piercing sniper lance.' },
  };
  const BY_RARITY = {};
  for (const id in WEAPONS) {
    const r = WEAPONS[id].rarity;
    (BY_RARITY[r] = BY_RARITY[r] || []).push(id);
  }

  // Pelican air drops.
  const DROPS = {
    heal: { name: 'Fish & Chips', w: 28, desc: '+45 health' },
    armor: { name: 'Crab Shell', w: 24, desc: '+50 armor' },
    bubble: { name: 'Bubble Bobber', w: 20, desc: 'Next fishing trip: 2 hits blocked' },
    lure: { name: 'Golden Lure', w: 16, desc: 'Next 2 casts sink twice as fast' },
    cooler: { name: 'Mystery Cooler', w: 12, desc: 'A random rare-or-better fish' },
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
        time: 0,
        roundLeft: (opts.roundSeconds || CFG.roundSeconds),
        roundSeconds: (opts.roundSeconds || CFG.roundSeconds),
        players: {},
        projectiles: [],
        items: [], // ground pickups: rods, fish, drops
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
        hp: C.maxHp, armor: 0, alive: false, respawnT: 0.5, falling: 0, invulnT: 0,
        hasRod: false, weapon: null, cd: 0, dashCd: 0, dashT: 0, kbT: 0, slowT: 0, stunT: 0,
        fishing: null, bubble: 0, lure: 0,
        kos: 0, deaths: 0, caught: 0, lastHitBy: null, lastHitT: -99, swingT: 0,
        brain: isBot ? { spot: null, target: 0, stuckT: 0, lastX: 0, lastZ: 0, think: 0, strafe: 1, aimErr: 0 } : null,
      };
      S.players[id] = p;
      g.inputs[id] = { mx: 0, mz: 0, ax: 1, az: 0, fire: false, dash: false, fish: false, use: false };
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
      // edge-triggered buttons latch until the sim consumes them
      cur.dash = cur.dash || !!inp.dash;
      cur.fish = cur.fish || !!inp.fish;
      cur.use = cur.use || !!inp.use;
    };
    g.start = function () {
      S.phase = 'play';
      S.time = 0;
      S.roundLeft = S.roundSeconds;
      S.projectiles = [];
      S.items = [];
      S.pelicans = [];
      S.winner = null;
      S.nextPelican = C.pelicanFirst;
      syncRack();
      for (const r of S.rack) { r.ready = true; r.t = 0; }
      let i = 0;
      for (const p of Object.values(S.players)) {
        Object.assign(p, { kos: 0, deaths: 0, caught: 0, alive: false, respawnT: 0.2 + i * 0.05, weapon: null, hasRod: false, fishing: null, armor: 0, bubble: 0, lure: 0 });
        i++;
      }
      emit('start', {});
    };

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
        x: best[0], z: best[1], y: 0, vx: 0, vz: 0, hp: C.maxHp, alive: true, falling: 0,
        invulnT: C.spawnInvuln, kbT: 0, slowT: 0, stunT: 0, fishing: null, dashT: 0, cd: 0, lastHitBy: null,
      });
      const l = len(-p.x, -p.z) || 1;
      p.ax = -p.x / l; p.az = -p.z / l;
      emit('spawn', { id: p.id });
    }

    function leaderKos() {
      let m = 0;
      for (const p of Object.values(S.players)) m = Math.max(m, p.kos);
      return m;
    }

    function kill(p, cause) {
      if (!p.alive) return;
      const credit = p.lastHitBy && S.time - p.lastHitT <= C.creditWindow && S.players[p.lastHitBy] ? S.players[p.lastHitBy] : null;
      if (credit && credit !== p) credit.kos++;
      p.deaths++;
      p.alive = false;
      p.respawnT = C.respawnSeconds;
      // Dropped loot: KOs on the pier leave your fish (and rod) behind for others to steal.
      if (cause !== 'water') {
        if (p.weapon && p.weapon.uses > 0) S.items.push({ id: uid(), kind: 'fish', weapon: p.weapon.id, uses: p.weapon.uses, x: p.x, z: p.z, life: C.groundFishLife });
        if (p.hasRod) S.items.push({ id: uid(), kind: 'rod', x: p.x + 0.6, z: p.z + 0.3, life: C.groundFishLife });
      }
      p.weapon = null;
      p.hasRod = false;
      p.fishing = null;
      p.armor = 0;
      emit('ko', { id: p.id, by: credit ? credit.id : null, cause, x: p.x, z: p.z });
    }

    function hit(t, attacker, dmg, dirx, dirz, kb, extra) {
      if (!t.alive || t.falling || t.invulnT > 0) return false;
      if (attacker && attacker.id === t.id) return false;
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
      const mult = C.kbScale * (1 + (1 - clamp(t.hp, 0, C.maxHp) / C.maxHp) * C.kbDamageScale);
      const l = len(dirx, dirz) || 1;
      t.vx += (dirx / l) * kb * mult;
      t.vz += (dirz / l) * kb * mult;
      t.kbT = Math.max(t.kbT, 0.18 + kb * 0.012 * mult);
      if (extra && extra.slow) t.slowT = Math.max(t.slowT, extra.slow);
      if (extra && extra.stun) t.stunT = Math.max(t.stunT, extra.stun);
      if (attacker) { t.lastHitBy = attacker.id; t.lastHitT = S.time; }
      emit('hit', { id: t.id, by: attacker ? attacker.id : null, dmg: Math.round(dmg + absorbed), armor: absorbed > 0, x: t.x, z: t.z });
      if (t.hp <= 0) kill(t, 'hp');
      return true;
    }

    function explode(owner, x, z, w) {
      emit('boom', { x, z, r: w.aoe });
      for (const t of Object.values(S.players)) {
        if (t === owner) continue;
        const d = len(t.x - x, t.z - z);
        if (d < w.aoe + C.playerRadius) {
          const f = 1 - 0.5 * clamp(d / w.aoe, 0, 1);
          hit(t, owner, w.dmg * f, t.x - x + 0.001, t.z - z, w.kb * f);
        }
      }
    }

    function useWeapon(p, inp) {
      const wid = p.weapon ? p.weapon.id : 'slap';
      const w = WEAPONS[wid];
      p.cd = w.cd;
      p.swingT = 0.2;
      const ax = p.ax, az = p.az;
      emit('fire', { id: p.id, w: wid, x: p.x, z: p.z, ax, az });
      if (w.kind === 'melee' || w.kind === 'slam') {
        if (w.lunge) { p.dashT = 0.14; p.vx = ax * w.lunge; p.vz = az * w.lunge; }
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive) continue;
          if (w.kind === 'slam') {
            const cx = p.x + ax * w.reach, cz = p.z + az * w.reach;
            if (len(t.x - cx, t.z - cz) < w.aoe + C.playerRadius) hit(t, p, w.dmg, t.x - p.x, t.z - p.z, w.kb);
          } else {
            const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz);
            if (d < w.range + C.playerRadius && (d < 0.6 || (dx * ax + dz * az) / d >= w.arc)) hit(t, p, w.dmg, dx, dz, w.kb);
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
      } else if (w.kind === 'lob') {
        const dist = clamp(inp.aimDist || 8, 2, w.maxRange);
        S.projectiles.push({ id: uid(), w: wid, owner: p.id, x: p.x, z: p.z, sx: p.x, sz: p.z, tx: p.x + ax * dist, tz: p.z + az * dist, flight: w.flight, life: w.flight, lob: true, rad: 0.4, hitIds: [] });
      } else if (w.kind === 'zap') {
        let first = null, bestD = 999;
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive || t.falling) continue;
          const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz);
          if (d < w.range && (dx * ax + dz * az) / d > w.cone && d < bestD) { bestD = d; first = t; }
        }
        const chain = [];
        if (first) {
          chain.push(first);
          let second = null; bestD = 999;
          for (const t of Object.values(S.players)) {
            if (t === p || t === first || !t.alive) continue;
            const d = len(t.x - first.x, t.z - first.z);
            if (d < w.chain && d < bestD) { bestD = d; second = t; }
          }
          if (second) chain.push(second);
        }
        const pts = [{ x: p.x, z: p.z }];
        if (chain.length) {
          for (const t of chain) { pts.push({ x: t.x, z: t.z }); hit(t, p, w.dmg, t.x - p.x, t.z - p.z, w.kb, { stun: w.stun }); }
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

    function giveWeapon(p, wid, uses) {
      p.weapon = { id: wid, uses: uses != null ? uses : Math.round(WEAPONS[wid].uses * C.usesScale) };
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
        } else if (it.kind === 'heal') { if (p.hp < C.maxHp) { p.hp = Math.min(C.maxHp, p.hp + 45); take = true; } }
        else if (it.kind === 'armor') { if (p.armor < C.maxArmor) { p.armor = C.maxArmor; take = true; } }
        else if (it.kind === 'bubble') { p.bubble = 2; take = true; }
        else if (it.kind === 'lure') { p.lure = 2; take = true; }
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
      if (p.falling > 0) {
        p.falling += dt;
        p.y -= dt * (3 + p.falling * 14);
        p.x += p.vx * dt; p.z += p.vz * dt;
        if (p.falling >= C.fallTime) { emit('splash', { id: p.id, x: p.x, z: p.z }); kill(p, 'water'); }
        return;
      }
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.cd = Math.max(0, p.cd - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);
      p.slowT = Math.max(0, p.slowT - dt);
      p.stunT = Math.max(0, p.stunT - dt);
      p.kbT = Math.max(0, p.kbT - dt);
      p.dashT = Math.max(0, p.dashT - dt);
      p.swingT = Math.max(0, p.swingT - dt);

      const stunned = p.stunT > 0;
      if (!stunned && (inp.ax || inp.az)) { p.ax = inp.ax; p.az = inp.az; }

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
            giveWeapon(p, r.wid);
            p.caught++;
            p.fishing = null;
            emit('catch', { id: p.id, w: r.wid, rarity: WEAPONS[r.wid].rarity, tier: r.tier, depth: f.depth });
          }
        } else {
          const prevTier = tierFor(f.depth).id;
          f.depth += dt * f.mult;
          const nt = tierFor(f.depth).id;
          if (nt !== prevTier) emit('tier', { id: p.id, tier: nt });
          if (inp.fish) {
            inp.fish = false;
            if (f.depth < C.fishMinBite) { p.fishing = null; emit('cancel', { id: p.id }); }
            else { f.reelT = C.reelTime; emit('reel', { id: p.id }); }
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
            p.fishing = { depth: 0, mult, dx: dir.x, dz: dir.z, bx: p.x + dir.x * 5, bz: p.z + dir.z * 5, reelT: 0, tip: isPierTip(p.x, p.z) };
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
    }

    function doDash(p, inp) {
      if (p.dashCd > 0) return;
      let dx = inp.mx, dz = inp.mz;
      if (len(dx, dz) < 0.1) { dx = p.ax; dz = p.az; }
      const l = len(dx, dz);
      p.vx = (dx / l) * C.dashSpeed; p.vz = (dz / l) * C.dashSpeed;
      p.dashT = C.dashTime; p.dashCd = C.dashCooldown;
      emit('dash', { id: p.id });
    }

    function integrate(p, dt, mx, mz) {
      const heavy = p.weapon && WEAPONS[p.weapon.id].heavy;
      let speed = heavy ? C.heavySpeed : C.playerSpeed;
      if (p.slowT > 0) speed *= 0.6;
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
      const free = p.kbT > 0; // knockback can carry you off the edge; walking (and dashing) cannot
      const m = C.playerRadius * 0.7;
      let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (!free) {
        if (!onPlatform(nx, p.z, m)) { nx = p.x; p.vx = 0; }
        if (!onPlatform(nx, nz, m)) { nz = p.z; p.vz = 0; }
      }
      // obstacles
      for (const o of MAP.obstacles.concat([MAP.rack])) {
        const dx = nx - o.x, dz = nz - o.z, d = len(dx, dz), min = o.r + C.playerRadius;
        if (d < min && d > 0.0001) { nx = o.x + (dx / d) * min; nz = o.z + (dz / d) * min; }
      }
      p.x = nx; p.z = nz;
      if (!onPlatform(p.x, p.z, 0)) {
        p.falling = 0.0001;
        p.fishing = null;
        emit('fall', { id: p.id });
      }
    }

    function separatePlayers() {
      const ps = Object.values(S.players).filter((p) => p.alive && !p.falling);
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
        const w = WEAPONS[pr.w];
        const owner = S.players[pr.owner];
        pr.life -= dt;
        if (pr.lob) {
          const k = 1 - Math.max(0, pr.life) / pr.flight;
          pr.x = pr.sx + (pr.tx - pr.sx) * k;
          pr.z = pr.sz + (pr.tz - pr.sz) * k;
          pr.h = Math.sin(k * Math.PI) * 4;
          if (pr.life <= 0) {
            if (onPlatformPoint(pr.x, pr.z)) explode(owner, pr.x, pr.z, w);
            else emit('splash', { x: pr.x, z: pr.z, small: true });
            S.projectiles.splice(i, 1);
          }
          continue;
        }
        pr.x += pr.vx * dt; pr.z += pr.vz * dt;
        let dead = pr.life <= 0;
        for (const o of MAP.obstacles.concat([MAP.rack])) {
          if (len(pr.x - o.x, pr.z - o.z) < o.r + pr.rad) { dead = true; break; }
        }
        if (!dead) {
          for (const t of Object.values(S.players)) {
            if (t.id === pr.owner || !t.alive || t.falling || pr.hitIds.includes(t.id)) continue;
            if (len(t.x - pr.x, t.z - pr.z) < C.playerRadius + pr.rad) {
              if (w.kind === 'rocket') { dead = true; break; }
              hit(t, owner, w.dmg, pr.vx, pr.vz, w.kb, { slow: w.slow });
              pr.hitIds.push(t.id);
              if (w.kind !== 'pierce') { dead = true; break; }
            }
          }
        }
        if (dead) {
          if (w.kind === 'rocket') explode(owner, pr.x, pr.z, w);
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
      S.roundLeft -= dt;
      for (const p of Object.values(S.players)) if (p.bot) g.setInput(p.id, botThink(g, p, dt));
      for (const p of Object.values(S.players)) stepPlayer(p, g.inputs[p.id], dt);
      separatePlayers();
      stepProjectiles(dt);
      stepWorld(dt);
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
        players: Object.values(S.players).map((p) => ({
          id: p.id, name: p.name, color: p.color, bot: p.bot, x: r2(p.x), z: r2(p.z), y: r2(p.y), ax: r2(p.ax), az: r2(p.az),
          hp: Math.round(p.hp), armor: Math.round(p.armor), alive: p.alive, falling: p.falling > 0, respawnT: r2(p.respawnT), invulnT: r2(p.invulnT),
          hasRod: p.hasRod, weapon: p.weapon, cd: r2(p.cd), dashCd: r2(p.dashCd), dashT: r2(p.dashT), slowT: r2(p.slowT), stunT: r2(p.stunT), swingT: r2(p.swingT),
          fishing: p.fishing ? { depth: r2(p.fishing.depth), mult: p.fishing.mult, bx: r2(p.fishing.bx), bz: r2(p.fishing.bz), dx: p.fishing.dx, dz: p.fishing.dz, reelT: r2(p.fishing.reelT), tip: p.fishing.tip } : null,
          bubble: p.bubble, lure: p.lure, kos: p.kos, deaths: p.deaths, caught: p.caught,
        })),
        projectiles: S.projectiles.map((p) => ({ id: p.id, w: p.w, x: r2(p.x), z: r2(p.z), h: p.h ? r2(p.h) : 0, vx: r2(p.vx || 0), vz: r2(p.vz || 0) })),
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
    const out = { mx: 0, mz: 0, ax: p.ax, az: p.az, fire: false, dash: false, fish: false, use: false, aimDist: 8 };
    if (!p.alive || p.falling) { b.spot = null; return out; }

    let enemy = null, ed = 999;
    for (const o of Object.values(S.players)) {
      if (o === p || !o.alive || o.falling) continue;
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

    // --- fishing: decide when to reel
    if (p.fishing) {
      const f = p.fishing;
      out.ax = f.dx; out.az = f.dz;
      if (f.reelT > 0) return out;
      const threat = enemy && ed < (enemyArmed ? 8 : 4.5);
      if (threat) {
        if (f.depth >= g.cfg.fishMinBite) out.fish = true;
        else if (ed < 4) out.dash = true; // bail out
      } else if (f.depth >= b.target) out.fish = true;
      return out;
    }

    // --- grab useful drops nearby
    let bestItem = null, bestScore = 0;
    for (const it of S.items) {
      if (it.y > 0.5) continue;
      const d = len(it.x - p.x, it.z - p.z);
      let v = 0;
      if (it.kind === 'heal') v = p.hp < 70 ? 10 : 0;
      else if (it.kind === 'armor') v = p.armor < 25 ? 8 : 0;
      else if (it.kind === 'cooler') v = 12;
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
      const want = melee ? 1.6 : w.kind === 'lob' ? 7 : w.kind === 'zap' ? 7 : 8;
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
      if (!onPlatform(p.x, p.z, 2.2) || !onPlatform(p.x + out.mx * 1.5, p.z + out.mz * 1.5, 0.6)) {
        const home = navTarget(p, 0, 0);
        const hx = home.x - p.x, hz = home.z - p.z, hl = len(hx, hz) || 1;
        out.mx = out.mx * 0.4 + (hx / hl) * 0.9; out.mz = out.mz * 0.4 + (hz / hl) * 0.9;
        const l = len(out.mx, out.mz) || 1; out.mx /= l; out.mz /= l;
      }
      const range = melee ? (w.range || w.reach + w.aoe) + 0.3 : w.kind === 'zap' ? w.range : w.kind === 'lob' ? w.maxRange : sp * (w.life || 1);
      if (ed < range && Math.random() < skill.fireRate) out.fire = true;
      if (melee && ed < 5 && ed > 2.2 && p.dashCd <= 0 && Math.random() < 0.03) out.dash = true;
      return out;
    }

    // --- unarmed with a nearby armed enemy: slap if very close, else run
    if (enemy && !p.weapon && ed < 2.2) {
      const tx = enemy.x - p.x, tz = enemy.z - p.z, tl = len(tx, tz) || 1;
      out.ax = tx / tl; out.az = tz / tl; out.fire = true;
      if (enemyArmed && p.dashCd <= 0 && Math.random() < 0.05) { out.mx = -tx / tl; out.mz = -tz / tl; out.dash = true; }
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
      b.target = roll > 0.85 ? rand(20, 24) : roll > 0.55 ? rand(12, 16) : roll > 0.25 ? rand(6, 9) : rand(2.6, 4.5);
    }
    if (moveTo(b.spot.x, b.spot.z, 0.6)) {
      const dir = waterDirection(p.x, p.z, p.x, p.z) || { x: Math.sign(p.x), z: 0 };
      out.ax = dir.x; out.az = dir.z;
      out.fish = true;
      b.spot = null;
    }
    return out;
  }

  return { CFG, MAP, WEAPONS, TIERS, RARITIES, RARITY_COLORS, DROPS, BY_RARITY, createGame, onPlatform, onPlatformPoint, tierFor, waterDirection, isPierTip };
});
