// Slap Fish online server: serves the client and runs one authoritative simulation per room.
// Usage: npm start   (PORT env var, default 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('../shared/sim.js');

const PORT = +process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..');
const TICK = 1 / Sim.CFG.tickRate;
const SNAP_EVERY = 2; // broadcast every 2nd tick = 15 snapshots/s, clients interpolate
const MAX_PLAYERS = 8;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '') { res.writeHead(302, { Location: '/client/' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '') }); return res.end(); }
  if (url.endsWith('/')) url += 'index.html';
  const file = path.normalize(path.join(ROOT, url));
  const allowed = ['client', 'shared', 'dist', 'docs'].some((d) => file.startsWith(path.join(ROOT, d) + path.sep));
  if (!allowed) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) {
    r = { name, game: Sim.createGame({}), clients: new Map(), host: null, tick: 0, events: [] };
    rooms.set(name, r);
  }
  return r;
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function lobby(r) {
  const s = r.game.state;
  const msg = { t: 'lobby', host: r.host, phase: s.phase, players: Object.values(s.players).map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot })) };
  for (const ws of r.clients.values()) send(ws, msg);
}

let nextId = 1;
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let room = null, id = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.t === 'join' && !room) {
      room = getRoom(String(msg.room || 'pier').slice(0, 20));
      const humans = Object.values(room.game.state.players).filter((p) => !p.bot).length;
      if (humans >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(); return; }
      id = 'p' + nextId++;
      room.clients.set(id, ws);
      room.game.addPlayer(id, String(msg.name || 'Angler'), false);
      if (!room.host || !room.clients.has(room.host)) room.host = id;
      send(ws, { t: 'welcome', id, room: room.name });
      lobby(room);
      console.log(`[${room.name}] ${msg.name} joined (${room.clients.size} connected)`);
    } else if (!room) {
      return;
    } else if (msg.t === 'input') {
      room.game.setInput(id, msg.i || {});
    } else if (msg.t === 'start' && id === room.host) {
      const g = room.game;
      if (msg.round) g.state.roundSeconds = Math.max(60, Math.min(1200, +msg.round));
      // replace bots with the requested count
      for (const p of Object.values(g.state.players)) if (p.bot) g.removePlayer(p.id);
      const names = ['Captain Cod', 'Salty Sue', 'Barnacle Bo', 'Gill Bates'];
      const bots = msg.bots != null ? Math.max(0, Math.min(4, +msg.bots)) : room.lastBots || 0;
      room.lastBots = bots;
      for (let i = 0; i < bots; i++) g.addPlayer('bot' + i, names[i], true, 'normal');
      g.start();
      lobby(room);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(id);
    room.game.removePlayer(id);
    if (room.host === id) room.host = room.clients.keys().next().value || null;
    if (room.clients.size === 0) rooms.delete(room.name);
    else lobby(room);
  });
});

setInterval(() => {
  for (const r of rooms.values()) {
    r.game.step(TICK);
    r.events.push(...r.game.drainEvents());
    if (++r.tick % SNAP_EVERY === 0 && r.game.state.phase !== 'lobby') {
      const msg = JSON.stringify({ t: 'snap', s: r.game.snapshot(), e: r.events });
      r.events = [];
      for (const ws of r.clients.values()) if (ws.readyState === 1) ws.send(msg);
    }
  }
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`Slap Fish server on http://localhost:${PORT}  (friends on your network: http://<your-ip>:${PORT})`);
});
