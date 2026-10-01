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
    map: 'harbor', // 'harbor' (Harbor Box) or 'plus' (Plus Pier)
    gateHold: 7, // a drawbridge flipped by a button flips back after this long
    mode: 'rounds', // 'rounds': die and you're out until the next round; 'timed': most KOs, fast respawn
    winRounds: 5, // rounds mode: first to this many round wins takes the match
    roundCap: 100, // rounds mode: a round that runs this long goes to whoever has the most health
    roundBreak: 3, // seconds between rounds
    // team modes ('team' = Team KOs, 'koth' = King of the Hill, 'ctf' = Capture the Flag): 2 or 3 teams, 1.5 s respawns at your base
    teamSeconds: 300,
    teamKOs: 20, // Team KOs: first team to this many
    kothWin: 50, // King of the Hill: seconds of holding the hill alone
    kothMove: 30, // the hill moves on after this long
    ctfCaps: 3, // Capture the Flag: captures to win
    flagReturn: 15, // a dropped flag goes home after this long
    carrySpeed: 0.88, // carrying a flag slows you a little
    frenzyAt: 40, // rounds mode: after this long the deep fish start biting faster and faster
    frenzyRamp: 20, // seconds per extra 1x of sink speed once the frenzy starts
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

  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const RARITY_COLORS = { none: '#ffffff', common: '#cfd8dc', uncommon: '#5ee07a', rare: '#45a8ff', epic: '#c86bff', legendary: '#ffb22e' };

  // Rarity odds rise smoothly the longer your line is in (depth = seconds, sped up by pier tips and lures).
  // Any cast can land anything: a legendary is about 1 in 25 after a second or two, about 1 in 3 at 10 s.
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function rarityOdds(d) {
    const legendary = 0.04 + 0.26 * smooth(1.5, 10, d);
    const epic = 0.06 + 0.19 * smooth(1, 8, d);
    const rare = 0.10 + 0.17 * smooth(0.5, 6, d);
    const uncommon = 0.22 - 0.07 * smooth(3, 10, d);
    const common = Math.max(0, 1 - legendary - epic - rare - uncommon);
    return [common, uncommon, rare, epic, legendary];
  }

  // Depth tiers are names for how deep the line has sunk (shown on the gauge); the odds come from rarityOdds().
  const TIERS = [
    { id: 'shallow', name: 'Shallows', from: 0 },
    { id: 'reef', name: 'Reef', from: 2.5 },
    { id: 'deep', name: 'Deep', from: 5 },
    { id: 'abyss', name: 'Abyss', from: 8 },
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

  const TEAM_MODES = { team: 'Team KOs', koth: 'King of the Hill', ctf: 'Capture the Flag' };
  const TEAM_COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f'];
  const TEAM_NAMES = ['Coral', 'Blue', 'Gold'];
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
  // ---------------------------------------------------------------- maps
  // A map is static deck rectangles [x0, x1, z0, z1] plus things that move or change:
  // movers (rafts and barges on a fixed timetable that anyone can stand on), gates (drawbridges that
  // floor buttons raise and lower) and portal pads. Mover positions depend only on the clock, so clients
  // can draw them from the snapshot time.
  function rect(x0, x1, z0, z1) { return [Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]; }
  // quarter turns for building symmetric maps: (x, z) -> (z, -x)
  function rotP(k, x, z) { for (let i = 0; i < k; i++) { const t = x; x = z; z = -t; } return [x, z]; }
  function rotR(k, r) { const a = rotP(k, r[0], r[2]), b = rotP(k, r[1], r[3]); return rect(a[0], b[0], a[1], b[1]); }
  function inRect(r, x, z, m) { m = m || 0; return x >= r[0] - m && x <= r[1] + m && z >= r[2] - m && z <= r[3] + m; }

  function emptyMap(id, name, desc) {
    return { id, name, desc, rects: [], deep: [], racks: [], obstacles: [], boxes: [], spawns: [], fishSpots: [], gates: [], buttons: [], portals: [], movers: [], drops: { near: [], far: [] }, signs: [], tipBuoys: [] };
  }

  // The original: a square deck with four long piers, plus two rafts circling between the piers.
  function buildPlus() {
    const M = emptyMap('plus', 'Plus Pier', 'Four long piers. Deep water at the tips, rafts circling between them.');
    M.rects.push(rect(-12, 12, -12, 12));
    M.racks.push({ x: 0, z: 0 });
    M.drops.near.push(rect(-10.5, 10.5, -10.5, 10.5));
    for (let k = 0; k < 4; k++) {
      const P = (x, z) => rotP(k, x, z), R = (r) => rotR(k, r);
      M.rects.push(R(rect(-3, 3, 12, 28)));
      M.deep.push(R(rect(-3, 3, 21, 28)));
      M.drops.far.push(R(rect(-1.8, 1.8, 13.5, 26.5)));
      let [x, z] = P(7, 7); M.obstacles.push({ x, z, r: 0.85 });
      [x, z] = P(0, 17); M.obstacles.push({ x, z, r: 0.7 });
      M.spawns.push(P(9, 9), P(0, 9.5));
      [x, z] = P(0, 27.2); M.fishSpots.push({ x, z, tip: true });
      for (const s of [[11.4, 7.5], [7.5, 11.4], [2.4, 20]]) { [x, z] = P(s[0], s[1]); M.fishSpots.push({ x, z }); }
      [x, z] = P(2.4, 27.5); M.signs.push({ text: 'DEEP', x, z, rot: k * Math.PI / 2 });
      M.tipBuoys.push(P(-6, 29));
    }
    for (const phase of [0, 0.5]) M.movers.push({ kind: 'raft', hw: 1.3, hd: 1.3, path: { type: 'circle', cx: 0, cz: 0, r: 18, period: 36, phase } });
    // team bases at the pier tips (N, E, S, W); hills: the middle, a tip, a raft, the other tip
    M.bases = [{ x: 0, z: 24 }, { x: 24, z: 0 }, { x: 0, z: -24 }, { x: -24, z: 0 }];
    M.hills = [{ x: 0, z: 0, r: 4 }, { x: 0, z: 23, r: 3 }, { m: 0, r: 2.2 }, { x: 0, z: -23, r: 3 }, { x: 23, z: 0, r: 3 }, { m: 1, r: 2.2 }, { x: -23, z: 0, r: 3 }];
    return M;
  }

  // A square harbour around a lagoon. Four corner docks joined by drawbridges (buttons flip them), a rod
  // island in the middle reached by shuttle barges, rafts circling the lagoon, fishing rafts doing laps
  // outside, jetties into deep water, containers to hide behind, and portal pads across the corners.
  function buildHarbor() {
    const M = emptyMap('harbor', 'Harbor Box', 'A box of docks round a lagoon. Barges, rafts, drawbridges and portals.');
    const O = 22, I = 16, G = 2;
    M.rects.push(rect(-5, 5, -5, 5)); // rod island
    M.racks.push({ x: 0, z: 0 });
    M.obstacles.push({ x: 3.2, z: -3.2, r: 0.7 }, { x: -3.2, z: 3.2, r: 0.7 });
    M.drops.near.push(rect(-4, 4, -4, 4));
    for (let k = 0; k < 4; k++) {
      const P = (x, z) => rotP(k, x, z), R = (r) => rotR(k, r);
      let x, z;
      // north side (turned four ways): two halves either side of the bridge gap, the corner, a jetty out to sea
      M.rects.push(R(rect(-I, -G, I, O)), R(rect(G, I, I, O)), R(rect(I, O, I, O)), R(rect(O, O + 8, 17, 20)));
      M.deep.push(R(rect(O + 3, O + 8, 17, 20)));
      M.drops.near.push(R(rect(-14.5, -3.5, 17, 21)));
      M.drops.far.push(R(rect(16.8, 21.2, 16.8, 17.5)), R(rect(O + 1, O + 7, 17.8, 19.2)));
      // the drawbridge over the gap: north and south start down, east and west start up
      const gi = M.gates.length;
      M.gates.push({ kind: 'bridge', r: R(rect(-G, G, I, O)), def: k % 2 === 0 });
      for (const bx of [-3.3, 3.3]) { [x, z] = P(bx, 21); M.buttons.push({ x, z, r: 0.9, gate: gi }); }
      // cover: a shipping container on the side, a crate stack in the corner, barrels
      M.boxes.push(R(rect(8.5, 13, 18.2, 20)), R(rect(18, 20, 18, 20)));
      [x, z] = P(-8.5, 18.2); M.obstacles.push({ x, z, r: 0.85 });
      [x, z] = P(-11, 21); M.obstacles.push({ x, z, r: 0.7 });
      if (k % 2 === 0) { [x, z] = P(-13.5, 18.6); M.racks.push({ x, z }); }
      if (k < 2) M.portals.push({ a: P(5.5, 19.2), b: rotP(k + 2, 5.5, 19.2) });
      M.spawns.push(P(-6, 19), P(10.5, 17));
      [x, z] = P(29, 18.5); M.fishSpots.push({ x, z, tip: true });
      for (const s of [[21.2, 21.2], [-10, 16.6], [12, 21.3]]) { [x, z] = P(s[0], s[1]); M.fishSpots.push({ x, z }); }
      [x, z] = P(29.6, 17.3); M.signs.push({ text: 'DEEP', x, z, rot: Math.PI / 2 + k * Math.PI / 2 });
      M.tipBuoys.push(P(31.5, 21.5));
      // shuttle barges from the island's corners to the docks' inner corners, docking at each end
      M.movers.push({ kind: 'barge', hw: 1.6, hd: 1.6, path: { type: 'shuttle', a: P(6.2, 6.2), b: P(15, 15), period: 9, pause: 2, phase: k % 2 ? 0.5 : 0 } });
    }
    // two rafts circle the lagoon; two fishing rafts lap the outside of the box over deep water
    for (const phase of [0, 0.5]) M.movers.push({ kind: 'raft', hw: 1.3, hd: 1.3, path: { type: 'circle', cx: 0, cz: 0, r: 10.5, period: 28, phase, dir: -1 } });
    const lap = [[26, -18], [26, 18], [18, 26], [-18, 26], [-26, 18], [-26, -18], [-18, -26], [18, -26]];
    for (const phase of [0, 0.5]) M.movers.push({ kind: 'raft', deep: true, hw: 1.5, hd: 1.5, path: { type: 'loop', pts: lap, period: 64, phase } });
    // team bases out on the jetty ends (NW, NE, SE, SW): dead ends over deep water, easy to fish and defend
    M.bases = [{ x: -18.5, z: 27.6 }, { x: 27.6, z: 18.5 }, { x: 18.5, z: -27.6 }, { x: -27.6, z: -18.5 }];
    M.hills = [{ x: 0, z: 0, r: 3.8 }, { x: 19, z: 19, r: 3.2 }, { m: 4, r: 2.3 }, { x: -19, z: -19, r: 3.2 }, { x: 0, z: 19, r: 3 }, { m: 5, r: 2.3 }, { x: 0, z: -19, r: 3 }];
    return M;
  }

  const MAPS = { harbor: buildHarbor(), plus: buildPlus() };
  for (const id in MAPS) {
    const M = MAPS[id];
    M.solids = M.obstacles.concat(M.racks.map((r) => ({ x: r.x, z: r.z, r: 1.1 })));
  }

  function moverPos(m, t) {
    const P = m.path;
    const u = (((t / P.period + (P.phase || 0)) % 1) + 1) % 1;
    if (P.type === 'circle') {
      const a = u * Math.PI * 2 * (P.dir || 1);
      return { x: P.cx + Math.cos(a) * P.r, z: P.cz + Math.sin(a) * P.r };
    }
    if (P.type === 'shuttle') {
      // wait at a, glide to b, wait at b, glide back
      const q = P.pause / P.period, mv = 0.5 - q;
      const k = u < q ? 0 : u < 0.5 ? smooth(0, 1, (u - q) / mv) : u < 0.5 + q ? 1 : 1 - smooth(0, 1, (u - 0.5 - q) / mv);
      return { x: P.a[0] + (P.b[0] - P.a[0]) * k, z: P.a[1] + (P.b[1] - P.a[1]) * k };
    }
    // loop: constant speed round a closed polygon
    const pts = P.pts;
    if (!P.lens) { P.lens = pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return len(b[0] - a[0], b[1] - a[1]); }); P.total = P.lens.reduce((s, v) => s + v, 0); }
    let d = u * P.total;
    for (let i = 0; i < pts.length; i++) {
      if (d <= P.lens[i]) { const a = pts[i], b = pts[(i + 1) % pts.length], f = d / P.lens[i]; return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f }; }
      d -= P.lens[i];
    }
    return { x: pts[0][0], z: pts[0][1] };
  }

  // A world is one map plus its live state. The geometry helpers below read the active world W;
  // every game points W at its own before it does anything, and the client points it at its copy.
  function makeWorld(id) {
    const map = MAPS[id] || MAPS[CFG.map];
    const w = {
      map, t: 0, gateVer: 0, nav: null,
      movers: map.movers.map((m) => Object.assign({}, m, { x: 0, z: 0, px: 0, pz: 0 })),
      gates: map.gates.map((g) => ({ r: g.r, def: g.def, pass: g.def, t: 0 })),
      buttons: map.buttons.map((b) => ({ x: b.x, z: b.z, r: b.r, gate: b.gate, down: false, cd: 0 })),
    };
    worldAt(w, 0); worldAt(w, 0);
    refreshWalls(w);
    return w;
  }
  function resetWorld(w) {
    for (const g of w.gates) { g.pass = g.def; g.t = 0; }
    for (const b of w.buttons) { b.down = false; b.cd = 0; }
    w.gateVer++;
    refreshWalls(w);
  }
  // raised drawbridges are walls; everything else solid is a container or crate
  function refreshWalls(w) { w.walls = w.map.boxes.concat(w.gates.filter((g) => !g.pass).map((g) => g.r)); }
  function worldAt(w, t) {
    w.t = t;
    for (const m of w.movers) { const p = moverPos(m, t); m.px = m.x; m.pz = m.z; m.x = p.x; m.z = p.z; }
  }
  let W = null;
  function useWorld(w) { W = w; }

  function onStatic(x, z) {
    for (const r of W.map.rects) if (inRect(r, x, z)) return true;
    for (const g of W.gates) if (g.pass && inRect(g.r, x, z)) return true;
    return false;
  }
  function moverAt(x, z, prev) {
    for (const m of W.movers) {
      const mx = prev ? m.px : m.x, mz = prev ? m.pz : m.z;
      if (Math.abs(x - mx) <= m.hw && Math.abs(z - mz) <= m.hd) return m;
    }
    return null;
  }
  // standing on a raft or barge (and not on solid boards): ride along with it
  function carry(o, xk, zk) {
    xk = xk || 'x'; zk = zk || 'z';
    if (onStatic(o[xk], o[zk])) return null;
    const m = moverAt(o[xk], o[zk], true);
    if (m) { o[xk] += m.x - m.px; o[zk] += m.z - m.pz; }
    return m;
  }
  function onPlatformPoint(x, z) { return onStatic(x, z) || !!moverAt(x, z); }
  function onPlatform(x, z, m) {
    if (!m) return onPlatformPoint(x, z);
    return onPlatformPoint(x + m, z) && onPlatformPoint(x - m, z) && onPlatformPoint(x, z + m) && onPlatformPoint(x, z - m);
  }
  // deep water: pier tips, jetty ends and the fishing rafts out at sea
  function isPierTip(x, z) {
    for (const r of W.map.deep) if (inRect(r, x, z)) return true;
    if (onStatic(x, z)) return false;
    const m = moverAt(x, z);
    return !!(m && m.deep);
  }
  function tierFor(depth) {
    let t = TIERS[0];
    for (const tier of TIERS) if (depth >= tier.from) t = tier;
    return t;
  }
  function randomPlatformPoint(far) {
    const list = far && W.map.drops.far.length ? W.map.drops.far : W.map.drops.near;
    const areas = list.map((r) => (r[1] - r[0]) * (r[3] - r[2]));
    for (let i = 0; i < 50; i++) {
      const r = list[pickWeighted(areas)];
      const x = rand(r[0], r[1]), z = rand(r[2], r[3]);
      if (onStatic(x, z) && !blockedByObstacle(x, z, 1.2)) return { x, z };
    }
    return { x: (list[0][0] + list[0][1]) / 2, z: (list[0][2] + list[0][3]) / 2 };
  }
  function blockedByObstacle(x, z, r) {
    for (const o of W.map.solids) if (len(x - o.x, z - o.z) < o.r + r) return true;
    for (const b of W.map.boxes) if (inRect(b, x, z, r)) return true;
    for (const q of W.map.portals) if (len(x - q.a[0], z - q.a[1]) < 1 + r || len(x - q.b[0], z - q.b[1]) < 1 + r) return true;
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

  // Barrels, rod racks, and any giant clams currently deployed.
  function solidObstacles(S) {
    if (!S || !S.traps.some((t) => t.kind === 'clam')) return W.map.solids;
    const list = W.map.solids.slice();
    for (const t of S.traps) if (t.kind === 'clam') list.push({ x: t.x, z: t.z, r: GADGETS.clam.r });
    return list;
  }
  // push a circle out of an axis-aligned box; null if it isn't touching
  function pushOutBox(b, x, z, r) {
    const cx = clamp(x, b[0], b[1]), cz = clamp(z, b[2], b[3]);
    const dx = x - cx, dz = z - cz, d = len(dx, dz);
    if (d >= r) return null;
    if (d > 1e-4) return { x: cx + (dx / d) * r, z: cz + (dz / d) * r };
    const l = x - b[0], rt = b[1] - x, t = z - b[2], bt = b[3] - z, mn = Math.min(l, rt, t, bt);
    if (mn === l) return { x: b[0] - r, z };
    if (mn === rt) return { x: b[1] + r, z };
    if (mn === t) return { x, z: b[2] - r };
    return { x, z: b[3] + r };
  }
  // shove a player-sized circle out of barrels, racks, clams and boxes (raised bridges too when `walls`)
  function resolveSolids(x, z, S, walls) {
    const r = CFG.playerRadius;
    for (const o of solidObstacles(S)) {
      const dx = x - o.x, dz = z - o.z, d = len(dx, dz), min = o.r + r;
      if (d < min && d > 0.0001) { x = o.x + (dx / d) * min; z = o.z + (dz / d) * min; }
    }
    for (const b of walls ? W.walls : W.map.boxes) { const q = pushOutBox(b, x, z, r); if (q) { x = q.x; z = q.z; } }
    return { x, z };
  }

  // Closest point on any boards to (x, z), used for swimming back and climbing out.
  // Also says which way is "inward" (the middle of that deck) and which mover it is, if any.
  function nearestPlatformPoint(x, z) {
    let best = null, bd = 1e9;
    const consider = (x0, x1, z0, z1, m) => {
      const px = clamp(x, x0, x1), pz = clamp(z, z0, z1), d = len(px - x, pz - z);
      if (d < bd) { bd = d; best = { x: px, z: pz, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, m: m || null }; }
    };
    for (const r of W.map.rects) consider(r[0], r[1], r[2], r[3]);
    for (const g of W.gates) if (g.pass) consider(g.r[0], g.r[1], g.r[2], g.r[3]);
    for (const m of W.movers) consider(m.x - m.hw, m.x + m.hw, m.z - m.hd, m.z + m.hd, m);
    return best;
  }

  // Plain walking step (no dash or knockback). Mirrors integrate() so online clients can predict their own
  // movement. Pass the clock time t to also ride whatever raft or barge you're standing on.
  function walkStep(p, mx, mz, dt, t) {
    const C = CFG;
    if (t != null && W.movers.length) { worldAt(W, t); worldAt(W, t + dt); carry(p); }
    const heavy = p.weapon && WEAPONS[p.weapon.id] && WEAPONS[p.weapon.id].heavy;
    let speed = heavy ? C.heavySpeed : C.playerSpeed;
    if (p.slowT > 0) speed *= 0.6;
    if (p.carry != null) speed *= C.carrySpeed;
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
    const q = resolveSolids(nx, nz, null, true);
    p.x = q.x; p.z = q.z;
  }

  // ---------------------------------------------------------------- bot navigation
  // A walking grid over the boards (2 m apart). Neighbours join where you can walk between them; "dash"
  // links hop short water gaps. Bots follow a distance field toward their goal; anything the grid can't
  // reach (the rod island, rafts) they go straight for, dashing over gaps and swimming the rest.
  function walkable(x, z, r) {
    if (!onStatic(x, z)) return false;
    for (const o of W.map.solids) if (len(x - o.x, z - o.z) < o.r + r) return false;
    for (const b of W.walls) if (inRect(b, x, z, r)) return false;
    return true;
  }
  function anyDeck(x, z) {
    for (const r of W.map.rects) if (inRect(r, x, z)) return true;
    for (const g of W.gates) if (inRect(g.r, x, z)) return true;
    return false;
  }
  function gateAt(x, z) { for (let i = 0; i < W.gates.length; i++) if (inRect(W.gates[i].r, x, z)) return i; return -1; }
  function walkLine(x0, z0, x1, z1) {
    const d = len(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.5));
    for (let i = 1; i <= n; i++) if (!walkable(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, 0.45)) return false;
    return true;
  }
  function buildNav(w) {
    const prevW = W; W = w;
    const nodes = [], key = new Map(), SP = 2;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const r of w.map.rects.concat(w.gates.map((g) => g.r))) { x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[1]); z0 = Math.min(z0, r[2]); z1 = Math.max(z1, r[3]); }
    const solidFree = (x, z, r) => !w.map.solids.some((o) => len(x - o.x, z - o.z) < o.r + r) && !w.map.boxes.some((b) => inRect(b, x, z, r));
    for (let i = 0, x = Math.floor(x0) + 1; x < x1; x += SP, i++) for (let j = 0, z = Math.floor(z0) + 1; z < z1; z += SP, j++) {
      const inside = (dx, dz) => anyDeck(x + dx, z + dz);
      if (!inside(0, 0) || !inside(0.5, 0) || !inside(-0.5, 0) || !inside(0, 0.5) || !inside(0, -0.5) || !solidFree(x, z, 0.6)) continue;
      key.set(i + ',' + j, nodes.length);
      nodes.push({ x, z, i, j, gate: gateAt(x, z), nb: [] });
    }
    for (let a = 0; a < nodes.length; a++) {
      const n = nodes[a];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const b = key.get((n.i + di) + ',' + (n.j + dj));
        if (b == null) continue;
        const o = nodes[b], mx = (n.x + o.x) / 2, mz = (n.z + o.z) / 2;
        if (anyDeck(mx, mz) && solidFree(mx, mz, 0.5)) n.nb.push({ j: b, d: len(o.x - n.x, o.z - n.z) });
      }
      n.interior = n.nb.length === 8;
    }
    // dash links over short stretches of open water (never through a drawbridge gap)
    for (let a = 0; a < nodes.length; a++) {
      const n = nodes[a];
      if (n.interior) continue;
      for (let b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        const o = nodes[b], d = len(o.x - n.x, o.z - n.z);
        if (d < 2.9 || d > 6.2 || o.interior) continue;
        let wet = 0, maxWet = 0, ok = true;
        for (let s = 1; s < 20; s++) {
          const x = n.x + ((o.x - n.x) * s) / 20, z = n.z + ((o.z - n.z) * s) / 20;
          if (gateAt(x, z) >= 0 || !solidFree(x, z, 0.5)) { ok = false; break; }
          if (anyDeck(x, z)) wet = 0; else { wet += d / 20; maxWet = Math.max(maxWet, wet); }
        }
        if (ok && maxWet > 0.5 && maxWet < 4.6) n.nb.push({ j: b, d: d + 3, dash: true });
      }
    }
    W = prevW;
    return { nodes, fields: new Map(), ver: -1 };
  }
  function navOf(w) {
    if (!w.nav) w.nav = buildNav(w);
    if (w.nav.ver !== w.gateVer) { w.nav.fields.clear(); w.nav.ver = w.gateVer; }
    return w.nav;
  }
  const nodeOpen = (n) => n.gate < 0 || W.gates[n.gate].pass;
  function nearestNode(nav, x, z, maxD) {
    let best = -1, bd = maxD || 1e9;
    for (let i = 0; i < nav.nodes.length; i++) {
      const n = nav.nodes[i];
      if (!nodeOpen(n)) continue;
      const d = len(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // distance from every node to `goal` (Dijkstra with a tiny binary heap), cached until a gate moves
  function navField(nav, goal) {
    let f = nav.fields.get(goal);
    if (f) return f;
    if (nav.fields.size > 48) nav.fields.clear();
    f = new Float64Array(nav.nodes.length).fill(Infinity);
    f[goal] = 0;
    const heap = [[0, goal]];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, a] = pop();
      if (d > f[a]) continue;
      for (const e of nav.nodes[a].nb) {
        // links are symmetric enough on these maps to walk the field backwards;
        // a raised drawbridge costs a detour to its button
        const nd = d + e.d + (nodeOpen(nav.nodes[e.j]) ? 0 : 14);
        if (nd < f[e.j]) { f[e.j] = nd; push([nd, e.j]); }
      }
    }
    nav.fields.set(goal, f);
    return f;
  }
  // Where to head next on the way to (tx, tz): { x, z, dash } (dash: take off toward x, z now).
  function navRoute(x, z, tx, tz) {
    if (walkLine(x, z, tx, tz)) return { x: tx, z: tz };
    const nav = navOf(W);
    const goal = nearestNode(nav, tx, tz, 4);
    const me = nearestNode(nav, x, z, 3);
    if (goal < 0 || me < 0) return { x: tx, z: tz, direct: true };
    const f = navField(nav, goal);
    if (!isFinite(f[me])) return { x: tx, z: tz, direct: true };
    let cur = me, aim = nav.nodes[me];
    for (let hop = 0; hop < 10 && cur !== goal; hop++) {
      let nxt = null, bd = Infinity;
      for (const e of nav.nodes[cur].nb) if (f[e.j] < f[cur] && f[e.j] + e.d < bd) { bd = f[e.j] + e.d; nxt = e; }
      if (!nxt) break;
      const n = nav.nodes[nxt.j];
      if (!nodeOpen(n)) {
        // the bridge is up: go and stand on its button (the nearest one, on our side)
        if (hop > 0) break;
        let btn = null, bb = 1e9;
        for (const b of W.buttons) if (b.gate === n.gate && len(b.x - x, b.z - z) < bb) { bb = len(b.x - x, b.z - z); btn = b; }
        return btn ? { x: btn.x, z: btn.z } : { x: aim.x, z: aim.z };
      }
      if (nxt.dash) {
        // at the take-off point: jump; otherwise walk to it first
        const here = nav.nodes[cur];
        if (len(here.x - x, here.z - z) < 1.3) return { x: n.x, z: n.z, dash: true };
        return { x: here.x, z: here.z };
      }
      if (hop === 0 || walkLine(x, z, n.x, n.z)) aim = n; else break;
      cur = nxt.j;
    }
    if (cur === goal && walkLine(x, z, tx, tz)) return { x: tx, z: tz };
    return { x: aim.x, z: aim.z };
  }
  // walking distance (or a pessimistic guess when the grid can't get there on foot)
  function navDist(x, z, tx, tz) {
    const nav = navOf(W), goal = nearestNode(nav, tx, tz, 4), me = nearestNode(nav, x, z, 3);
    const guess = len(tx - x, tz - z) * 2 + 20;
    if (goal < 0 || me < 0) return guess;
    const f = navField(nav, goal);
    return isFinite(f[me]) ? f[me] : guess;
  }
  // a nearby spot away from the edges, to back off toward
  function homeNear(x, z) {
    const nav = navOf(W);
    let best = null, bd = 1e9;
    for (const n of nav.nodes) {
      if (!n.interior || !nodeOpen(n)) continue;
      const d = len(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best || { x: 0, z: 0 };
  }

  // ---------------------------------------------------------------- game
  function createGame(opts) {
    opts = opts || {};
    const g = {
      cfg: Object.assign({}, CFG, opts.cfg || {}),
      state: {
        phase: 'lobby', // lobby | play | over
        mode: (opts.cfg && opts.cfg.mode) || opts.mode || CFG.mode,
        map: MAPS[opts.map || (opts.cfg && opts.cfg.map)] ? opts.map || opts.cfg.map : CFG.map,
        teams: 0, // team modes: how many teams (2 or 3)
        teamScore: [],
        flags: [], // capture the flag: one per team
        hill: null, // king of the hill
        winTeam: null,
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
    g.world = makeWorld(S.map);
    useWorld(g.world);
    S.teams = TEAM_MODES[S.mode] ? clamp(+opts.teams || 2, 2, 3) : 0;
    // pick mode, team count, match length and map in one go (the server's lobby uses this)
    g.configure = function (o) {
      if (o.map) g.setMap(o.map);
      if (o.mode && (o.mode === 'rounds' || o.mode === 'timed' || TEAM_MODES[o.mode])) S.mode = o.mode;
      S.teams = TEAM_MODES[S.mode] ? clamp(+o.teams || S.teams || 2, 2, 3) : 0;
      if (o.roundSeconds) S.roundSeconds = clamp(+o.roundSeconds, 60, 1200);
    };
    function ally(a, b) { return !!(S.teams && a && b && a !== b && a.team === b.team); }
    function teamBases() { const B = g.world.map.bases; return (S.teams === 3 ? [0, 1, 2] : [0, 2]).map((i) => B[i]); }
    function teamSize(t) { return Object.values(S.players).filter((p) => p.team === t).length; }
    g.setMap = function (id) {
      if (!MAPS[id] || id === S.map) return;
      S.map = id;
      g.world = makeWorld(id);
      useWorld(g.world);
      S.rack = [];
      syncRack();
    };

    function emit(type, data) { g.events.push(Object.assign({ type, t: S.time }, data)); }
    function uid() { return g.nextId++; }

    // rods: every rack on the map holds its own little stack
    function syncRack() {
      const racks = g.world.map.racks.length, np = Object.keys(S.players).length;
      const per = racks > 1 ? clamp(Math.ceil((np + 1) / racks), 2, 6) : Math.min(6, Math.max(3, np + 1));
      for (let k = 0; k < racks; k++) {
        const mine = S.rack.filter((r) => r.k === k);
        for (let i = mine.length; i < per; i++) S.rack.push({ k, ready: true, t: 0 });
        for (let i = per; i < mine.length; i++) S.rack.splice(S.rack.indexOf(mine[i]), 1);
      }
    }

    g.addPlayer = function (id, name, isBot, difficulty) {
      useWorld(g.world);
      const used = new Set(Object.values(S.players).map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
      const p = {
        id, name: (name || 'Angler').slice(0, 16), color, bot: !!isBot, difficulty: difficulty || 'normal',
        x: 0, z: 0, y: 0, vx: 0, vz: 0, ax: 1, az: 0,
        hp: CFG.maxHp, armor: 0, alive: false, dashN: CFG.dashCharges, dashRT: 0, dashIF: 0, roundWins: 0, respawnT: 0.5, invulnT: 0, vy: 0, air: false, swim: false, climbT: 0, cx: 0, cz: 0,
        hasRod: false, weapon: null, cd: 0, dashCd: 0, dashT: 0, kbT: 0, slowT: 0, stunT: 0, freezeT: 0, splatT: 0, blindT: 0, phaseT: 0, dotT: 0, dotBy: null, lastW: null, lastHitW: null,
        fishing: null, bubble: 0, lure: 0, gadget: null, portalLock: null, team: -1, carry: null, baseColor: color,
        kos: 0, deaths: 0, caught: 0, lastHitBy: null, lastHitT: -99, swingT: 0,
        brain: isBot ? { spot: null, target: 0, stuckT: 0, lastX: 0, lastZ: 0, think: 0, strafe: 1, aimErr: 0 } : null,
      };
      S.players[id] = p;
      if (S.teams && S.phase !== 'lobby') {
        // joining a team game in progress: fill the smallest team
        let best = 0;
        for (let t = 1; t < S.teams; t++) if (teamSize(t) < teamSize(best)) best = t;
        p.team = best; p.color = TEAM_COLORS[best];
      }
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
      useWorld(g.world);
      resetWorld(g.world);
      S.phase = 'play';
      S.time = 0;
      S.roundLeft = S.roundSeconds;
      S.projectiles = [];
      S.traps = [];
      S.items = [];
      S.pelicans = [];
      S.winner = null;
      S.winTeam = null;
      S.overtime = false;
      S.nextPelican = C.pelicanFirst;
      if (S.teams) S.roundSeconds = C.teamSeconds;
      S.roundLeft = S.roundSeconds;
      S.teamScore = new Array(S.teams).fill(0);
      syncRack();
      for (const r of S.rack) { r.ready = true; r.t = 0; }
      let i = 0;
      for (const p of Object.values(S.players)) {
        Object.assign(p, { kos: 0, deaths: 0, caught: 0, roundWins: 0, alive: false, respawnT: 0.2 + i * 0.05, weapon: null, hasRod: false, fishing: null, armor: 0, bubble: 0, lure: 0, gadget: null, carry: null });
        // teams fill in join order: you, then bots alternate
        p.team = S.teams ? i % S.teams : -1;
        p.color = S.teams ? TEAM_COLORS[p.team] : p.baseColor;
        if (p.brain) p.brain.role = Math.floor(i / Math.max(1, S.teams)) % 2;
        i++;
      }
      S.flags = S.mode === 'ctf' ? teamBases().map((b, t) => ({ team: t, x: b.x, z: b.z, hx: b.x, hz: b.z, state: 'home', carrier: null, t: 0 })) : [];
      S.hill = S.mode === 'koth' ? { i: 0, t: C.kothMove, owner: -1, contested: false } : null;
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
      let spawns = g.world.map.spawns;
      if (S.teams && p.team >= 0) {
        // team games: one of the three spawn points nearest your base
        const b = teamBases()[p.team];
        spawns = spawns.slice().sort((u, v) => len(u[0] - b.x, u[1] - b.z) - len(v[0] - b.x, v[1] - b.z)).slice(0, 3);
      }
      let best = spawns[0], bestD = -1;
      for (const s of spawns) {
        let d = 999;
        for (const o of others) if (!ally(o, p)) d = Math.min(d, len(o.x - s[0], o.z - s[1]));
        d += Math.random() * 3;
        if (d > bestD) { bestD = d; best = s; }
      }
      Object.assign(p, {
        x: best[0], z: best[1], y: 0, vx: 0, vz: 0, vy: 0, hp: C.maxHp, dashN: C.dashCharges, dashRT: 0, dashIF: 0, alive: true, air: false, swim: false, climbT: 0,
        invulnT: C.spawnInvuln, portalLock: null, kbT: 0, slowT: 0, stunT: 0, freezeT: 0, splatT: 0, blindT: 0, phaseT: 0, dotT: 0, lastHitW: null, fishing: null, dashT: 0, cd: 0, lastHitBy: null,
      });
      const l = len(-p.x, -p.z) || 1;
      p.ax = -p.x / l; p.az = -p.z / l;
      emit('spawn', { id: p.id });
    }

    // late in a round, lines sink faster so somebody lands a one-shot and the round ends
    function frenzy() { return S.mode === 'rounds' && S.roundT > C.frenzyAt ? 1 + (S.roundT - C.frenzyAt) / C.frenzyRamp : 1; }

    function leaderKos() {
      let m = 0;
      for (const p of Object.values(S.players)) m = Math.max(m, S.mode === 'rounds' ? p.roundWins : p.kos);
      return m;
    }

    function kill(p, cause) {
      if (!p.alive) return;
      const credit = p.lastHitBy && S.time - p.lastHitT <= C.creditWindow && S.players[p.lastHitBy] ? S.players[p.lastHitBy] : null;
      if (credit && credit !== p) credit.kos++;
      if (S.mode === 'team' && credit && credit !== p && !ally(credit, p)) S.teamScore[credit.team]++;
      if (p.carry != null) dropFlag(p, cause);
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
      if (ally(attacker, t)) return false; // no friendly fire
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
        for (const t of Object.values(S.players)) if (t !== p && t.alive && !ally(p, t)) { t.blindT = w.blind; t.lastHitBy = p.id; t.lastHitT = S.time; t.lastHitW = wid; }
        emit('blind', { id: p.id, x: p.x, z: p.z, t: w.blind });
      } else if (w.kind === 'storm') {
        for (const t of Object.values(S.players)) if (t !== p && t.alive && !ally(p, t)) { t.dotT = w.time; t.dotBy = p.id; t.slowT = Math.max(t.slowT, w.time); t.splatT = Math.max(t.splatT, w.time); }
        emit('storm', { id: p.id, t: w.time });
      } else if (w.kind === 'zap') {
        let first = null, bestD = 999;
        for (const t of Object.values(S.players)) {
          if (t === p || !t.alive || ally(p, t)) continue;
          const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz);
          if (d < w.range && (dx * ax + dz * az) / d > w.cone && d < bestD) { bestD = d; first = t; }
        }
        const chain = [];
        if (first) {
          chain.push(first);
          if (w.chain) {
          let second = null; bestD = 999;
          for (const t of Object.values(S.players)) {
            if (t === p || t === first || !t.alive || ally(p, t)) continue;
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
      const ri = pickWeighted(rarityOdds(depth));
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
      if (!p.hasRod) g.world.map.racks.forEach((rk, k) => {
        if (p.hasRod || len(p.x - rk.x, p.z - rk.z) > 2.3) return;
        const slot = S.rack.find((r) => r.k === k && r.ready);
        if (slot) { slot.ready = false; slot.t = C.rackRespawn; p.hasRod = true; emit('rod', { id: p.id }); }
      });
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
            mult *= frenzy();
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
      checkPortals(p);
      checkBlast(p);
    }

    // Portal pads: step (or fly) onto one and pop out of its partner. You have to step off before it works again.
    function checkPortals(p) {
      const ports = g.world.map.portals;
      if (!ports.length || !p.alive) return;
      if (p.portalLock != null) {
        const q = ports[p.portalLock >> 1], e = p.portalLock & 1 ? q.b : q.a;
        if (len(p.x - e[0], p.z - e[1]) < 1.7) return;
        p.portalLock = null;
      }
      if (p.swim || p.climbT > 0 || p.y > 1.5 || p.y < -0.3 || p.carry != null) return;
      for (let i = 0; i < ports.length; i++) for (let s = 0; s < 2; s++) {
        const e = s ? ports[i].b : ports[i].a, o = s ? ports[i].a : ports[i].b;
        if (len(p.x - e[0], p.z - e[1]) > 0.95) continue;
        emit('portal', { id: p.id, x: e[0], z: e[1], tx: o[0], tz: o[1] });
        p.x = o[0]; p.z = o[1];
        p.portalLock = i * 2 + (s ? 0 : 1);
        if (p.fishing) p.fishing = null;
        return;
      }
    }

    // Floor buttons flip their drawbridge; it flips back on its own after a while.
    function setGate(i, pass, by) {
      const gt = g.world.gates[i];
      if (gt.pass === pass) return;
      gt.pass = pass;
      gt.t = pass !== gt.def ? C.gateHold : 0;
      g.world.gateVer++;
      refreshWalls(g.world);
      emit('gate', { i, pass, by: by ? by.id : null, x: (gt.r[0] + gt.r[1]) / 2, z: (gt.r[2] + gt.r[3]) / 2 });
    }
    function stepGates(dt) {
      g.world.gates.forEach((gt, i) => { if (gt.t > 0) { gt.t -= dt; if (gt.t <= 0) setGate(i, gt.def); } });
      for (const b of g.world.buttons) {
        b.cd = Math.max(0, b.cd - dt);
        let by = null;
        for (const p of Object.values(S.players)) if (p.alive && !p.air && !p.swim && p.climbT <= 0 && len(p.x - b.x, p.z - b.z) < b.r + 0.25) { by = p; break; }
        if (by && !b.down && b.cd <= 0) { setGate(b.gate, !g.world.gates[b.gate].pass, by); b.cd = 0.6; emit('button', { x: b.x, z: b.z, id: by.id }); }
        b.down = !!by;
      }
    }

    // Rafts and barges carry whatever is standing on them: players, climbers' hand-holds, items, traps.
    function carryAll() {
      if (!g.world.movers.length) return;
      for (const p of Object.values(S.players)) {
        if (!p.alive || p.swim) continue;
        if (p.climbT > 0) { carry(p, 'cx', 'cz'); continue; }
        if (p.air) continue;
        const dx = p.x, dz = p.z;
        if (carry(p) && p.fishing) { p.fishing.bx += p.x - dx; p.fishing.bz += p.z - dz; }
      }
      for (const it of S.items) if (!(it.y > 0)) carry(it);
      for (const t of S.traps) carry(t);
      for (const f of S.flags) if (f.state === 'dropped') carry(f);
    }

    // ---- team objectives
    function teamWins(t) {
      if (S.phase !== 'play') return;
      S.phase = 'over';
      S.winTeam = t;
      const best = Object.values(S.players).filter((p) => p.team === t).sort((a, b) => b.kos - a.kos)[0];
      S.winner = best ? best.id : null;
      emit('over', { winner: S.winner, team: t });
    }
    function hillPos() {
      const h = g.world.map.hills[S.hill.i];
      if (h.m != null) { const m = g.world.movers[h.m]; return { x: m.x, z: m.z, r: h.r, m: h.m }; }
      return { x: h.x, z: h.z, r: h.r };
    }
    function returnFlag(f, by) {
      f.state = 'home'; f.x = f.hx; f.z = f.hz; f.carrier = null; f.t = 0;
      emit('flagreturn', { team: f.team, by: by ? by.id : null });
    }
    function dropFlag(p, cause) {
      const f = S.flags[p.carry];
      p.carry = null;
      if (!f) return;
      // knocked off the map or sunk: it goes home; otherwise it sits where you fell
      if (cause === 'blast' || !onPlatformPoint(p.x, p.z)) { returnFlag(f, null); return; }
      f.state = 'dropped'; f.x = p.x; f.z = p.z; f.carrier = null; f.t = C.flagReturn;
      emit('flagdrop', { team: f.team, x: f.x, z: f.z });
    }
    function stepObjective(dt) {
      if (S.mode === 'team') {
        const t = S.teamScore.findIndex((v) => v >= C.teamKOs);
        if (t >= 0) teamWins(t);
      } else if (S.mode === 'koth') {
        const H = S.hill, spots = g.world.map.hills;
        H.t -= dt;
        if (H.t <= 0) { H.i = (H.i + 1) % spots.length; H.t = C.kothMove; H.owner = -1; emit('hill', hillPos()); }
        const hp = hillPos(), present = new Set();
        for (const p of Object.values(S.players)) if (p.alive && !p.swim && p.y > -0.5 && p.y < 2.5 && len(p.x - hp.x, p.z - hp.z) <= hp.r) present.add(p.team);
        H.contested = present.size > 1;
        const owner = present.size === 1 ? [...present][0] : -1;
        if (owner !== H.owner) { H.owner = owner; if (owner >= 0) emit('hilltake', { team: owner }); }
        if (owner >= 0) { S.teamScore[owner] += dt; if (S.teamScore[owner] >= C.kothWin) teamWins(owner); }
      } else if (S.mode === 'ctf') {
        for (const f of S.flags) {
          if (f.state === 'carried') {
            const c = S.players[f.carrier];
            if (!c || !c.alive || c.carry !== f.team) returnFlag(f, null);
            else { f.x = c.x; f.z = c.z; }
          } else if (f.state === 'dropped') { f.t -= dt; if (f.t <= 0) returnFlag(f, null); }
        }
        for (const p of Object.values(S.players)) {
          if (!p.alive || p.swim || p.air || p.climbT > 0) continue;
          for (const f of S.flags) {
            if (f.state === 'carried' || len(p.x - f.x, p.z - f.z) > 1.4) continue;
            if (f.team === p.team) { if (f.state === 'dropped') returnFlag(f, p); }
            else if (p.carry == null) { f.state = 'carried'; f.carrier = p.id; p.carry = f.team; emit('flagtake', { id: p.id, team: f.team, by: p.team }); }
          }
          const own = S.flags[p.team];
          if (p.carry != null && own && own.state === 'home' && len(p.x - own.hx, p.z - own.hz) < 1.8) {
            const f = S.flags[p.carry];
            p.carry = null;
            f.state = 'home'; f.x = f.hx; f.z = f.hz; f.carrier = null;
            S.teamScore[p.team]++;
            emit('capture', { id: p.id, team: p.team, from: f.team });
            if (S.teamScore[p.team] >= C.ctfCaps) teamWins(p.team);
          }
        }
      }
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
        const victims = (r) => players.filter((q) => q.alive && q.id !== t.owner && !ally(owner, q) && !q.air && q.climbT <= 0 && len(q.x - t.x, q.z - t.z) < r);
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
              if (!q.alive || q.id === t.owner || q.air || ally(owner, q)) continue;
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
      if (p.carry != null) speed *= C.carrySpeed;
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
          // make sure we land comfortably on the boards, nudging toward the middle of that deck if needed
          for (let i = 0; i < 20 && !onPlatform(p.cx, p.cz, 0.6); i++) {
            const ddx = np.cx - p.cx, ddz = np.cz - p.cz, cl = len(ddx, ddz) || 1;
            if (cl < 0.3) break;
            p.cx += (ddx / cl) * 0.3; p.cz += (ddz / cl) * 0.3;
          }
          const q = resolveSolids(p.cx, p.cz, S, true); p.cx = q.x; p.cz = q.z;
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
        if (p.y < 1.4 && p.y > -0.3 && !(p.phaseT > 0)) { const q = resolveSolids(p.x, p.z, S, false); p.x = q.x; p.z = q.z; }
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
      // obstacles, containers and raised drawbridges (a ghost dash goes straight through)
      if (!(p.phaseT > 0)) { const q = resolveSolids(nx, nz, S, true); nx = q.x; nz = q.z; }
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
            if (t.id === pr.owner || !t.alive || ally(owner, t)) continue;
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
          if (!dead) for (const b of g.world.walls) if (inRect(b, pr.x, pr.z, pr.rad)) { dead = true; break; }
        }
        if (!dead) {
          for (const t of Object.values(S.players)) {
            if (t.id === pr.owner || !t.alive || t.y > 2.2 || t.climbT > 0 || pr.hitIds.includes(t.id) || ally(owner, t)) continue;
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
      useWorld(g.world);
      if (S.phase === 'lobby') return;
      S.time += dt;
      worldAt(g.world, S.time);
      if (S.phase === 'over') return;
      carryAll();
      const rounds = S.mode === 'rounds';
      if (rounds && S.breakT > 0) {
        // between rounds: the survivor gets a short victory lap, then everyone drops back in
        S.breakT -= dt;
        if (S.breakT <= 0) { startRound(); return; }
      }
      if (!rounds) S.roundLeft -= dt;
      else if (S.breakT <= 0) {
        S.roundT += dt;
        if (S.roundT >= C.frenzyAt && S.roundT - dt < C.frenzyAt) emit('frenzy', {});
      }
      for (const p of Object.values(S.players)) if (p.bot) g.setInput(p.id, botThink(g, p, dt));
      for (const p of Object.values(S.players)) stepPlayer(p, g.inputs[p.id], dt);
      separatePlayers();
      stepGates(dt);
      stepProjectiles(dt);
      stepTraps(dt);
      stepWorld(dt);
      if (S.teams) { stepObjective(dt); if (S.phase !== 'play') return; }
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
      if (S.roundLeft <= 0 && S.teams) {
        const order = S.teamScore.map((v, t) => t).sort((a, b) => S.teamScore[b] - S.teamScore[a]);
        const tied = Math.floor(S.teamScore[order[0]]) === Math.floor(S.teamScore[order[1]]);
        if (tied && S.roundLeft > -60) { if (!S.overtime) { S.overtime = true; emit('overtime', {}); } }
        else teamWins(order[0]);
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
      useWorld(g.world);
      const r2 = (v) => Math.round(v * 100) / 100;
      return {
        map: S.map, gates: g.world.gates.map((gt) => (gt.pass ? 1 : 0)), buttons: g.world.buttons.map((b) => (b.down ? 1 : 0)),
        phase: S.phase, time: Math.round(S.time * 1000) / 1000, roundLeft: r2(S.roundLeft), roundSeconds: S.roundSeconds, overtime: !!S.overtime, winner: S.winner,
        teams: S.teams, teamScore: S.teamScore.map((v) => Math.floor(v * 10) / 10), winTeam: S.winTeam,
        goal: S.mode === 'team' ? C.teamKOs : S.mode === 'koth' ? C.kothWin : S.mode === 'ctf' ? C.ctfCaps : 0,
        hill: S.hill ? Object.assign(hillPos(), { t: r2(S.hill.t), owner: S.hill.owner, contested: S.hill.contested }) : null,
        flags: S.flags.map((f) => ({ team: f.team, x: r2(f.x), z: r2(f.z), hx: f.hx, hz: f.hz, state: f.state, carrier: f.carrier })),
        bases: S.teams ? teamBases() : null,
        mode: S.mode, round: S.round, roundT: r2(S.roundT), breakT: r2(S.breakT), roundWinner: S.roundWinner, winRounds: C.winRounds, roundCap: C.roundCap,
        players: Object.values(S.players).map((p) => ({
          id: p.id, name: p.name, color: p.color, bot: p.bot, x: r2(p.x), z: r2(p.z), y: r2(p.y), ax: r2(p.ax), az: r2(p.az),
          hp: Math.max(0, Math.round(p.hp)), armor: Math.round(p.armor), alive: p.alive, out: p.respawnT === Infinity, air: p.air, swim: p.swim, climbT: r2(p.climbT), respawnT: p.respawnT === Infinity ? -1 : r2(p.respawnT), dashN: p.dashN, dashRT: r2(p.dashRT), dashIF: r2(p.dashIF), invulnT: r2(p.invulnT),
          hasRod: p.hasRod, weapon: p.weapon, cd: r2(p.cd), dashCd: r2(p.dashCd), dashT: r2(p.dashT), slowT: r2(p.slowT), stunT: r2(p.stunT), freezeT: r2(p.freezeT), splatT: r2(p.splatT), blindT: r2(p.blindT), phaseT: r2(p.phaseT), dotT: r2(p.dotT), swingT: r2(p.swingT),
          fishing: p.fishing ? { depth: r2(p.fishing.depth), mult: p.fishing.mult, bx: r2(p.fishing.bx), bz: r2(p.fishing.bz), dx: p.fishing.dx, dz: p.fishing.dz, reelT: r2(p.fishing.reelT), tip: p.fishing.tip, biteT: r2(p.fishing.biteT) } : null,
          bubble: p.bubble, lure: p.lure, gadget: p.gadget, roundWins: p.roundWins, team: p.team, carry: p.carry, kos: p.kos, deaths: p.deaths, caught: p.caught,
          vx: r2(p.vx), vz: r2(p.vz), kbT: r2(p.kbT), ack: g.inputs[p.id] ? g.inputs[p.id].seq : null,
        })),
        traps: S.traps.map((t) => ({ id: t.id, kind: t.kind, owner: t.owner, x: r2(t.x), z: r2(t.z), life: r2(t.life), armed: !(t.arm > 0), rot: t.rot ? r2(t.rot) : 0 })),
        projectiles: S.projectiles.map((p) => ({ id: p.id, w: p.w, back: p.back || undefined, x: r2(p.x), z: r2(p.z), h: p.h ? r2(p.h) : 0, vx: r2(p.vx || 0), vz: r2(p.vz || 0) })),
        items: S.items.map((i) => ({ id: i.id, kind: i.kind, weapon: i.weapon, x: r2(i.x), z: r2(i.z), y: r2(i.y || 0) })),
        pelicans: S.pelicans.map((p) => ({ id: p.id, x: r2(p.x), z: r2(p.z), dx: p.dx, dz: p.dz, tx: p.tx, tz: p.tz, kind: p.kind, dropped: p.dropped })),
        rack: g.world.map.racks.map((_, k) => S.rack.filter((r) => r.k === k).map((r) => r.ready)),
      };
    };

    return g;
  }

  // ---------------------------------------------------------------- bot
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
      // swim (or drift) back to the boards, preferring ones on the way to wherever we were headed
      b.spot = null;
      let t = nearestPlatformPoint(p.x + p.vx * (p.air ? 0.4 : 0), p.z + p.vz * (p.air ? 0.4 : 0));
      if (p.swim && b.goal) {
        const gx = b.goal.x - p.x, gz = b.goal.z - p.z, gl = len(gx, gz) || 1, k = Math.min(gl, 6) / gl;
        const ahead = nearestPlatformPoint(p.x + gx * k, p.z + gz * k);
        if (len(ahead.x - p.x, ahead.z - p.z) < len(t.x - p.x, t.z - p.z) + 4) t = ahead;
      }
      const dx = t.x - p.x, dz = t.z - p.z, d = len(dx, dz) || 1;
      out.mx = dx / d; out.mz = dz / d;
      // hop out of the water once the boards are in reach
      if (p.swim && d < 4.5 && p.dashN > 0 && Math.random() < 0.15) out.dash = true;
      return out;
    }

    let enemy = null, ed = 999;
    for (const o of Object.values(S.players)) {
      if (o === p || !o.alive || o.air || o.climbT > 0 || (S.teams && o.team === p.team)) continue;
      const d = len(o.x - p.x, o.z - p.z);
      if (d < ed) { ed = d; enemy = o; }
    }
    // team games: what the team needs from us right now (null = play it like free-for-all)
    let obj = null;
    if (S.mode === 'ctf') {
      const own = S.flags[p.team];
      if (p.carry != null) obj = { x: own.hx, z: own.hz, always: true, stop: 0.4 };
      else if (own && own.state === 'dropped' && len(own.x - p.x, own.z - p.z) < 30) obj = { x: own.x, z: own.z, always: true, stop: 0.3 };
      else if (own && own.state === 'carried' && S.players[own.carrier]) { enemy = S.players[own.carrier]; ed = len(enemy.x - p.x, enemy.z - p.z); }
      else if (b.role === 0 && p.weapon) {
        let f = null, fd = 1e9;
        for (const q of S.flags) if (q.team !== p.team && q.state !== 'carried' && len(q.x - p.x, q.z - p.z) < fd) { fd = len(q.x - p.x, q.z - p.z); f = q; }
        if (f) obj = { x: f.x, z: f.z, stop: 0.3 };
      }
    } else if (S.mode === 'koth' && S.hill && (p.weapon || b.role === 0)) {
      const h = g.world.map.hills[S.hill.i];
      const m = h.m != null ? g.world.movers[h.m] : null;
      obj = { x: m ? m.x : h.x, z: m ? m.z : h.z, stop: h.r * 0.5 };
    }
    const enemyArmed = enemy && enemy.weapon;

    const moveTo = (tx, tz, stopAt) => {
      b.goal = { x: tx, z: tz };
      const d = len(tx - p.x, tz - p.z);
      if (d < (stopAt || 0.3)) return true;
      const n = navRoute(p.x, p.z, tx, tz);
      let dx = n.x - p.x, dz = n.z - p.z;
      const nd = len(dx, dz) || 1;
      dx /= nd; dz /= nd;
      // steer around barrels and racks
      for (const o of g.world.map.solids) {
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
      // water in the way: take a dash link, hop to a raft or deck in reach, or (now and then) jump in and swim
      if (p.dashN > 0 && p.dashCd <= 0 && d > 2 && !onPlatform(p.x + dx * 1.1, p.z + dz * 1.1, 0.2)) {
        const landing = [2.5, 3.5, 4.5, 5.5, 6.5].some((k) => onPlatformPoint(p.x + dx * k, p.z + dz * k));
        if (n.dash || landing || (n.direct && d < 22 && Math.random() < 0.03)) out.dash = true;
      }
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

    const enemyArmed0 = enemy && enemy.weapon;
    if (obj && (obj.always || !enemy || ed > 7 || !p.weapon) && !p.fishing) {
      // head for the objective; shoot anyone in reach on the way
      moveTo(obj.x, obj.z, obj.stop);
      if (p.weapon && enemy && ed < 9) {
        const tx = enemy.x - p.x, tz = enemy.z - p.z, tl = len(tx, tz) || 1;
        out.ax = tx / tl; out.az = tz / tl; out.aimDist = ed;
        if (Math.random() < skill.fireRate) out.fire = true;
      } else if (len(out.mx, out.mz) > 0.1) { out.ax = out.mx; out.az = out.mz; }
      if (enemyArmed0 && ed < 5 && p.dashN > 0 && Math.random() < 0.05) out.dash = true;
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
      let routed = true;
      if (bestItem && bestItem.kind !== 'fish' && len(bestItem.x - p.x, bestItem.z - p.z) < 5) {
        moveTo(bestItem.x, bestItem.z);
      } else if (ed > want + 1) moveTo(enemy.x, enemy.z);
      else if (!(routed = false)) { /* unreachable */ }
      else if (ed < want - 1.5 && !melee) { out.mx = -tx / tl; out.mz = -tz / tl; }
      else { out.mx = (-tz / tl) * b.strafe * 0.7; out.mz = (tx / tl) * b.strafe * 0.7; }
      // don't hug the edge while fighting: drift back toward the middle when near water
      if (!routed && !onPlatform(p.x + out.mx * 1.5, p.z + out.mz * 1.5, 0.8)) {
        const home = homeNear(p.x, p.z);
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
      const home = homeNear(p.x, p.z), hx = home.x - p.x, hz = home.z - p.z, hl = len(hx, hz) || 1;
      out.mx = -tx / tl * 0.6 + hx / hl * 0.4; out.mz = -tz / tl * 0.6 + hz / hl * 0.4;
      out.dash = true;
      return out;
    }

    if (bestItem) { moveTo(bestItem.x, bestItem.z); return out; }

    if (!p.hasRod) {
      let rk = null, rd = 1e9;
      for (const r of g.world.map.racks) { const d = navDist(p.x, p.z, r.x, r.z); if (d < rd) { rd = d; rk = r; } }
      moveTo(rk.x, rk.z, 1.5);
      return out;
    }

    // --- go fishing
    if (!b.spot) {
      let best = null, bs = -1e9;
      for (const s of g.world.map.fishSpots) {
        let score = -navDist(p.x, p.z, s.x, s.z) * 0.5 + Math.random() * 6;
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

  return { TEAM_MODES, TEAM_COLORS, TEAM_NAMES, rarityOdds, walkStep, nearestPlatformPoint, MAPS, makeWorld, useWorld, worldAt, moverPos, refreshWalls, GADGETS, BYCATCH, CFG, WEAPONS, TIERS, RARITIES, RARITY_COLORS, DROPS, BY_RARITY, createGame, onPlatform, onPlatformPoint, tierFor, waterDirection, isPierTip };
});
