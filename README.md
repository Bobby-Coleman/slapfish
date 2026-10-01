# Slap Fish

A multiplayer pier brawler where every fish is a weapon. Grab a rod, cast off the pier, and fight with whatever you reel in. The longer your line stays in, the rarer the fish, but one hit snaps your line.

## Play

**Solo vs bots:** open `dist/slapfish.html` in a browser (it needs internet to load Three.js from a CDN).

**Online with friends:**

```bash
npm install
npm start            # http://localhost:8080
```

Open the printed address, pick "Play online with friends", and join a room. Friends on your network use `http://<your-ip>:8080`. For friends elsewhere, host the server somewhere public (any Node host works; it serves the client and the WebSocket on one port, set with `PORT`).

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Attack with your fish (or slap) |
| R or right click | Cast, then reel in |
| Space | Dash (also bails out of fishing) |
| E | Swap your fish for one on the ground |
| Esc | Pause (solo) |
| M | Mute |

## Code layout

| Path | What it is |
|---|---|
| `shared/sim.js` | The whole game simulation and all balance numbers. Runs in the browser (solo) and on the server (online). |
| `client/` | Three.js renderer, HUD, input, and the solo / online sources. |
| `server/server.js` | Node HTTP + WebSocket server with rooms. Authoritative 30 Hz sim, 15 Hz snapshots. |
| `tools/build.js` | `npm run build`: inlines everything into `dist/slapfish.html`. |
| `tools/simtest.js` | `npm run sim`: headless bot-vs-bot rounds that print balance stats. |
| `docs/DESIGN.md` | Game design and balance tables. |
