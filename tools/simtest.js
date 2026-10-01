// Headless balance run: bots play full rounds and we print the numbers the design doc targets.
// usage: node tools/simtest.js [rounds] [bots] [difficulty] ['{"kbScale":0.7}']
const Sim = require('../shared/sim.js');
const rounds = +process.argv[2] || 6, nBots = +process.argv[3] || 2, diff = process.argv[4] || 'normal';
const cfg = process.argv[5] ? JSON.parse(process.argv[5]) : {};
const A = { catches: {}, tiers: {}, kills: {}, kos: 0, splash: 0, blast: 0, fish: 0, deaths: 0, drops: {}, castTime: 0, casts: 0, snaps: 0, gadgets: {}, used: {}, trig: {} };
for (let r = 0; r < rounds; r++) {
  const g = Sim.createGame({ roundSeconds: 600, cfg });
  for (let i = 0; i < nBots; i++) g.addPlayer('b' + i, 'Bot' + i, true, diff);
  g.start();
  const castAt = {};
  while (g.state.phase === 'play') {
    const held = {};
    for (const p of Object.values(g.state.players)) held[p.id] = p.weapon ? p.weapon.id : 'slap';
    g.step(1 / 30);
    for (const e of g.drainEvents()) {
      if (e.type === 'catch') { A.catches[e.w] = (A.catches[e.w] || 0) + 1; A.tiers[e.tier] = (A.tiers[e.tier] || 0) + 1; A.fish++; A.castTime += e.depth; A.casts++; }
      if (e.type === 'snap') A.snaps++;
      if (e.type === 'gadget') A.gadgets[e.g] = (A.gadgets[e.g] || 0) + 1;
      if (e.type === 'usegadget') A.used[e.g] = (A.used[e.g] || 0) + 1;
      if ((e.type === 'boom' && e.mine) || e.type === 'zapjelly' || e.type === 'spike' || e.type === 'spit') { const k = e.mine ? 'mine' : e.type; A.trig[k] = (A.trig[k] || 0) + 1; }
      if (e.type === 'splash' && e.id) A.splash++;
      if (e.type === 'drop') A.drops[e.kind] = (A.drops[e.kind] || 0) + 1;
      if (e.type === 'ko') { A.kos++; A.deaths++; A[e.cause]++; if (e.by) { const w = held[e.by]; A.kills[w] = (A.kills[w] || 0) + 1; } }
    }
  }
}
const per = (v) => +(v / rounds / nBots).toFixed(1);
console.log(`players=${nBots} rounds=${rounds} diff=${diff} cfg=${JSON.stringify(cfg)}`);
console.log(`per player per 10 min: fish ${per(A.fish)}, deaths ${per(A.deaths)} (splashdowns ${per(A.splash)}), line snaps ${per(A.snaps)}`);
console.log(`avg depth reeled ${(A.castTime / A.casts).toFixed(1)}s; tiers ${JSON.stringify(A.tiers)}`);
const rows = Object.keys(Sim.WEAPONS).map((w) => [w, Sim.WEAPONS[w].rarity, A.catches[w] || 0, A.kills[w] || 0, A.catches[w] ? ((A.kills[w] || 0) / A.catches[w]).toFixed(2) : '-']);
console.log('weapon       rarity     caught kills kills/fish');
for (const r of rows) console.log(r[0].padEnd(12), r[1].padEnd(10), String(r[2]).padStart(6), String(r[3]).padStart(5), String(r[4]).padStart(10));
console.log(`gadgets found ${JSON.stringify(A.gadgets)}`);
console.log(`gadget charges used ${JSON.stringify(A.used)}; triggers ${JSON.stringify(A.trig)}`);
