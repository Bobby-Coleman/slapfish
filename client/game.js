// Slap Fish - browser client: rendering, input, HUD, and either a local sim (vs bots) or an online connection.
import * as THREE from 'three';

const Sim = window.SlapSim;
const { WEAPONS, TIERS, RARITIES, RARITY_COLORS, DROPS, GADGETS, MAPS, CFG } = Sim;
const STEP = 1 / 30;
const WATER_Y = -0.9;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fdcf5');
scene.fog = new THREE.Fog('#8fdcf5', 70, 160);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(0, 26, 20);

scene.add(new THREE.HemisphereLight('#fff6e0', '#2a7fa8', 1.4));
const sun = new THREE.DirectionalLight('#fff3d6', 2.2);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 90 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 70 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// toon materials
const grad = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const matCache = {};
function mat(color, opts) {
  const key = color + JSON.stringify(opts || {});
  if (!matCache[key]) matCache[key] = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: grad }, opts || {}));
  return matCache[key];
}
function mesh(geo, color, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ world
function waveH(x, z, t) {
  return Math.sin(x * 0.16 + t * 1.3) * 0.22 + Math.cos(z * 0.19 + t * 1.0) * 0.18 + Math.sin((x + z) * 0.07 + t * 0.6) * 0.15;
}

const oceanGeo = new THREE.PlaneGeometry(320, 320, 110, 110);
oceanGeo.rotateX(-Math.PI / 2);
{
  const pos = oceanGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const shallow = new THREE.Color('#47e3d2'), mid = new THREE.Color('#1fa3c9'), deep = new THREE.Color('#164f96');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // distance from the walkable area: shallows hug the pier, deep water sits past the tips
    const d = Math.min(Math.hypot(x, z), 999);
    const k = Math.min(1, Math.max(0, (d - 14) / 18));
    if (k < 0.5) c.copy(shallow).lerp(mid, k * 2); else c.copy(mid).lerp(deep, (k - 0.5) * 2);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  oceanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
const ocean = new THREE.Mesh(oceanGeo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad }));
ocean.position.y = WATER_Y;
ocean.receiveShadow = true;
scene.add(ocean);
const oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
function animateOcean(t) {
  const arr = oceanGeo.attributes.position.array;
  for (let i = 0; i < arr.length; i += 3) arr[i + 1] = waveH(oceanBase[i], oceanBase[i + 2], t);
  oceanGeo.attributes.position.needsUpdate = true;
  oceanGeo.computeVertexNormals();
}

// ------------------------------------------------------------------ map
// Everything on the map is built from the sim's map data: decks, posts, cover, rod racks, drawbridges,
// floor buttons, portal pads, rafts and barges. Rebuilt whenever the map changes (the menu preview too).
const woodA = '#d9a066', woodB = '#c98d55', woodC = '#b97c47', postCol = '#7a5230';
const postGeo = new THREE.CylinderGeometry(0.28, 0.32, 3.2, 6);
const GATE_COLORS = ['#ffd23f', '#ff6bcb', '#3fa7ff', '#5ee07a'];
const PORTAL_COLORS = ['#c86bff', '#2ee6d6'];
const CONTAINER_COLORS = ['#e8613c', '#3fa7ff', '#5ccf6b', '#ffb22e'];
let mapGroup = null, mapView = null;

function plankStrip(parent, x0, x1, z0, z1, alongX, y) {
  // planks run perpendicular to "along"
  const n = Math.max(1, Math.round(alongX ? x1 - x0 : z1 - z0));
  const step = (alongX ? x1 - x0 : z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const col = [woodA, woodB, woodC][(i * 7 + (alongX ? 1 : 0)) % 3];
    const w = step * 0.94;
    const geo = alongX ? new THREE.BoxGeometry(w, 0.4, z1 - z0) : new THREE.BoxGeometry(x1 - x0, 0.4, w);
    const m = mesh(geo, col);
    if (alongX) m.position.set(x0 + (i + 0.5) * step, (y || 0) - 0.2, (z0 + z1) / 2);
    else m.position.set((x0 + x1) / 2, (y || 0) - 0.2, z0 + (i + 0.5) * step);
    parent.add(m);
  }
}
function makeSign(text, x, z, rotY, parent, bg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg || '#164f96'; ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  // two faces back to back so the words read the right way round from both sides
  const board = new THREE.Group();
  for (const r of [0, Math.PI]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ map: tex })); f.rotation.y = r; board.add(f); }
  board.position.y = 1.6;
  const pole = mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), postCol);
  pole.position.y = 0.8;
  g.add(board, pole);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  (parent || scene).add(g);
  return g;
}
function makeRod() {
  const g = new THREE.Group();
  const stick = mesh(new THREE.CylinderGeometry(0.035, 0.06, 2.4, 5), '#2b2b3a');
  stick.position.y = 1.2;
  const grip = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), '#ff9f43');
  grip.position.y = 0.25;
  const reel = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), '#cfd8dc');
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0.1, 0.6, 0);
  const tip = new THREE.Object3D();
  tip.position.y = 2.4;
  g.add(stick, grip, reel, tip);
  g.userData.tip = tip;
  return g;
}
function makeBuoy() {
  const b = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 8), '#ff5a5f');
  const band = mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.3, 8), '#ffffff');
  band.position.y = 0.1;
  const flag = mesh(new THREE.BoxGeometry(0.05, 0.6, 0.8), '#164f96');
  flag.position.set(0, 1.3, 0.35);
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), '#ffffff');
  pole.position.y = 1.1;
  b.add(body, band, pole, flag);
  return b;
}
function inR(r, x, z) { return x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]; }

// shallows hug the docks (the lagoon glows turquoise), deep blue out at sea
function recolorOcean(M) {
  const pos = oceanGeo.attributes.position, colors = oceanGeo.attributes.color;
  const shallow = new THREE.Color('#47e3d2'), mid = new THREE.Color('#1fa3c9'), deep = new THREE.Color('#164f96'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = oceanBase[i * 3], z = oceanBase[i * 3 + 2];
    let d = 1e9;
    for (const r of M.rects) d = Math.min(d, Math.hypot(x - Math.max(r[0], Math.min(r[1], x)), z - Math.max(r[2], Math.min(r[3], z))));
    const k = Math.min(1, Math.max(0, (d - 1) / 16));
    if (k < 0.5) c.copy(shallow).lerp(mid, k * 2); else c.copy(mid).lerp(deep, (k - 0.5) * 2);
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
}

function buildMap(w) {
  if (mapGroup) scene.remove(mapGroup);
  const M = w.map;
  mapGroup = new THREE.Group();
  scene.add(mapGroup);
  mapView = { id: M.id, world: w, movers: [], gates: [], buttons: [], portals: [], racks: [], buoys: [] };
  const onDeck = (x, z) => M.rects.some((r) => inR(r, x, z)) || M.gates.some((g) => inR(g.r, x, z));
  // decks and the posts holding them up (only along edges that face water)
  for (const r of M.rects) {
    plankStrip(mapGroup, r[0], r[1], r[2], r[3], r[1] - r[0] >= r[3] - r[2]);
    const edge = (x, z, ox, oz) => { if (!onDeck(x + ox, z + oz)) { const p = mesh(postGeo, postCol); p.position.set(x, -1.3, z); mapGroup.add(p); } };
    for (let x = r[0]; x <= r[1] + 0.01; x += Math.max(2, (r[1] - r[0]) / Math.ceil((r[1] - r[0]) / 4))) { edge(x, r[2], 0, -0.6); edge(x, r[3], 0, 0.6); }
    for (let z = r[2]; z <= r[3] + 0.01; z += Math.max(2, (r[3] - r[2]) / Math.ceil((r[3] - r[2]) / 4))) { edge(r[0], z, -0.6, 0); edge(r[1], z, 0.6, 0); }
  }
  for (const s of M.signs) makeSign(s.text, s.x, s.z, s.rot, mapGroup);
  for (const [x, z] of M.tipBuoys) { const b = makeBuoy(); b.position.set(x, WATER_Y, z); mapGroup.add(b); mapView.buoys.push(b); }
  // barrels
  for (const o of M.obstacles) {
    const g = new THREE.Group();
    const big = o.r > 0.8;
    const b = mesh(new THREE.CylinderGeometry(o.r, o.r, 1.4, 10), big ? '#e8613c' : '#3fa7ff');
    b.position.y = 0.7;
    const r1 = mesh(new THREE.CylinderGeometry(o.r + 0.04, o.r + 0.04, 0.12, 10), '#3b3b4f');
    r1.position.y = 0.3;
    const r2 = r1.clone(); r2.position.y = 1.1;
    g.add(b, r1, r2);
    g.position.set(o.x, 0, o.z);
    mapGroup.add(g);
  }
  // shipping containers (long) and crate stacks (small)
  M.boxes.forEach((b, i) => {
    const sx = b[1] - b[0], sz = b[3] - b[2], cx = (b[0] + b[1]) / 2, cz = (b[2] + b[3]) / 2;
    const g = new THREE.Group();
    if (sx * sz >= 6) {
      const col = CONTAINER_COLORS[i % CONTAINER_COLORS.length];
      const body = mesh(new THREE.BoxGeometry(sx, 2.5, sz), col);
      body.position.y = 1.25;
      g.add(body);
      const along = sx > sz;
      const n = Math.floor((along ? sx : sz) / 0.7);
      for (let k = 1; k < n; k++) {
        const rib = mesh(along ? new THREE.BoxGeometry(0.08, 2.3, sz + 0.08) : new THREE.BoxGeometry(sx + 0.08, 2.3, 0.08), '#2b2b3a', { transparent: true, opacity: 0.25 });
        if (along) rib.position.set(-sx / 2 + k * (sx / n), 1.25, 0); else rib.position.set(0, 1.25, -sz / 2 + k * (sz / n));
        rib.castShadow = false;
        g.add(rib);
      }
      const roof = mesh(new THREE.BoxGeometry(sx + 0.1, 0.12, sz + 0.1), '#ffffff', { transparent: true, opacity: 0.35 });
      roof.position.y = 2.52;
      g.add(roof);
    } else {
      const low = mesh(new THREE.BoxGeometry(sx, 1.3, sz), woodC);
      low.position.y = 0.65;
      const top = mesh(new THREE.BoxGeometry(sx * 0.7, 1, sz * 0.7), woodA);
      top.position.set(sx * 0.08, 1.8, -sz * 0.06);
      top.rotation.y = 0.35;
      g.add(low, top);
    }
    g.position.set(cx, 0, cz);
    mapGroup.add(g);
  });
  // rod racks
  M.racks.forEach((rk) => {
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.5, 8), '#7a5230');
    base.position.y = 0.25;
    const top = mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 6), '#7a5230');
    top.position.y = 1.4;
    const roof = mesh(new THREE.ConeGeometry(1.4, 0.8, 8), '#ff5a5f');
    roof.position.y = 2.9;
    g.add(base, top, roof);
    g.position.set(rk.x, 0, rk.z);
    mapGroup.add(g);
    makeSign('RODS', rk.x, rk.z, 0, mapGroup).position.y = 2.2;
    mapView.racks.push({ g, rods: [] });
  });
  // drawbridges: two leaves that swing up from either side of the gap
  M.gates.forEach((gt, i) => {
    const r = gt.r, col = GATE_COLORS[i % GATE_COLORS.length];
    const alongX = r[1] - r[0] <= r[3] - r[2]; // which way you walk across
    const span = alongX ? r[1] - r[0] : r[3] - r[2], wide = alongX ? r[3] - r[2] : r[1] - r[0];
    const cx = (r[0] + r[1]) / 2, cz = (r[2] + r[3]) / 2;
    const leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      if (alongX) pivot.position.set(side < 0 ? r[0] : r[1], 0, cz); else pivot.position.set(cx, 0, side < 0 ? r[2] : r[3]);
      const leaf = new THREE.Group();
      plankStrip(leaf, alongX ? 0 : -wide / 2, alongX ? span / 2 : wide / 2, alongX ? -wide / 2 : 0, alongX ? wide / 2 : span / 2, alongX);
      const stripe = mesh(alongX ? new THREE.BoxGeometry(0.3, 0.42, wide) : new THREE.BoxGeometry(wide, 0.42, 0.3), col);
      if (alongX) stripe.position.set(span / 2 - 0.15, -0.2, 0); else stripe.position.set(0, -0.2, span / 2 - 0.15);
      leaf.add(stripe);
      if (side > 0) leaf.rotation.y = Math.PI;
      pivot.add(leaf);
      mapGroup.add(pivot);
      leaves.push({ pivot, side });
    }
    // corner posts with a lamp: green when the bridge is down, red when it's up
    const lamps = [];
    const lampMat = new THREE.MeshBasicMaterial({ color: '#5ee07a' });
    for (const [x, z] of [[r[0], r[2]], [r[0], r[3]], [r[1], r[2]], [r[1], r[3]]]) {
      const post = mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.6, 6), col);
      post.position.set(x, 0.8, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
      lamp.position.set(x, 1.75, z);
      mapGroup.add(post, lamp);
      lamps.push(lamp);
    }
    mapView.gates.push({ leaves, alongX, ang: gt.def ? 0 : 1.2, lampMat });
  });
  // floor buttons, colour-coded to their bridge
  M.buttons.forEach((b) => {
    const col = GATE_COLORS[b.gate % GATE_COLORS.length];
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(b.r, b.r + 0.1, 0.12, 20), '#3b3b4f');
    base.position.y = 0.06;
    const cap = mesh(new THREE.CylinderGeometry(b.r * 0.72, b.r * 0.78, 0.22, 20), col);
    cap.position.y = 0.2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(b.r + 0.15, b.r + 0.3, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(base, cap, ring);
    g.position.set(b.x, 0, b.z);
    mapGroup.add(g);
    mapView.buttons.push({ cap, ring });
  });
  // portal pads: a swirling disc and a column of light, same colour at both ends
  M.portals.forEach((q, i) => {
    const col = PORTAL_COLORS[i % PORTAL_COLORS.length];
    for (const e of [q.a, q.b]) {
      const g = new THREE.Group();
      const rim = mesh(new THREE.TorusGeometry(0.95, 0.13, 8, 28), col);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.08;
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = col; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = '#ffffff'; x.lineWidth = 7; x.globalAlpha = 0.8;
      for (let arm = 0; arm < 3; arm++) { x.beginPath(); for (let k = 0; k < 40; k++) { const a = arm * 2.09 + k * 0.16, rr = k * 1.5; x.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr); } x.stroke(); }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.88, 28), new THREE.MeshBasicMaterial({ map: tex }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      glow.position.y = 1.2;
      g.add(rim, disc, glow);
      g.position.set(e[0], 0, e[1]);
      mapGroup.add(g);
      mapView.portals.push({ disc, glow });
    }
  });
  // rafts (lashed logs) and barges (a little deck on a hull with tyre bumpers)
  w.movers.forEach((m) => {
    const g = new THREE.Group();
    if (m.kind === 'barge') {
      const hull = mesh(new THREE.BoxGeometry(m.hw * 2 - 0.1, 0.7, m.hd * 2 - 0.1), '#e8613c');
      hull.position.y = -0.7;
      g.add(hull);
      plankStrip(g, -m.hw, m.hw, -m.hd, m.hd, true);
      for (const [x, z] of [[-m.hw, 0], [m.hw, 0], [0, -m.hd], [0, m.hd]]) {
        const tyre = mesh(new THREE.TorusGeometry(0.28, 0.12, 6, 12), '#2b2b3a');
        tyre.position.set(x * 1.02, -0.45, z * 1.02);
        tyre.rotation.y = x ? Math.PI / 2 : 0;
        g.add(tyre);
      }
    } else {
      const n = Math.max(3, Math.round((m.hw * 2) / 0.55));
      for (let k = 0; k < n; k++) {
        const log = mesh(new THREE.CylinderGeometry(0.27, 0.27, m.hd * 2, 7), k % 2 ? '#9c6b3e' : '#b07a48');
        log.rotation.x = Math.PI / 2;
        log.position.set(-m.hw + (k + 0.5) * ((m.hw * 2) / n), -0.27, 0);
        g.add(log);
      }
      for (const z of [-m.hd * 0.6, m.hd * 0.6]) {
        const rope = mesh(new THREE.BoxGeometry(m.hw * 2 + 0.06, 0.1, 0.14), '#f5d78e');
        rope.position.set(0, 0.0, z);
        g.add(rope);
      }
      if (m.deep) {
        const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), '#ffffff');
        pole.position.set(m.hw - 0.3, 1.1, m.hd - 0.3);
        const flag = mesh(new THREE.BoxGeometry(0.05, 0.5, 0.8), '#164f96');
        flag.position.set(m.hw - 0.3, 1.95, m.hd - 0.7);
        g.add(pole, flag);
      }
    }
    mapGroup.add(g);
    mapView.movers.push({ m, g });
  });
  recolorOcean(M);
  updateMap(null, null, 1, 0, 1);
}

function updateMap(s, prev, alpha, t, dt) {
  if (!mapView) return;
  const tr = s ? (prev && prev.time <= s.time && s.time - prev.time < 1 ? prev.time + (s.time - prev.time) * alpha : s.time) : t;
  mapView.movers.forEach((v, i) => {
    const p = Sim.moverPos(v.m, tr);
    v.g.position.set(p.x, Math.sin(t * 1.7 + i) * 0.04, p.z);
    v.g.rotation.z = Math.sin(t * 1.3 + i) * 0.015;
  });
  mapView.gates.forEach((v, i) => {
    const down = s ? !!s.gates[i] : !!mapView.world.map.gates[i].def;
    v.ang += ((down ? 0 : 1.25) - v.ang) * Math.min(1, dt * 7);
    for (const l of v.leaves) {
      if (v.alongX) l.pivot.rotation.z = l.side < 0 ? v.ang : -v.ang;
      else l.pivot.rotation.x = l.side < 0 ? -v.ang : v.ang;
    }
    v.lampMat.color.set(down ? '#5ee07a' : '#ff5a5f');
  });
  mapView.buttons.forEach((v, i) => {
    const down = s && s.buttons ? !!s.buttons[i] : false;
    v.cap.position.y += ((down ? 0.06 : 0.2) - v.cap.position.y) * Math.min(1, dt * 14);
    v.ring.material.opacity = 0.45 + Math.sin(t * 4 + i) * 0.25;
  });
  for (const v of mapView.portals) { v.disc.rotation.z += dt * 2.5; v.glow.material.opacity = 0.14 + Math.sin(t * 3) * 0.06; }
  for (const b of mapView.buoys) { b.position.y = WATER_Y + waveH(b.position.x, b.position.z, t) - 0.2; b.rotation.z = Math.sin(t * 1.5 + b.position.x) * 0.15; }
  mapView.racks.forEach((rk, k) => {
    const slots = s && s.rack ? s.rack[k] || [] : [true, true, true];
    while (rk.rods.length < slots.length) { const r = makeRod(); rk.g.add(r); rk.rods.push(r); }
    const n = slots.length;
    rk.rods.forEach((r, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      r.position.set(Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85);
      r.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
      r.visible = i < n && !!slots[i];
    });
  });
}

// ------------------------------------------------------------------ team objectives
// Bases (a coloured pad and banner), golden-fish flags, and the hill ring for King of the Hill.
const TEAM_COLORS = Sim.TEAM_COLORS, TEAM_NAMES = Sim.TEAM_NAMES;
const objView = { key: '', group: null, bases: [], flags: [], hill: null };
function makeFlag(color) {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), '#ffffff');
  pole.position.y = 1.3;
  const cloth = mesh(new THREE.BoxGeometry(0.05, 0.7, 1.1), color);
  cloth.position.set(0, 2.2, 0.58);
  // the golden fish on top
  const body = mesh(new THREE.SphereGeometry(0.32, 10, 8), '#ffd23f', { emissive: '#7a5200' });
  body.scale.set(1, 0.7, 1.6);
  body.position.y = 2.85;
  const tail = mesh(new THREE.ConeGeometry(0.28, 0.45, 4), '#ffb22e');
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 2.85, -0.6);
  g.add(pole, cloth, body, tail);
  return g;
}
function syncObjectives(s, t, dt) {
  const key = s.teams ? `${s.mode}:${s.teams}:${s.map}` : '';
  if (key !== objView.key) {
    if (objView.group) scene.remove(objView.group);
    objView.key = key; objView.group = null; objView.bases = []; objView.flags = []; objView.hill = null;
    if (!key) return;
    objView.group = new THREE.Group();
    scene.add(objView.group);
    (s.bases || []).forEach((b, i) => {
      const col = TEAM_COLORS[i];
      const pad = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.8, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(b.x, 0.04, b.z);
      objView.group.add(pad);
      if (s.mode !== 'ctf') { const f = makeFlag(col); f.position.set(b.x, 0, b.z); f.children[2].visible = f.children[3].visible = false; objView.group.add(f); }
      objView.bases.push(pad);
    });
    if (s.mode === 'ctf') for (const f of s.flags) { const m = makeFlag(TEAM_COLORS[f.team]); objView.group.add(m); objView.flags.push(m); }
    if (s.mode === 'koth') {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 40, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      wall.position.y = 1.5;
      const crown = new THREE.Group();
      const band = mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.35, 10, 1, true), '#ffd23f', { emissive: '#6a4a00', side: THREE.DoubleSide });
      crown.add(band);
      for (let k = 0; k < 5; k++) { const sp = mesh(new THREE.ConeGeometry(0.12, 0.35, 4), '#ffd23f', { emissive: '#6a4a00' }); const a = (k / 5) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.45, 0.33, Math.sin(a) * 0.45); crown.add(sp); }
      crown.position.y = 4;
      g.add(ring, wall, crown);
      objView.group.add(g);
      objView.hill = { g, ring, wall, crown };
    }
  }
  if (!objView.group) return;
  for (const pad of objView.bases) pad.material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
  s.flags.forEach((f, i) => {
    const m = objView.flags[i];
    if (!m) return;
    if (f.state === 'carried') {
      const cv = views.players.get(f.carrier);
      if (cv) m.position.set(cv.x, (cv.y || 0) + 1.4, cv.z);
      m.scale.setScalar(0.7);
      m.rotation.y += dt * 4;
    } else {
      m.position.set(f.x, f.state === 'dropped' ? 0.1 + Math.abs(Math.sin(t * 4)) * 0.3 : 0, f.z);
      m.scale.setScalar(1);
      m.rotation.y += dt * (f.state === 'dropped' ? 3 : 0.6);
    }
  });
  if (objView.hill && s.hill) {
    const h = s.hill, v = objView.hill;
    let x = h.x, z = h.z;
    if (h.m != null && mapView && mapView.world.movers[h.m]) { const q = Sim.moverPos(mapView.world.movers[h.m], source.prev && source.prev.time <= s.time ? source.prev.time + (s.time - source.prev.time) * source.alpha : s.time); x = q.x; z = q.z; }
    v.g.position.set(x, 0, z);
    v.ring.scale.set(h.r, h.r, 1);
    v.wall.scale.set(h.r, 1, h.r);
    const col = h.contested ? (Math.sin(t * 14) > 0 ? '#ffffff' : '#ff5a5f') : h.owner >= 0 ? TEAM_COLORS[h.owner] : '#ffffff';
    v.ring.material.color.set(col); v.wall.material.color.set(col);
    v.wall.material.opacity = h.owner >= 0 ? 0.26 : 0.14;
    v.crown.rotation.y += dt * 1.5;
    v.crown.position.y = 3.8 + Math.sin(t * 2) * 0.25;
  }
}

// a ring of little buoys marks the edge of the map: get launched past it and you're out
const buoys = [];
for (let i = 0; i < 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  const b = mesh(new THREE.SphereGeometry(0.35, 8, 6), i % 2 ? '#ffd23f' : '#ff5a5f');
  b.position.set(Math.cos(a) * CFG.blastRadius, WATER_Y, Math.sin(a) * CFG.blastRadius);
  b.userData.phase = i;
  scene.add(b);
  buoys.push(b);
}

// scenery: islands, palms, clouds
function palm(x, z, s) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.15 * s, 0.25 * s, 3 * s, 5), '#9c6b3e');
  trunk.position.y = 1.5 * s;
  trunk.rotation.z = 0.15;
  g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const leaf = mesh(new THREE.ConeGeometry(0.35 * s, 2 * s, 4), '#3fbf5f');
    leaf.position.set(0.25 * s, 3 * s, 0);
    leaf.rotation.set(0, (i / 5) * Math.PI * 2, 1.9);
    leaf.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), (i / 5) * Math.PI * 2);
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}
function island(x, z, r) {
  const g = new THREE.Group();
  const sand = mesh(new THREE.CylinderGeometry(r * 0.8, r, 1.4, 9), '#f5d78e');
  sand.position.y = -0.6;
  g.add(sand);
  const grass = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.7, 0.6, 8), '#5ccf6b');
  grass.position.y = 0.2;
  g.add(grass);
  const n = Math.max(1, Math.round(r / 3));
  for (let i = 0; i < n; i++) g.add(palm((Math.random() - 0.5) * r * 0.6, (Math.random() - 0.5) * r * 0.6, 0.8 + Math.random() * 0.6));
  g.position.set(x, WATER_Y, z);
  scene.add(g);
}
island(-55, -42, 9); island(62, -30, 6); island(45, 55, 11); island(-60, 38, 5); island(-15, -75, 7); island(80, 20, 4);
const clouds = [];
for (let i = 0; i < 14; i++) {
  const c = new THREE.Group();
  for (let j = 0; j < 4; j++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + Math.random() * 2, 0), mat('#ffffff'));
    puff.position.set(j * 2.4 - 3.6, Math.random(), Math.random() * 1.5);
    c.add(puff);
  }
  c.position.set((Math.random() - 0.5) * 220, 28 + Math.random() * 10, (Math.random() - 0.5) * 220 - 40);
  scene.add(c);
  clouds.push(c);
}

// ------------------------------------------------------------------ models
const FISH_LOOK = {
  sardine: { body: '#b8c7d6', belly: '#eef3f7', len: 0.7, girth: 0.17 },
  mackerel: { body: '#2e8b7a', belly: '#dfe9e3', len: 0.95, girth: 0.21, stripes: '#174a40' },
  squid: { special: 'squid', body: '#ff7aa8' },
  puffer: { special: 'puffer', body: '#ffd23f' },
  swordfish: { body: '#3a6fd8', belly: '#c9dbff', len: 1.15, girth: 0.24, sword: 1.2 },
  tuna: { body: '#264d8c', belly: '#c0c8d8', len: 1.1, girth: 0.38, fins: '#ffd23f' },
  hammerhead: { special: 'hammer', body: '#8896a6', belly: '#e8ecef', len: 1.3, girth: 0.3 },
  eel: { special: 'eel', body: '#c8e04a' },
  shark: { body: '#7f8fa3', belly: '#f4f4f4', len: 1.3, girth: 0.34, dorsal: true },
  narwhal: { body: '#ffcc33', belly: '#fff1b0', len: 1.2, girth: 0.32, horn: 1.1 },
  boomerang: { body: '#2e8b7a', belly: '#dfe9e3', len: 0.95, girth: 0.2, stripes: '#174a40', bend: true },
  herring: { body: '#7f9cc2', belly: '#eef3f7', len: 0.9, girth: 0.22, fins: '#5b7aa3' },
  icecod: { body: '#9fe8ff', belly: '#ffffff', len: 0.95, girth: 0.26, fins: '#d9f7ff', icy: true },
  ghost: { body: '#d8d0ff', belly: '#ffffff', len: 0.95, girth: 0.12, wide: 2.6, ghost: true },
  angler: { body: '#4a3b5c', belly: '#6b5a80', len: 0.8, girth: 0.4, lure: true, teeth: true },
  mantis: { body: '#ff5a8a', belly: '#ffd23f', len: 0.9, girth: 0.2, stripes: '#3fd1ff', claws: true },
  kraken: { special: 'kraken', body: '#8a2be2' },
};
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const lowSphere = new THREE.SphereGeometry(1, 7, 5);

function makeFish(id) {
  const L = FISH_LOOK[id] || FISH_LOOK.sardine;
  const g = new THREE.Group();
  const eye = (x, y, z, s) => { const e = mesh(lowSphere, '#10223a'); e.scale.setScalar(s); e.position.set(x, y, z); g.add(e); };
  if (L.special === 'squid') {
    const mantle = mesh(new THREE.ConeGeometry(0.28, 0.9, 7), L.body);
    mantle.rotation.x = Math.PI / 2;
    mantle.position.z = 0.35;
    g.add(mantle);
    for (let i = 0; i < 6; i++) {
      const t = mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.6, 4), '#ff9cc0');
      const a = (i / 6) * Math.PI * 2;
      t.rotation.x = Math.PI / 2;
      t.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, -0.35);
      g.add(t);
    }
    eye(0.2, 0.05, -0.05, 0.07); eye(-0.2, 0.05, -0.05, 0.07);
    return g;
  }
  if (L.special === 'puffer') {
    const b = mesh(new THREE.IcosahedronGeometry(0.36, 0), L.body);
    g.add(b);
    const spikeGeo = new THREE.ConeGeometry(0.05, 0.18, 4);
    const ico = new THREE.IcosahedronGeometry(0.36, 0).attributes.position;
    for (let i = 0; i < ico.count; i += 3) {
      const v = new THREE.Vector3(ico.getX(i), ico.getY(i), ico.getZ(i));
      const s = mesh(spikeGeo, '#f2a33a');
      s.position.copy(v.clone().multiplyScalar(1.05));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      g.add(s);
    }
    eye(0.15, 0.1, 0.3, 0.06); eye(-0.15, 0.1, 0.3, 0.06);
    const tail = mesh(new THREE.ConeGeometry(0.12, 0.25, 4), '#f2a33a');
    tail.rotation.x = -Math.PI / 2; tail.position.z = -0.45;
    g.add(tail);
    return g;
  }
  if (L.special === 'kraken') {
    const head = mesh(sphereGeo, L.body);
    head.scale.set(0.35, 0.42, 0.35); head.position.z = 0.2;
    g.add(head);
    for (let i = 0; i < 8; i++) {
      const t = mesh(new THREE.CylinderGeometry(0.05, 0.015, 0.75, 4), '#b05cff');
      const a = (i / 8) * Math.PI * 2;
      t.rotation.x = Math.PI / 2 + Math.sin(a) * 0.3;
      t.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.17, -0.3);
      g.add(t);
    }
    eye(0.16, 0.12, 0.45, 0.07); eye(-0.16, 0.12, 0.45, 0.07);
    return g;
  }
  if (L.special === 'eel') {
    for (let i = 0; i < 6; i++) {
      const s = mesh(sphereGeo, i === 0 ? '#e8f56a' : L.body);
      const r = 0.15 - i * 0.015;
      s.scale.set(r, r, r * 1.6);
      s.position.set(Math.sin(i * 1.2) * 0.1, 0, 0.5 - i * 0.22);
      s.userData.wiggle = i;
      g.add(s);
    }
    eye(0.09, 0.07, 0.6, 0.04); eye(-0.09, 0.07, 0.6, 0.04);
    g.userData.eel = true;
    return g;
  }
  const len = L.len, gi = L.girth;
  const body = mesh(sphereGeo, L.body, L.ghost ? { transparent: true, opacity: 0.75 } : L.icy ? { emissive: '#3fb8ff', emissiveIntensity: 0.25 } : undefined);
  body.scale.set(gi * 0.8 * (L.wide || 1), gi, len / 2);
  if (L.bend) body.rotation.y = 0.35;
  g.add(body);
  const belly = mesh(sphereGeo, L.belly);
  belly.scale.set(gi * 0.7, gi * 0.6, len / 2 * 0.85);
  belly.position.y = -gi * 0.35;
  g.add(belly);
  const tail = mesh(new THREE.ConeGeometry(gi * 0.9, len * 0.32, 4), L.fins || L.body);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.x = 0.3;
  tail.position.z = -len / 2 - len * 0.1;
  g.add(tail);
  eye(gi * 0.55, gi * 0.3, len * 0.33, Math.max(0.04, gi * 0.18));
  eye(-gi * 0.55, gi * 0.3, len * 0.33, Math.max(0.04, gi * 0.18));
  if (L.stripes) for (let i = 0; i < 3; i++) {
    const s = mesh(new THREE.BoxGeometry(gi * 1.65, gi * 0.25, 0.04), L.stripes);
    s.position.set(0, gi * 0.55, -0.15 + i * 0.15);
    g.add(s);
  }
  if (L.sword) {
    const sw = mesh(new THREE.ConeGeometry(0.05, L.sword, 5), '#dfe7ff');
    sw.rotation.x = Math.PI / 2;
    sw.position.z = len / 2 + L.sword / 2 - 0.05;
    g.add(sw);
    const fin = mesh(new THREE.ConeGeometry(0.15, 0.5, 3), L.body);
    fin.position.set(0, gi + 0.15, 0);
    fin.scale.z = 2;
    g.add(fin);
  }
  if (L.horn) {
    const h = mesh(new THREE.ConeGeometry(0.07, L.horn, 6), '#fffbe0');
    h.rotation.x = Math.PI / 2;
    h.position.z = len / 2 + L.horn / 2 - 0.05;
    g.add(h);
  }
  if (L.dorsal) {
    const fin = mesh(new THREE.ConeGeometry(0.16, 0.45, 3), L.body);
    fin.position.set(0, gi + 0.12, -0.05);
    fin.rotation.x = -0.3;
    g.add(fin);
  }
  if (L.fins) {
    const fin = mesh(new THREE.ConeGeometry(0.1, 0.3, 3), L.fins);
    fin.position.set(0, gi + 0.08, 0);
    g.add(fin);
  }
  if (L.lure) {
    const stalk = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), '#2b2238');
    stalk.position.set(0, gi + 0.15, len * 0.3); stalk.rotation.x = 0.7;
    const bulb = mesh(lowSphere, '#fff6a0', { emissive: '#ffe066', emissiveIntensity: 1 });
    bulb.scale.setScalar(0.09); bulb.position.set(0, gi + 0.33, len * 0.52);
    g.add(stalk, bulb);
  }
  if (L.teeth) for (let i = 0; i < 4; i++) {
    const tooth = mesh(new THREE.ConeGeometry(0.03, 0.1, 3), '#ffffff');
    tooth.position.set(-0.12 + i * 0.08, -0.02, len / 2 - 0.02); tooth.rotation.x = Math.PI;
    g.add(tooth);
  }
  if (L.claws) for (const sx of [1, -1]) {
    const claw = mesh(new THREE.BoxGeometry(0.12, 0.12, 0.3), '#ff8fb0');
    claw.position.set(sx * 0.16, 0, len / 2 + 0.1);
    g.add(claw);
  }
  if (L.special === 'hammer') {
    const head = mesh(new THREE.BoxGeometry(0.95, 0.16, 0.26), L.body);
    head.position.z = len / 2;
    g.add(head);
    eye(0.48, 0.02, len / 2, 0.06); eye(-0.48, 0.02, len / 2, 0.06);
    const fin = mesh(new THREE.ConeGeometry(0.16, 0.45, 3), L.body);
    fin.position.set(0, gi + 0.12, -0.05);
    g.add(fin);
  }
  return g;
}

const SKIN = '#ffd7b0';
function darken(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }

function makePlayer(color) {
  const root = new THREE.Group();
  const bodyG = new THREE.Group();
  root.add(bodyG);
  const body = mesh(new THREE.CapsuleGeometry(0.42, 0.45, 4, 10), color);
  body.position.y = 0.78;
  const vest = mesh(new THREE.CapsuleGeometry(0.44, 0.2, 4, 10), '#ffd23f');
  vest.position.y = 0.72;
  vest.scale.set(1, 0.9, 1);
  const head = mesh(new THREE.SphereGeometry(0.34, 12, 10), SKIN);
  head.position.y = 1.5;
  const hatTop = mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.25, 10), darken(color, 0.8));
  hatTop.position.y = 1.78;
  const brim = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12), darken(color, 0.8));
  brim.position.y = 1.68;
  const eyeL = mesh(lowSphere, '#10223a'); eyeL.scale.setScalar(0.055); eyeL.position.set(0.12, 1.53, 0.3);
  const eyeR = eyeL.clone(); eyeR.position.x = -0.12;
  const nose = mesh(lowSphere, '#ffb48a'); nose.scale.setScalar(0.07); nose.position.set(0, 1.45, 0.34);
  const footL = mesh(new THREE.BoxGeometry(0.2, 0.15, 0.32), '#3b3b4f'); footL.position.set(0.17, 0.08, 0.03);
  const footR = footL.clone(); footR.position.x = -0.17;
  const armL = mesh(lowSphere, color); armL.scale.set(0.12, 0.12, 0.12); armL.position.set(0.48, 0.9, 0.1);
  const hand = new THREE.Group(); hand.position.set(-0.45, 0.95, 0.35);
  const armR = mesh(lowSphere, SKIN); armR.scale.setScalar(0.12); hand.add(armR);
  bodyG.add(body, vest, head, hatTop, brim, eyeL, eyeR, nose, armL, hand);
  root.add(footL, footR);
  // ring on the ground in the player's color
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);
  // rod on the back / in hand
  const rod = makeRod();
  rod.scale.setScalar(0.8);
  bodyG.add(rod);
  // aim arrow
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.05, 1.15);
  root.add(arrow);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), new THREE.MeshToonMaterial({ color: '#9fe8ff', gradientMap: grad, transparent: true, opacity: 0.35 }));
  bubble.position.y = 0.9;
  bubble.visible = false;
  root.add(bubble);
  const armorShell = mesh(new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ff8a5b');
  armorShell.position.set(0, 0.95, -0.25);
  armorShell.rotation.x = -1.2;
  armorShell.visible = false;
  bodyG.add(armorShell);
  root.userData = { bodyG, hand, rod, footL, footR, arrow, bubble, armorShell, ring, fishId: null, fishMesh: null, walk: 0 };
  return root;
}

function makePelican() {
  const g = new THREE.Group();
  const body = mesh(sphereGeo, '#ffffff'); body.scale.set(0.7, 0.6, 1.2);
  const head = mesh(sphereGeo, '#ffffff'); head.scale.setScalar(0.35); head.position.set(0, 0.5, 1.1);
  const beak = mesh(new THREE.ConeGeometry(0.2, 1.4, 5), '#ff9f43'); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.35, 1.9);
  const pouch = mesh(sphereGeo, '#ffb86b'); pouch.scale.set(0.18, 0.2, 0.5); pouch.position.set(0, 0.15, 1.7);
  const wingGeo = new THREE.BoxGeometry(2.4, 0.08, 0.9);
  const wl = new THREE.Group(), wr = new THREE.Group();
  const wlm = mesh(wingGeo, '#f2f2f2'); wlm.position.x = 1.2; wl.add(wlm);
  const wrm = mesh(wingGeo, '#f2f2f2'); wrm.position.x = -1.2; wr.add(wrm);
  const tipL = mesh(new THREE.BoxGeometry(0.6, 0.09, 0.9), '#10223a'); tipL.position.x = 2.1; wl.add(tipL);
  const tipR = tipL.clone(); tipR.position.x = -2.1; wr.add(tipR);
  const eyeL = mesh(lowSphere, '#10223a'); eyeL.scale.setScalar(0.06); eyeL.position.set(0.22, 0.6, 1.3);
  const eyeR = eyeL.clone(); eyeR.position.x = -0.22;
  const crate = makeDropBox('heal');
  crate.position.y = -0.9;
  g.add(body, head, beak, pouch, wl, wr, eyeL, eyeR, crate);
  g.userData = { wl, wr, crate };
  return g;
}

const DROP_COLORS = { heal: '#ff5a5f', armor: '#ff8a5b', bubble: '#4fd5ff', lure: '#ffd23f', cooler: '#c86bff', tackle: '#3ddc84' };
const DROP_ICON = { heal: '🍟', armor: '🦀', bubble: '🫧', lure: '✨', cooler: '🧊', tackle: '🧰' };
const GADGET_ICON = { flounder: '🫓', urchin: '🟣', jelly: '🪼', ink: '🐙', clam: '🦪', grouper: '🐟' };
const GADGET_COLOR = { flounder: '#c9a46b', urchin: '#7a3fa0', jelly: '#ff8fd8', ink: '#3b2a5a', clam: '#e8d7b9', grouper: '#6b8f3a' };

// ---- gadget models (all low-poly, built from primitives)
function makeGadget(kind) {
  const g = new THREE.Group();
  if (kind === 'flounder') {
    const body = mesh(new THREE.SphereGeometry(0.6, 8, 4), '#c9a46b');
    body.scale.set(1, 0.18, 0.75);
    body.position.y = 0.08;
    const fin = mesh(new THREE.ConeGeometry(0.28, 0.35, 4), '#a8844f');
    fin.rotation.x = -Math.PI / 2; fin.position.set(0, 0.08, -0.6); fin.scale.y = 0.4;
    const e1 = mesh(lowSphere, '#10223a'); e1.scale.setScalar(0.07); e1.position.set(0.12, 0.2, 0.3);
    const e2 = e1.clone(); e2.position.x = -0.05; e2.position.z = 0.36;
    const fuse = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 4), '#333'); fuse.position.set(0, 0.25, 0);
    const spark = mesh(lowSphere, '#ff5a5f', { emissive: '#ff3b3b' }); spark.scale.setScalar(0.08); spark.position.set(0, 0.4, 0);
    g.add(body, fin, e1, e2, fuse, spark);
    g.userData.spark = spark;
  } else if (kind === 'spike' || kind === 'urchin') {
    const core = mesh(new THREE.IcosahedronGeometry(0.22, 0), '#5a2a80');
    g.add(core);
    for (let i = 0; i < 10; i++) {
      const sp = mesh(new THREE.ConeGeometry(0.04, 0.35, 3), '#2a1240');
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI;
      sp.position.set(Math.sin(b) * Math.cos(a) * 0.25, Math.cos(b) * 0.25, Math.sin(b) * Math.sin(a) * 0.25);
      sp.lookAt(sp.position.clone().multiplyScalar(3)); sp.rotateX(Math.PI / 2);
      g.add(sp);
    }
    if (kind === 'spike') g.position.y = 0.2;
  } else if (kind === 'jelly') {
    const bell = mesh(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ff8fd8', { transparent: true, opacity: 0.7 });
    bell.position.y = 0.9;
    g.add(bell);
    for (let i = 0; i < 6; i++) {
      const t = mesh(new THREE.CylinderGeometry(0.03, 0.015, 0.9, 3), '#ffc2ea');
      const a = (i / 6) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3);
      g.add(t);
    }
    g.userData.bell = bell;
  } else if (kind === 'ink') {
    const cloud = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(lowSphere, new THREE.MeshBasicMaterial({ color: '#1d1430', transparent: true, opacity: 0.62, depthWrite: false }));
      const a = (i / 9) * Math.PI * 2;
      const r = i === 0 ? 0 : 2.1;
      b.position.set(Math.cos(a) * r, 1 + Math.random() * 0.6, Math.sin(a) * r);
      b.scale.setScalar(i === 0 ? 2.4 : 1.7 + Math.random() * 0.6);
      cloud.add(b);
    }
    g.add(cloud);
    g.userData.cloud = cloud;
  } else if (kind === 'clam') {
    const bottom = mesh(new THREE.SphereGeometry(1.25, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#e8d7b9');
    bottom.position.y = 0.6;
    const top = mesh(new THREE.SphereGeometry(1.25, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#d9c29a');
    top.position.set(0, 0.6, -0.15);
    top.rotation.x = -0.75;
    const pearl = mesh(lowSphere, '#fffaf0'); pearl.scale.setScalar(0.3); pearl.position.set(0, 0.75, 0.3);
    g.add(bottom, top, pearl);
  } else if (kind === 'grouper') {
    const body = mesh(sphereGeo, '#6b8f3a');
    body.scale.set(0.5, 0.45, 0.75); body.position.y = 0.6;
    const lip = mesh(new THREE.TorusGeometry(0.2, 0.08, 5, 10), '#4a6a24');
    lip.position.set(0, 0.6, 0.72);
    const tail = mesh(new THREE.ConeGeometry(0.35, 0.5, 4), '#4a6a24');
    tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.6, -0.85);
    const e1 = mesh(lowSphere, '#10223a'); e1.scale.setScalar(0.07); e1.position.set(0.28, 0.75, 0.45);
    const e2 = e1.clone(); e2.position.x = -0.28;
    const stand = mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.2, 7), '#8b5a2b'); stand.position.y = 0.1;
    g.add(body, lip, tail, e1, e2, stand);
  }
  return g;
}
function makeDropBox(kind) {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), DROP_COLORS[kind] || '#fff');
  box.position.y = 0.35;
  const band = mesh(new THREE.BoxGeometry(0.84, 0.15, 0.84), '#ffffff');
  band.position.y = 0.45;
  g.add(box, band);
  g.userData.box = box;
  return g;
}

// ------------------------------------------------------------------ effects
const effects = [];
const particleGeo = new THREE.IcosahedronGeometry(1, 0);
function burst(x, y, z, color, n, speed, size, life, gravity) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(particleGeo, mat(color));
    m.scale.setScalar(size * (0.6 + Math.random() * 0.6));
    m.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2, up = Math.random();
    const v = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random()), speed * (0.6 + up), Math.sin(a) * speed * (0.4 + Math.random()));
    scene.add(m);
    effects.push({ m, v, life, max: life, g: gravity == null ? 18 : gravity, kind: 'p' });
  }
}
function ringFx(x, z, r, color, y) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, (y || 0) + 0.05, z);
  scene.add(m);
  effects.push({ m, life: 0.4, max: 0.4, r, kind: 'ring' });
}
function boomFx(x, z, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8 }));
  m.position.set(x, 0.5, z);
  scene.add(m);
  effects.push({ m, life: 0.35, max: 0.35, r, kind: 'boom' });
  burst(x, 0.5, z, '#ff9f43', 14, 7, 0.18, 0.6);
  burst(x, 0.5, z, '#ffffff', 8, 5, 0.14, 0.5);
}
function zapFx(pts) {
  const arr = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const j = k === 0 || k === 6 ? 0 : 0.35;
      arr.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, 1 + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j));
    }
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr), new THREE.LineBasicMaterial({ color: '#f5ff6a', transparent: true }));
  scene.add(line);
  effects.push({ m: line, life: 0.25, max: 0.25, kind: 'line' });
}
let shake = 0;
function stepEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (e.kind === 'p') {
      e.v.y -= e.g * dt;
      e.m.position.addScaledVector(e.v, dt);
      e.m.scale.multiplyScalar(0.985);
    } else if (e.kind === 'ring') {
      const s = e.r * (1 - k * 0.7);
      e.m.scale.set(s, s, s);
      e.m.material.opacity = k;
    } else if (e.kind === 'boom') {
      e.m.scale.setScalar(e.r * (1.1 - k * 0.8));
      e.m.material.opacity = k * 0.8;
    } else if (e.kind === 'arc') {
      const k2 = 1 - k;
      const to = e.target();
      e.m.position.set(e.from.x + (to.x - e.from.x) * k2, e.from.y + (to.y - e.from.y) * k2 + Math.sin(k2 * Math.PI) * 3, e.from.z + (to.z - e.from.z) * k2);
      e.m.rotation.x += 0.4;
    } else if (e.kind === 'line') {
      e.m.material.opacity = k;
    }
    if (e.life <= 0) {
      scene.remove(e.m);
      if (e.kind !== 'p' && e.kind !== 'arc') { e.m.geometry.dispose(); e.m.material.dispose(); }
      effects.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ sound
let audio = null, muted = false;
function ac() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } }
  return audio;
}
function tone(freq, dur, type, vol, slide) {
  const a = ac(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
function noise(dur, vol, lp) {
  const a = ac(); if (!a || muted) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(); s.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
  const g = a.createGain(); g.gain.value = vol || 0.15;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}
const SFX = {
  slap: () => { noise(0.08, 0.25, 3000); tone(220, 0.08, 'triangle', 0.08, 0.5); },
  shoot: () => tone(660, 0.07, 'square', 0.04, 0.6),
  boom: () => { noise(0.4, 0.35, 600); tone(90, 0.3, 'sine', 0.2, 0.4); },
  splash: () => noise(0.5, 0.25, 900),
  cast: () => tone(900, 0.25, 'sine', 0.06, 0.3),
  snap: () => tone(1200, 0.12, 'sawtooth', 0.06, 0.3),
  zap: () => { tone(1400, 0.15, 'sawtooth', 0.05, 0.2); noise(0.1, 0.1, 5000); },
  pickup: () => tone(780, 0.1, 'triangle', 0.08, 1.5),
  ko: () => { tone(300, 0.3, 'square', 0.08, 0.3); },
  pelican: () => { tone(500, 0.1, 'square', 0.04, 1.4); setTimeout(() => tone(450, 0.12, 'square', 0.04, 1.3), 140); },
  tier: () => tone(340, 0.18, 'sine', 0.07, 0.7),
  dash: (water) => { noise(0.14, 0.12, water ? 900 : 2600); tone(water ? 260 : 420, 0.12, 'sine', 0.05, 2.2); },
  dodge: () => { tone(1200, 0.08, 'sine', 0.06, 1.6); setTimeout(() => tone(1600, 0.08, 'sine', 0.05, 1.4), 60); },
  nope: () => tone(160, 0.12, 'square', 0.04, 0.8),
  round: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.08), i * 110)); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.09), i * 120)); },
  gadget: () => { tone(660, 0.07, 'square', 0.05, 1.5); setTimeout(() => tone(990, 0.1, 'square', 0.05, 1.3), 70); noise(0.1, 0.08, 4000); },
  // a different little fanfare per rarity: rarer fish climb higher and sparkle longer
  catch: (r) => {
    const i = RARITIES.indexOf(r), base = 440 + i * 70;
    const notes = [[1, 1.25], [1, 1.25, 1.5], [1, 1.26, 1.5, 2], [1, 1.19, 1.5, 1.78, 2], [1, 1.26, 1.5, 2, 2.52, 3]][Math.max(0, i)];
    notes.forEach((m, k) => setTimeout(() => tone(base * m, 0.14 + k * 0.02, i >= 3 ? 'square' : 'triangle', 0.07), k * 85));
    if (i >= 3) setTimeout(() => noise(0.4, 0.06, 7000), notes.length * 85);
  },
};
Object.assign(SFX, {
  splat: () => { noise(0.25, 0.25, 700); tone(180, 0.2, 'sine', 0.08, 0.5); },
  blind: () => { tone(900, 0.5, 'sine', 0.06, 0.2); setTimeout(() => tone(120, 0.4, 'square', 0.04, 0.6), 200); },
  storm: () => { noise(1.2, 0.2, 400); tone(80, 1, 'sawtooth', 0.05, 0.6); },
  boing: () => tone(300, 0.18, 'sine', 0.07, 2.4),
  whoosh: () => noise(0.18, 0.08, 3000),
  ice: () => { noise(0.3, 0.2, 6000); [1800, 2400, 2100].forEach((f, i) => setTimeout(() => tone(f, 0.08, 'triangle', 0.04), i * 50)); },
  // slide whistle down, then a bonk and a squeak
  killcam: (big) => {
    tone(1400, 0.45, 'sine', 0.08, 0.25);
    setTimeout(() => { noise(0.08, 0.3, 1500); tone(110, 0.12, 'square', 0.1, 0.6); }, 430);
    if (big) setTimeout(() => { tone(900, 0.07, 'square', 0.05, 1.5); setTimeout(() => tone(1250, 0.09, 'square', 0.05, 1.3), 80); }, 650);
  },
});
let lastBeat = 0;
function heartbeat(hp) {
  const now = performance.now(), gap = 380 + hp * 18;
  if (now - lastBeat < gap) return;
  lastBeat = now;
  tone(70, 0.09, 'sine', 0.16, 0.8);
  setTimeout(() => tone(60, 0.11, 'sine', 0.13, 0.8), 140);
}

// ------------------------------------------------------------------ input
const keys = {};
const input = { mx: 0, mz: 0, ax: 1, az: 0, aimDist: 8, fire: false, dash: false, fish: false, use: false, gadget: false };
let mouseNDC = new THREE.Vector2();
let mouseDown = false;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (!keys[k]) {
    if (k === ' ' || k === 'shift') input.dash = true;
    if (k === 'q' || k === 'g') input.gadget = true;
    if (k === 'r' || k === 'f') input.fish = true;
    if (k === 'e') input.use = true;
    if (k === 'escape') togglePause();
    if (k === 'm') muted = !muted;
  }
  keys[k] = true;
  if (k === ' ' && playing) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
canvas.addEventListener('mousemove', (e) => { mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); });
canvas.addEventListener('mousedown', (e) => { ac(); if (playing && !locked && !touchState.on) requestLock(); if (e.button === 0) mouseDown = true; if (e.button === 2) input.fish = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();

// touch: left stick moves, right stick aims and fires when pushed past the dead zone
const touchState = { on: false, mx: 0, mz: 0, lookX: 0, lookY: 0, firing: false };
function setupStick(el, onMove) {
  const knob = el.querySelector('i');
  let pid = null;
  const update = (e) => {
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / max, dy / max, true);
  };
  el.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { el.setPointerCapture(pid); } catch (err) {} ac(); update(e); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) update(e); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; onMove(0, 0, false); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
function enableTouch() {
  if (touchState.on) return;
  touchState.on = true;
  document.body.classList.add('touch');
}
window.addEventListener('touchstart', enableTouch, { passive: true, once: true });
if (matchMedia('(pointer: coarse)').matches) enableTouch();
setupStick(document.getElementById('stickL'), (x, y) => { touchState.mx = x; touchState.mz = y; });
setupStick(document.getElementById('stickR'), (x, y) => {
  touchState.lookX = Math.abs(x) > 0.12 ? x : 0;
  touchState.lookY = Math.abs(y) > 0.12 ? y : 0;
});
{
  const fb = document.getElementById('tFire');
  fb.addEventListener('pointerdown', (e) => { e.preventDefault(); ac(); touchState.firing = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => fb.addEventListener(ev, () => (touchState.firing = false)));
}
const tap = (id, fn) => document.getElementById(id).addEventListener('pointerdown', (e) => { e.preventDefault(); ac(); fn(); });
tap('tFish', () => (input.fish = true));
tap('tDash', () => (input.dash = true));
tap('tSwap', () => (input.use = true));
tap('tGadget', () => (input.gadget = true));
tap('tPause', () => togglePause());

// Over-the-shoulder camera: yaw/pitch come from the mouse (pointer lock), the right stick, or the arrow keys.
const cam = { yaw: 0, pitch: 0.32, dist: 7, target: new THREE.Vector3(), init: false };
function camForward() { return { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) }; }
function readInput(me, dt) {
  const touching = touchState.on && !mouseDown && !keys['w'] && !keys['a'] && !keys['s'] && !keys['d'];
  // rotate the camera
  if (keys['arrowleft']) cam.yaw += 2.4 * dt;
  if (keys['arrowright']) cam.yaw -= 2.4 * dt;
  if (keys['arrowup']) cam.pitch -= 1.2 * dt;
  if (keys['arrowdown']) cam.pitch += 1.2 * dt;
  if (touching) { cam.yaw -= touchState.lookX * 2.8 * dt; cam.pitch += touchState.lookY * 1.4 * dt; }
  cam.pitch = Math.max(-0.2, Math.min(1.15, cam.pitch));
  const f = camForward(), r = { x: -f.z, z: f.x };
  let fw, st;
  if (touching) { fw = -touchState.mz; st = touchState.mx; if (Math.hypot(fw, st) < 0.15) fw = st = 0; }
  else { fw = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0); st = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0); }
  input.mx = f.x * fw + r.x * st;
  input.mz = f.z * fw + r.z * st;
  input.fire = touching ? touchState.firing : mouseDown;
  // aim where the crosshair points: a ray from the camera through the middle of the screen
  if (me) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    let px, pz;
    if (raycaster.ray.intersectPlane(groundPlane, aimPoint) && aimPoint.distanceTo(camera.position) < 45) { px = aimPoint.x; pz = aimPoint.z; }
    else { const far = raycaster.ray.at(30, new THREE.Vector3()); px = far.x; pz = far.z; }
    const dx = px - me.x, dz = pz - me.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { input.ax = dx / d; input.az = dz / d; input.aimDist = d; }
    else { input.ax = f.x; input.az = f.z; input.aimDist = 2; }
  }
}
// pointer lock for mouse look
let locked = false;
document.addEventListener('pointerlockchange', () => {
  const was = locked;
  locked = document.pointerLockElement === canvas;
  if (was && !locked && playing && !touchState.on && !paused && $('pause').classList.contains('hidden')) togglePause();
});
window.addEventListener('mousemove', (e) => {
  if (!playing || touchState.on) return;
  if (locked || mouseDown) {
    cam.yaw -= e.movementX * 0.0026;
    cam.pitch += e.movementY * 0.0022;
  }
});
function requestLock() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} }

// ------------------------------------------------------------------ game sources
let source = null; // { tick(dt), myId, prev, curr, alpha, events[], sendInput(inp), stop() }
let playing = false, paused = false;

function localSource(opts) {
  const r = opts.round, team = !!Sim.TEAM_MODES[r];
  const g = Sim.createGame({ map: opts.map, teams: opts.teams, mode: team ? r : r === 'rounds' ? 'rounds' : 'timed', roundSeconds: team || r === 'rounds' ? undefined : +r });
  buildMap(g.world);
  g.addPlayer('me', opts.name, false);
  const names = ['Captain Cod', 'Salty Sue', 'Barnacle Bo', 'Gill Bates', 'Reel Steel', 'Kelp Kelly', 'Mack Rell'];
  for (let i = 0; i < opts.bots; i++) g.addPlayer('bot' + i, names[i % names.length], true, opts.difficulty);
  g.start();
  let acc = 0;
  const src = {
    myId: 'me', local: true, events: [], game: g,
    curr: g.snapshot(), prev: null, alpha: 1,
    tick(dt) {
      if (paused) return;
      acc += Math.min(dt, 0.25);
      while (acc >= STEP) {
        g.setInput('me', input);
        input.dash = input.fish = input.use = input.gadget = false;
        g.step(STEP);
        src.events.push(...g.drainEvents());
        src.prev = src.curr;
        src.curr = g.snapshot();
        acc -= STEP;
      }
      src.alpha = acc / STEP;
    },
    restart() { g.start(); },
    stop() {},
  };
  return src;
}

function netSource(url, room, name, onLobby, onClose) {
  const ws = new WebSocket(url);
  let lastSnapAt = 0, interval = 50, sendAcc = 0, seq = 0;
  const hist = []; // inputs the server hasn't acknowledged yet, replayed for prediction
  const pending = { dash: false, fish: false, use: false, gadget: false };
  const src = {
    myId: null, local: false, events: [], curr: null, prev: null, alpha: 1, ws, pred: null, predT: 0, world: null, off: { x: 0, z: 0 },
    tick(dt) {
      const now = performance.now();
      src.alpha = Math.min(1.2, (now - lastSnapAt) / interval);
      pending.dash = pending.dash || input.dash; pending.fish = pending.fish || input.fish; pending.use = pending.use || input.use; pending.gadget = pending.gadget || input.gadget;
      input.dash = input.fish = input.use = input.gadget = false;
      sendAcc += dt;
      sendAcc = Math.min(sendAcc, STEP * 3);
      while (sendAcc >= STEP && ws.readyState === 1) {
        sendAcc -= STEP;
        seq++;
        // vt: the moment of the game we're looking at, so the server judges our hits against it (lag compensation)
        const vt = src.prev && src.curr ? +(src.prev.time + (src.curr.time - src.prev.time) * src.alpha).toFixed(3) : null;
        ws.send(JSON.stringify({ t: 'input', i: Object.assign({}, input, pending, { seq, vt }) }));
        const step = { seq, mx: input.mx, mz: input.mz, ax: input.ax, az: input.az, dash: pending.dash };
        hist.push(step);
        if (hist.length > 90) hist.shift();
        if (src.pred && src.world) {
          Sim.useWorld(src.world);
          Sim.predictStep(src.pred, step, STEP, src.predT);
          src.predT += STEP;
          if (src.pred.dashed) { src.pred.dashed = false; src.dashedAt = now; SFX.dash(false); }
          if (src.pred.off) src.pred = null; // dashed off the boards: follow the server from here
        }
        // feedback for our own attack straight away; the server decides whether it hits
        const me = src.curr && src.curr.players.find((p) => p.id === src.myId);
        if (input.fire && me && me.alive && me.weapon && !me.fishing && now >= (src.cdUntil || 0)) {
          const w = WEAPONS[me.weapon.id];
          src.cdUntil = now + w.cd * 1000; src.firedAt = now; src.swingUntil = now + 200;
          if (w.kind === 'shot' || w.kind === 'pierce' || w.kind === 'rocket') SFX.shoot();
        }
        pending.dash = pending.fish = pending.use = pending.gadget = false;
      }
    },
    start(round, bots, map, teams) { ws.send(JSON.stringify({ t: 'start', round, bots, map, teams })); },
    restart() { ws.send(JSON.stringify({ t: 'start' })); },
    stop() { try { ws.close(); } catch (e) {} },
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'welcome') src.myId = msg.id;
    else if (msg.t === 'lobby') onLobby(msg);
    else if (msg.t === 'snap') {
      const now = performance.now();
      if (lastSnapAt) interval = interval * 0.9 + Math.min(200, now - lastSnapAt) * 0.1;
      lastSnapAt = now;
      src.prev = src.curr;
      src.curr = msg.s;
      if (msg.e && msg.e.length) src.events.push(...msg.e);
      // our own copy of the world, for predicting walks on rafts and around raised bridges
      if (!src.world || src.world.map.id !== msg.s.map) src.world = Sim.makeWorld(msg.s.map);
      if (msg.s.gates) { msg.s.gates.forEach((v, i) => { if (src.world.gates[i]) src.world.gates[i].pass = !!v; }); Sim.refreshWalls(src.world); }
      Sim.useWorld(src.world);
      // client-side prediction for our own walking; anything else (dash, knockback, fishing) follows the server
      const me = msg.s.players.find((p) => p.id === src.myId);
      if (me && me.alive && !me.air && !me.swim && me.climbT <= 0 && !me.fishing && me.kbT <= 0 && me.stunT <= 0 && me.ack != null) {
        // replay the inputs the server hasn't seen yet on top of its latest word (walking and dashing)
        const np = { x: me.x, z: me.z, vx: me.vx, vz: me.vz, weapon: me.weapon, slowT: me.slowT, carry: me.carry, dashT: me.dashT, dashN: me.dashN, dashRT: me.dashRT, dashCd: me.dashCd };
        while (hist.length && hist[0].seq <= me.ack) hist.shift();
        let pt = msg.s.time;
        for (const h of hist) { Sim.predictStep(np, h, STEP, pt); pt += STEP; if (np.off) break; }
        np.dashed = false;
        src.predT = pt;
        if (np.off) { src.pred = null; src.off.x = src.off.z = 0; }
        else {
          if (src.pred) {
            src.off.x += src.pred.x - np.x; src.off.z += src.pred.z - np.z;
            if (Math.hypot(src.off.x, src.off.z) > 3) src.off.x = src.off.z = 0;
          }
          src.pred = np;
        }
      } else { src.pred = null; src.off.x = src.off.z = 0; }
      if (!playing && msg.s.phase === 'play') beginPlay(src);
    }
  };
  ws.onclose = () => onClose && onClose();
  ws.onerror = () => onClose && onClose('error');
  return src;
}

// ------------------------------------------------------------------ view sync
const views = { players: new Map(), projectiles: new Map(), items: new Map(), pelicans: new Map(), traps: new Map() };
const tagsEl = document.getElementById('tags');
const markers = new Map(); // pelican drop target markers

function lerp(a, b, t) { return a + (b - a) * t; }
function interp(prevList, cur, alpha) {
  const y0 = cur.y || 0;
  if (!prevList) return { x: cur.x, z: cur.z, y: y0 };
  const p = prevList.find((e) => e.id === cur.id);
  if (!p) return { x: cur.x, z: cur.z, y: y0 };
  if (Math.hypot(p.x - cur.x, p.z - cur.z) > 8) return { x: cur.x, z: cur.z, y: y0 };
  return { x: lerp(p.x, cur.x, alpha), z: lerp(p.z, cur.z, alpha), y: lerp(p.y || 0, y0, alpha) };
}

function syncPlayers(s, prev, alpha, t, dt) {
  const seen = new Set();
  for (const p of s.players) {
    seen.add(p.id);
    let v = views.players.get(p.id);
    if (v && v.color !== p.color) { scene.remove(v.obj, v.line, v.bobber); if (v.ice) scene.remove(v.ice); v.tag.remove(); views.players.delete(p.id); v = null; }
    if (!v) {
      const obj = makePlayer(p.color);
      scene.add(obj);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = `<div class="nm"></div><div class="pc"></div><div class="fishing hidden"></div>`;
      tagsEl.appendChild(tag);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(10).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#ffffff' }));
      line.frustumCulled = false;
      scene.add(line);
      const bobber = new THREE.Group();
      const b1 = mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ff3b3b');
      const b2 = mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#ffffff');
      bobber.add(b1, b2);
      const tierRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 24), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      tierRing.rotation.x = -Math.PI / 2;
      bobber.add(tierRing);
      scene.add(bobber);
      v = { obj, tag, line, bobber, tierRing, x: p.x, z: p.z, y: 0, rippleT: 0, color: p.color };
      views.players.set(p.id, v);
    }
    const o = v.obj, u = o.userData;
    let pos = interp(prev && prev.players, p, alpha);
    if (p.id === source.myId && source.pred) {
      source.off.x *= Math.exp(-dt * 10); source.off.z *= Math.exp(-dt * 10);
      pos = { x: source.pred.x + source.off.x, z: source.pred.z + source.off.z, y: 0 };
    }
    const moved = Math.hypot(pos.x - v.x, pos.z - v.z);
    v.x = pos.x; v.z = pos.z; v.y = pos.y;
    o.visible = p.alive;
    // swimmers sit low in the water with just head and shoulders showing
    const swimY = WATER_Y - 0.75 + waveH(pos.x, pos.z, t) * 0.6;
    o.position.set(pos.x, p.swim ? swimY : p.climbT > 0 ? Math.max(swimY, pos.y) : pos.y, pos.z);
    u.ring.visible = !p.swim && !p.air;
    const yaw = Math.atan2(p.ax, p.az);
    let dy = yaw - o.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    o.rotation.y += dy * Math.min(1, dt * 18);
    // waddle
    u.walk += moved * 3.2;
    const sp = Math.min(1, moved / (dt * 7 + 1e-4));
    u.bodyG.position.y = Math.abs(Math.sin(u.walk)) * 0.12 * sp;
    u.bodyG.rotation.z = Math.sin(u.walk) * 0.12 * sp;
    u.footL.position.z = 0.03 + Math.sin(u.walk) * 0.22 * sp;
    u.footR.position.z = 0.03 - Math.sin(u.walk) * 0.22 * sp;
    if (!(p.air && p.kbT > 0)) u.bodyG.rotation.x = p.dashT > 0 ? 0.5 : p.stunT > 0 ? Math.sin(t * 30) * 0.15 : p.swim ? 0.25 : 0;
    // tumble while launched, bob while swimming
    if (p.air && p.kbT > 0) { u.bodyG.rotation.x += dt * 14; if (Math.random() < 0.6) burst(pos.x, pos.y + 0.8, pos.z, '#ffffff', 1, 0.5, 0.22, 0.5, 0); }
    if (p.swim) {
      u.bodyG.position.y = Math.sin(t * 4) * 0.08;
      v.rippleT -= dt;
      if (v.rippleT <= 0) { v.rippleT = 0.6; ringFx(pos.x, pos.z, 1.6, '#ffffff', WATER_Y + 0.15); }
    }
    // frozen solid in an ice block
    if (p.freezeT > 0 && o.visible) {
      if (!v.ice) {
        v.ice = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 1.3), new THREE.MeshToonMaterial({ color: '#bdf4ff', transparent: true, opacity: 0.55, gradientMap: grad }));
        scene.add(v.ice);
      }
      v.ice.visible = true;
      v.ice.position.set(pos.x, pos.y + 1, pos.z);
      v.ice.rotation.y = 0.3;
    } else if (v.ice) v.ice.visible = false;
    // ghost dash: see-through and stretched
    u.bodyG.scale.z = p.phaseT > 0 ? 1.8 : 1;
    if (p.phaseT > 0 && Math.random() < 0.6) burst(pos.x, 1, pos.z, '#d8d0ff', 1, 0.5, 0.25, 0.35, 0);
    // flashing when invulnerable, flickering while phasing
    u.bodyG.visible = !(p.invulnT > 0 && Math.floor(t * 12) % 2 === 0) && !(p.phaseT > 0 && Math.floor(t * 30) % 2 === 0);
    u.arrow.visible = p.id === source.myId && p.alive;
    u.bubble.visible = p.bubble > 0 && !!p.fishing;
    u.armorShell.visible = p.armor > 0;
    // held fish
    const wid = p.weapon ? p.weapon.id : null;
    if (wid !== u.fishId) {
      if (u.fishMesh) u.hand.remove(u.fishMesh);
      u.fishMesh = wid ? makeFish(wid) : null;
      if (u.fishMesh) { u.fishMesh.position.set(0, 0, 0.35); u.fishMesh.scale.setScalar(1.35); u.hand.add(u.fishMesh); }
      u.fishId = wid;
    }
    // online, your own swing starts the moment you click (the server's swing arrives a round trip later)
    const swingT = p.id === source.myId && source.swingUntil ? Math.max(p.swingT, (source.swingUntil - performance.now()) / 1000) : p.swingT;
    if (u.fishMesh) {
      const swing = swingT > 0 ? Math.sin((Math.min(0.2, swingT) / 0.2) * Math.PI) : 0;
      const w = WEAPONS[wid];
      if (w.kind === 'melee' || w.kind === 'slam') { u.hand.rotation.y = -swing * 1.6 + 0.4; u.hand.rotation.x = w.kind === 'slam' ? -swing * 1.2 : 0; }
      else { u.hand.rotation.y = 0; u.hand.rotation.x = -swing * 0.3; }
      if (u.fishMesh.userData.eel) u.fishMesh.children.forEach((c) => { if (c.userData.wiggle != null) c.position.x = Math.sin(t * 10 + c.userData.wiggle) * 0.08; });
    } else {
      const swing = p.swingT > 0 ? Math.sin((p.swingT / 0.2) * Math.PI) : 0;
      u.hand.rotation.y = -swing * 1.8;
      u.hand.rotation.x = 0;
    }
    // rod: on back, or held out when fishing
    u.rod.visible = p.hasRod;
    if (p.fishing) {
      u.rod.position.set(0.35, 0.8, 0.3);
      const bend = p.fishing.reelT > 0 ? 0.6 + Math.sin(t * 30) * 0.1 : 0.9;
      u.rod.rotation.set(bend, 0, 0);
    } else {
      u.rod.position.set(0.1, 0.5, -0.38);
      u.rod.rotation.set(-0.35, 0, 0.5);
    }
    // line + bobber
    v.line.visible = v.bobber.visible = !!p.fishing && o.visible;
    if (p.fishing) {
      const f = p.fishing;
      const tier = Sim.tierFor(f.depth);
      const tierIdx = TIERS.indexOf(tier);
      const bob = waveH(f.bx, f.bz, t) + WATER_Y + (f.biteT > 0 ? -0.45 : f.depth < CFG.fishMinBite ? 0.05 : -0.05 - Math.abs(Math.sin(t * 3)) * 0.06);
      const reel = f.reelT > 0 ? 1 - f.reelT / CFG.reelTime : 0;
      const tipW = new THREE.Vector3();
      u.rod.userData.tip.getWorldPosition(tipW);
      const bx = lerp(f.bx, tipW.x, reel), bz = lerp(f.bz, tipW.z, reel);
      v.bobber.position.set(bx, lerp(bob, tipW.y, reel), bz);
      v.tierRing.material.color.set(['#47e3d2', '#5ee07a', '#45a8ff', '#c86bff'][tierIdx]);
      v.tierRing.scale.setScalar(1 + Math.sin(t * 5) * 0.15);
      const arr = v.line.geometry.attributes.position.array;
      for (let i = 0; i < 10; i++) {
        const k = i / 9;
        arr[i * 3] = lerp(tipW.x, bx, k);
        arr[i * 3 + 1] = lerp(tipW.y, v.bobber.position.y, k) - Math.sin(k * Math.PI) * 0.6 * (1 - reel);
        arr[i * 3 + 2] = lerp(tipW.z, bz, k);
      }
      v.line.geometry.attributes.position.needsUpdate = true;
    }
    // tag
    const head = new THREE.Vector3(pos.x, pos.y + 2.4, pos.z).project(camera);
    const inked = s.traps && s.traps.some((tr) => tr.kind === 'ink' && Math.hypot(tr.x - p.x, tr.z - p.z) < GADGETS.ink.radius);
    const meNow = s.players.find((q) => q.id === source.myId);
    const vis = o.visible && head.z < 1 && p.id !== source.myId && !inked && !(meNow && meNow.blindT > 0);
    v.tag.style.display = vis ? '' : 'none';
    if (vis) {
      v.tag.style.left = ((head.x + 1) / 2) * window.innerWidth + 'px';
      v.tag.style.top = ((1 - head.y) / 2) * window.innerHeight + 'px';
      const nm = v.tag.querySelector('.nm');
      const mate = s.teams && meNow && meNow.team === p.team;
      nm.textContent = (mate ? '▲ ' : '') + p.name + (p.carry != null ? ' 🐟' : '');
      nm.style.color = p.color;
      const pc = v.tag.querySelector('.pc');
      pc.innerHTML = `<span class="hpbar${p.hp <= 30 ? ' low' : ''}"><i style="width:${p.hp}%;background:${hpColor(p.hp)}"></i>${p.armor > 0 ? `<b style="width:${(p.armor / CFG.maxArmor) * 100}%"></b>` : ''}</span>`;
      const fl = v.tag.querySelector('.fishing');
      if (p.fishing) {
        const tier = Sim.tierFor(p.fishing.depth);
        fl.classList.remove('hidden');
        fl.textContent = '🎣 ' + tier.name;
        fl.style.background = ['#47e3d2', '#5ee07a', '#45a8ff', '#c86bff'][TIERS.indexOf(tier)];
      } else fl.classList.add('hidden');
    }
  }
  for (const [id, v] of views.players) {
    if (!seen.has(id)) { scene.remove(v.obj, v.line, v.bobber); if (v.ice) scene.remove(v.ice); v.tag.remove(); views.players.delete(id); }
  }
}

function hpColor(hp) {
  return hp > 60 ? '#5ee07a' : hp > 30 ? '#ffd23f' : '#ff4d4d';
}
function pctColor(pct) {
  const k = Math.min(1, pct / 160);
  const c = new THREE.Color('#ffffff').lerp(new THREE.Color('#ffd23f'), Math.min(1, k * 2)).lerp(new THREE.Color('#ff3b3b'), Math.max(0, k * 2 - 1));
  return '#' + c.getHexString();
}

const PROJ_LOOK = {
  sardine: ['#cfd8dc', 0.18], squid: ['#3b2a5a', 0.25], tuna: ['#264d8c', 0.45], shark: ['#7f8fa3', 0.4], narwhal: ['#ffcc33', 0.25], puffer: ['#ffd23f', 0.35],
};
function syncProjectiles(s, prev, alpha) {
  const seen = new Set();
  for (const pr of s.projectiles) {
    seen.add(pr.id);
    let v = views.projectiles.get(pr.id);
    if (!v) {
      let m;
      if (pr.w === 'boomerang' || pr.w === 'shark' || pr.w === 'icecod') { m = makeFish(pr.w); m.scale.setScalar(pr.w === 'shark' ? 0.9 : 0.8); m.userData.spin = pr.w === 'boomerang' || pr.w === 'icecod'; }
      else if (GADGETS[pr.w]) { m = pr.w === 'grouper' ? mesh(lowSphere, '#2b2b2b') : makeGadget(pr.w === 'urchin' ? 'urchin' : 'ink'); if (pr.w === 'grouper') m.scale.setScalar(0.28); if (pr.w === 'ink') m.scale.setScalar(0.18); }
      else if (pr.w === 'shark' || pr.w === 'puffer' || pr.w === 'tuna') { m = makeFish(pr.w); m.scale.setScalar(pr.w === 'puffer' ? 1 : 0.8); }
      else if (pr.w === 'narwhal') { m = mesh(new THREE.ConeGeometry(0.12, 1.4, 6), '#ffcc33'); m.geometry.rotateX(Math.PI / 2); }
      else { const L = PROJ_LOOK[pr.w] || ['#fff', 0.2]; m = mesh(lowSphere, L[0]); m.scale.setScalar(L[1]); }
      scene.add(m);
      v = { m };
      views.projectiles.set(pr.id, v);
    }
    const pos = interp(prev && prev.projectiles, pr, alpha);
    if (!source.local && source.pred && pr.o === source.myId && (pr.vx || pr.vz)) {
      // you're drawn ahead of the server by your prediction; draw your own shots the same distance ahead
      const lead = Math.min(0.3, Math.max(0, source.predT - s.time));
      pos.x += pr.vx * lead; pos.z += pr.vz * lead;
    }
    v.m.position.set(pos.x, 0.9 + (pr.h || 0), pos.z);
    if (v.m.userData.spin) v.m.rotation.y += 0.55;
    else if (pr.vx || pr.vz) v.m.rotation.y = Math.atan2(pr.vx, pr.vz);
    else v.m.rotation.x += 0.3;
  }
  for (const [id, v] of views.projectiles) if (!seen.has(id)) { scene.remove(v.m); views.projectiles.delete(id); }
}

function syncTraps(s, t) {
  const seen = new Set();
  const myId = source.myId;
  for (const tr of s.traps || []) {
    seen.add(tr.id);
    let v = views.traps.get(tr.id);
    if (!v) {
      const m = makeGadget(tr.kind);
      scene.add(m);
      v = { m, born: t };
      views.traps.set(tr.id, v);
    }
    const m = v.m;
    m.position.x = tr.x; m.position.z = tr.z;
    if (tr.kind !== 'ink' && tr.kind !== 'spike') m.rotation.y = tr.rot || 0;
    // pop in
    const grow = Math.min(1, (t - v.born) * 5);
    if (tr.kind === 'ink') { m.scale.setScalar(Math.min(1, (t - v.born) * 3) * (tr.life < 1 ? Math.max(0.2, tr.life) : 1)); m.userData.cloud.rotation.y = t * 0.3; }
    else m.scale.setScalar(grow);
    if (tr.kind === 'flounder') {
      // hard to spot for everyone but the owner; the fuse blinks faster once armed
      const mine = tr.owner === myId;
      m.traverse((c) => { if (c.material && !c.userData.keep) { c.material = c.material.clone(); c.userData.keep = true; c.material.transparent = true; } });
      m.traverse((c) => { if (c.material) c.material.opacity = mine ? 1 : 0.45; });
      m.userData.spark.visible = !tr.armed || Math.sin(t * (mine ? 10 : 6)) > 0;
    }
    if (tr.kind === 'jelly') { m.userData.bell.scale.y = 1 + Math.sin(t * 4) * 0.15; m.position.y = Math.sin(t * 2) * 0.1; }
    if (tr.kind === 'spike') m.rotation.y += 0.02;
    if (tr.kind === 'clam' || tr.kind === 'grouper') { if (tr.life < 1.5) m.visible = Math.sin(t * 20) > 0; }
  }
  for (const [id, v] of views.traps) if (!seen.has(id)) { scene.remove(v.m); views.traps.delete(id); }
}

function syncItems(s, t) {
  const seen = new Set();
  for (const it of s.items) {
    seen.add(it.id);
    let v = views.items.get(it.id);
    if (!v) {
      let m;
      if (it.kind === 'fish') {
        m = new THREE.Group();
        const f = makeFish(it.weapon);
        f.position.y = 0.4;
        m.add(f);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 20), new THREE.MeshBasicMaterial({ color: RARITY_COLORS[WEAPONS[it.weapon].rarity], transparent: true, opacity: 0.9 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        m.add(ring);
        m.userData.spin = f;
      } else if (it.kind === 'rod') {
        m = makeRod(); m.rotation.z = Math.PI / 2; m.position.y = 0.15;
        const g = new THREE.Group(); g.add(m); m = g;
      } else {
        m = makeDropBox(it.kind);
        const chute = mesh(new THREE.SphereGeometry(0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff');
        chute.position.y = 2;
        m.add(chute);
        m.userData.chute = chute;
      }
      scene.add(m);
      v = { m };
      views.items.set(it.id, v);
    }
    v.m.position.set(it.x, it.y || 0, it.z);
    if (v.m.userData.spin) { v.m.userData.spin.rotation.y = t * 2; v.m.userData.spin.position.y = 0.4 + Math.sin(t * 3) * 0.1; }
    if (v.m.userData.chute) v.m.userData.chute.visible = it.y > 0.05;
    if (it.kind !== 'fish' && it.kind !== 'rod' && !(it.y > 0.05)) v.m.rotation.y = t;
  }
  for (const [id, v] of views.items) if (!seen.has(id)) { scene.remove(v.m); views.items.delete(id); }
}

function syncPelicans(s, prev, alpha, t) {
  const seen = new Set();
  for (const pe of s.pelicans) {
    seen.add(pe.id);
    let v = views.pelicans.get(pe.id);
    if (!v) {
      const m = makePelican();
      m.userData.crate.userData.box.material = mat(DROP_COLORS[pe.kind]);
      scene.add(m);
      const marker = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 28), new THREE.MeshBasicMaterial({ color: DROP_COLORS[pe.kind], transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
      dot.rotation.x = -Math.PI / 2;
      marker.add(ring, dot);
      marker.position.set(pe.tx, 0.04, pe.tz);
      scene.add(marker);
      v = { m, marker, ring };
      views.pelicans.set(pe.id, v);
    }
    const pos = interp(prev && prev.pelicans, pe, alpha);
    v.m.position.set(pos.x, 11 + Math.sin(t * 2) * 0.3, pos.z);
    v.m.rotation.y = Math.atan2(pe.dx, pe.dz);
    const flap = Math.sin(t * 9) * 0.5;
    v.m.userData.wl.rotation.z = flap;
    v.m.userData.wr.rotation.z = -flap;
    v.m.userData.crate.visible = !pe.dropped;
    v.marker.visible = !pe.dropped;
    v.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.15);
  }
  for (const [id, v] of views.pelicans) if (!seen.has(id)) { scene.remove(v.m, v.marker); views.pelicans.delete(id); }
}

// ------------------------------------------------------------------ HUD
const $ = (id) => document.getElementById(id);
const hud = $('hud');
let toastT = 0;
function toast(html, color, dur) {
  const el = $('toast');
  el.innerHTML = html;
  el.style.color = color || '#fff';
  el.style.opacity = 1;
  toastT = dur || 2;
}
function feed(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  $('feed').prepend(d);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => d.remove(), 5000);
}
function floatText(x, y, z, text, color, opt) {
  opt = opt || {};
  const el = document.createElement('div');
  el.className = 'float' + (opt.cls ? ' ' + opt.cls : '');
  el.textContent = text;
  el.style.color = color;
  tagsEl.appendChild(el);
  const start = performance.now();
  const p = new THREE.Vector3(x + (opt.exact ? 0 : (Math.random() - 0.5) * 0.6), y, z);
  (function anim() {
    const k = (performance.now() - start) / (opt.dur || 800);
    if (k >= 1) { el.remove(); return; }
    const v = p.clone(); v.y += k * (opt.rise != null ? opt.rise : 1.5);
    v.project(camera);
    el.style.left = ((v.x + 1) / 2) * window.innerWidth + 'px';
    el.style.top = ((1 - v.y) / 2) * window.innerHeight + 'px';
    el.style.opacity = 1 - k * k;
    requestAnimationFrame(anim);
  })();
}

// gauge bands
{
  const gauge = $('gauge');
  const max = 26;
  const cols = ['#47e3d2', '#2fb7c9', '#1f6fb0', '#1a2f6b'];
  TIERS.forEach((t, i) => {
    const to = i + 1 < TIERS.length ? TIERS[i + 1].from : max;
    const b = document.createElement('div');
    b.className = 'band';
    b.style.top = (t.from / max) * 100 + '%';
    b.style.height = ((to - t.from) / max) * 100 + '%';
    b.style.background = cols[i];
    b.textContent = t.name;
    gauge.appendChild(b);
  });
  const bite = document.createElement('div');
  bite.className = 'band';
  bite.style.top = '0'; bite.style.height = (CFG.fishMinBite / max) * 100 + '%';
  bite.style.background = '#0005'; bite.style.fontSize = '10px';
  gauge.appendChild(bite);
  gauge.appendChild($('needle'));
}

function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

let lastScoreKey = '';
function updateHud(s, me) {
  const rounds = s.mode === 'rounds';
  if (rounds) {
    $('timer').textContent = s.breakT > 0 ? 'Next round…' : `Round ${s.round}`;
    $('timer').classList.toggle('ot', s.breakT <= 0 && s.roundCap - s.roundT < 15);
  } else {
    $('timer').textContent = s.overtime && s.roundLeft <= 0 ? 'OVERTIME' : fmtTime(s.roundLeft);
    $('timer').classList.toggle('ot', s.roundLeft < 30);
  }
  const score = (p) => (rounds ? p.roundWins : p.kos);
  const sorted = [...s.players].sort((a, b) => score(b) - score(a));
  const key = s.teams ? 'T' + s.teamScore.map(Math.floor).join() + (me ? me.team : '') : sorted.map((p) => p.id + score(p) + (rounds && p.out ? 'x' : '')).join();
  if (key !== lastScoreKey && s.teams) {
    // team games: one chip per team with its score toward the goal
    lastScoreKey = key;
    document.querySelectorAll('#topbar .score').forEach((e) => e.remove());
    s.teamScore.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'score' + (me && me.team === i ? ' me' : '');
      d.innerHTML = `<span class="dot" style="background:${TEAM_COLORS[i]}"></span><span class="nm">${TEAM_NAMES[i]}</span> <b>${Math.floor(v)}<small style="opacity:.6">/${s.goal}</small></b>`;
      $('topbar').appendChild(d);
    });
  } else if (key !== lastScoreKey) {
    lastScoreKey = key;
    document.querySelectorAll('#topbar .score').forEach((e) => e.remove());
    for (const p of sorted) {
      const d = document.createElement('div');
      d.className = 'score' + (me && p.id === me.id ? ' me' : '') + (rounds && p.out ? ' out' : '');
      d.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="nm">${escapeHtml(p.name)}</span> <b>${rounds ? '🏆'.repeat(p.roundWins) || '0' : p.kos}</b>`;
      $('topbar').appendChild(d);
    }
  }
  if (!me) return;
  if (touchState.on) $('tFish').textContent = me.fishing ? (me.fishing.depth < CFG.fishMinBite ? 'CANCEL' : 'REEL') : 'CAST';
  $('pct').textContent = me.alive ? me.hp : 'KO';
  $('pct').style.color = me.alive ? hpColor(me.hp) : '#ff4d4d';
  $('hpbar').style.width = (me.alive ? me.hp : 0) + '%';
  $('hpbar').style.background = hpColor(me.hp);
  $('vitals').classList.toggle('low', me.alive && me.hp <= 30);
  $('pctsub').textContent = me.alive ? (me.swim ? 'Swim back! Dash to hop out' : 'health') : me.out ? 'Out this round. Watch and learn…' : 'back in ' + Math.ceil(Math.max(0, me.respawnT));
  const pips = $('dashpips');
  pips.innerHTML = '';
  for (let i = 0; i < CFG.dashCharges; i++) {
    const el = document.createElement('i');
    const fill = i < me.dashN ? 1 : i === me.dashN ? me.dashRT / CFG.dashRecharge : 0;
    el.style.setProperty('--f', fill);
    if (fill >= 1) el.className = 'full';
    pips.appendChild(el);
  }
  if (me.alive && me.hp <= 30) heartbeat(me.hp);
  $('armorbar').style.width = (me.armor / CFG.maxArmor) * 100 + '%';
  $('armortxt').textContent = me.armor > 0 ? '🦀 armor ' + me.armor : 'no armor';
  const buffs = [];
  if (me.bubble > 0) buffs.push(`🫧 bubble x${me.bubble}`);
  if (me.lure > 0) buffs.push(`✨ lure x${me.lure}`);
  if (me.hasRod) buffs.push('🎣 rod');
  if (me.slowT > 0) buffs.push('🦑 inked');
  if (me.stunT > 0) buffs.push('⚡ stunned');
  $('buffs').innerHTML = buffs.map((b) => `<span>${b}</span>`).join('');
  const w = me.weapon ? WEAPONS[me.weapon.id] : null;
  const wEl = $('weapon');
  if (w) {
    $('wname').textContent = w.name;
    $('wname').style.color = RARITY_COLORS[w.rarity];
    $('wdesc').textContent = w.rarity.toUpperCase() + ' · ' + w.desc;
    wEl.style.borderColor = RARITY_COLORS[w.rarity];
    const ammo = $('ammo');
    if (ammo.children.length !== w.uses) { ammo.innerHTML = ''; for (let i = 0; i < w.uses; i++) ammo.appendChild(document.createElement('i')); }
    [...ammo.children].forEach((c, i) => c.classList.toggle('used', i >= me.weapon.uses));
  } else {
    $('wname').textContent = 'No fish';
    $('wname').style.color = '#fff';
    $('wdesc').textContent = me.hasRod ? 'Cast off any edge. Half a second gets you a fish.' : 'Grab a rod from a red-roofed rack.';
    wEl.style.borderColor = 'transparent';
    $('ammo').innerHTML = '';
  }
  // gadget card
  const gEl = $('gadget');
  if (me.gadget) {
    const gd = GADGETS[me.gadget.id];
    gEl.classList.remove('empty');
    gEl.style.borderColor = GADGET_COLOR[me.gadget.id];
    $('gicon').textContent = GADGET_ICON[me.gadget.id];
    $('gname').textContent = gd.name;
    $('gcharges').textContent = '●'.repeat(me.gadget.n);
    $('gdesc').textContent = gd.desc;
  } else {
    gEl.classList.add('empty');
    gEl.style.borderColor = 'transparent';
    $('gicon').textContent = '·';
    $('gname').textContent = 'No gadget';
    $('gcharges').textContent = '';
    $('gdesc').textContent = 'Deep catches can bring up bycatch';
  }
  if (touchState.on) { $('tGadget').classList.toggle('dim', !me.gadget); $('tGadget').innerHTML = me.gadget ? `<span style="font-size:22px">${GADGET_ICON[me.gadget.id]}</span><br>x${me.gadget.n}` : 'GADGET'; }
  // context prompt
  const pr = $('prompt');
  let msg = '';
  if (me.alive && !me.fishing) {
    if (me.swim) msg = 'Swim back and climb onto the pier';
    else if (!me.hasRod && !me.weapon) msg = 'Run to a rod rack (red roof)';
    else if (me.hasRod && Sim.waterDirection(me.x, me.z, me.ax, me.az)) msg = Sim.isPierTip(me.x, me.z) ? 'R to cast · DEEP WATER: sinks faster' : 'R to cast';
    const groundFish = source.curr.items.find((it) => it.kind === 'fish' && Math.hypot(it.x - me.x, it.z - me.z) < 1.4);
    if (groundFish && me.weapon) msg = 'E to swap for ' + WEAPONS[groundFish.weapon].name;
  }
  pr.textContent = msg;
  pr.classList.toggle('hidden', !msg);
  // fishing gauge
  const fp = $('fishing');
  if (me.fishing) {
    fp.classList.remove('hidden');
    const d = me.fishing.depth;
    $('needle').style.top = Math.min(100, (d / (CFG.autoReel * 0.75)) * 100) + '%';
    const odds = Sim.rarityOdds(d);
    $('odds').innerHTML = odds.map((w, i) => (w > 0.005 ? `<i style="width:${w * 100}%;background:${RARITY_COLORS[RARITIES[i]]}"></i>` : '')).join('');
    $('oddsTxt').textContent = d < CFG.fishMinBite ? 'Sinking…' : `Legendary ${Math.round(odds[4] * 100)}% · Epic ${Math.round(odds[3] * 100)}% · Rare ${Math.round(odds[2] * 100)}%`;
    $('reelhint').textContent = me.fishing.reelT > 0 ? 'Reeling in…' : d < CFG.fishMinBite ? 'Sinking… Space bails' : me.fishing.biteT > 0 ? 'BITE! Reel now!' : 'R to reel in';
    $('reelhint').style.color = me.fishing.biteT > 0 ? '#ffd23f' : '';
    fp.querySelector('h3').textContent = me.fishing.mult > 1.01 ? `Line in ×${me.fishing.mult.toFixed(2)}` : 'Line in the water';
  } else fp.classList.add('hidden');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

const mm = $('minimap').getContext('2d');
function drawMinimap(s, me) {
  const W = 300, sc = W / 66;
  mm.clearRect(0, 0, W, W);
  mm.save();
  mm.translate(W / 2, W / 2);
  const M = mapView ? mapView.world.map : MAPS[CFG.map];
  const box = (r) => mm.fillRect(r[0] * sc, r[2] * sc, (r[1] - r[0]) * sc, (r[3] - r[2]) * sc);
  mm.fillStyle = '#d9a066';
  for (const r of M.rects) box(r);
  M.gates.forEach((gt, i) => { mm.fillStyle = s.gates && s.gates[i] ? '#d9a066' : 'rgba(255,90,95,0.55)'; box(gt.r); });
  mm.fillStyle = '#164f96';
  for (const r of M.deep) box(r);
  mm.fillStyle = '#7a5230';
  for (const r of M.boxes) box(r);
  for (const m of M.movers) { const q = Sim.moverPos(m, s.time); mm.fillStyle = m.deep ? '#164f96' : '#b07a48'; mm.fillRect((q.x - m.hw) * sc, (q.z - m.hd) * sc, m.hw * 2 * sc, m.hd * 2 * sc); }
  M.portals.forEach((q, i) => { mm.fillStyle = PORTAL_COLORS[i % PORTAL_COLORS.length]; for (const e of [q.a, q.b]) { mm.beginPath(); mm.arc(e[0] * sc, e[1] * sc, 6, 0, 7); mm.fill(); } });
  if (s.hill) { mm.strokeStyle = s.hill.owner >= 0 ? TEAM_COLORS[s.hill.owner] : '#ffffff'; mm.lineWidth = 5; mm.beginPath(); mm.arc(s.hill.x * sc, s.hill.z * sc, s.hill.r * sc, 0, 7); mm.stroke(); }
  (s.bases || []).forEach((b, i) => { mm.strokeStyle = TEAM_COLORS[i]; mm.lineWidth = 4; mm.strokeRect(b.x * sc - 9, b.z * sc - 9, 18, 18); });
  for (const f of s.flags || []) { mm.fillStyle = '#ffd23f'; mm.strokeStyle = TEAM_COLORS[f.team]; mm.lineWidth = 4; mm.beginPath(); mm.moveTo(f.x * sc, f.z * sc - 12); mm.lineTo(f.x * sc + 9, f.z * sc + 6); mm.lineTo(f.x * sc - 9, f.z * sc + 6); mm.closePath(); mm.fill(); mm.stroke(); }
  for (const it of s.items) {
    mm.fillStyle = it.kind === 'fish' ? RARITY_COLORS[WEAPONS[it.weapon].rarity] : DROP_COLORS[it.kind] || '#222';
    mm.fillRect(it.x * sc - 5, it.z * sc - 5, 10, 10);
  }
  for (const pe of s.pelicans) if (!pe.dropped) { mm.strokeStyle = DROP_COLORS[pe.kind]; mm.lineWidth = 4; mm.beginPath(); mm.arc(pe.tx * sc, pe.tz * sc, 10, 0, 7); mm.stroke(); }
  for (const p of s.players) {
    if (!p.alive) continue;
    mm.fillStyle = p.color;
    mm.strokeStyle = me && p.id === me.id ? '#fff' : '#10223a';
    mm.lineWidth = 4;
    mm.beginPath(); mm.arc(p.x * sc, p.z * sc, 11, 0, 7); mm.fill(); mm.stroke();
  }
  mm.restore();
}

// ------------------------------------------------------------------ events -> feedback
function nameOf(s, id) { const p = s.players.find((q) => q.id === id); return p ? `<span style="color:${p.color}">${escapeHtml(p.name)}</span>` : '?'; }
function handleEvents(s, me) {
  const evs = source.events;
  source.events = [];
  const myId = source.myId;
  for (const e of evs) {
    switch (e.type) {
      case 'hit': {
        const p = s.players.find((q) => q.id === e.id);
        floatText(e.x, 2.2, e.z, e.armor ? '🦀' + e.dmg : e.dmg, e.id === myId ? '#ff5a5f' : '#ffd23f');
        burst(e.x, 1, e.z, p ? p.color : '#fff', 6, 4, 0.12, 0.4);
        SFX.slap();
        if (e.id === myId) shake = Math.max(shake, 0.35);
        if (e.by === myId) shake = Math.max(shake, 0.12);
        break;
      }
      case 'fire': {
        const w = WEAPONS[e.w];
        const predicted = e.id === myId && !source.local && performance.now() - (source.firedAt || 0) < 500;
        if ((w.kind === 'shot' || w.kind === 'pierce' || w.kind === 'rocket') && !predicted) SFX.shoot();
        if (w.kind === 'melee') ringFx(e.x + e.ax * 1.2, e.z + e.az * 1.2, w.range * 0.6, '#ffffff', 0);
        if (e.w === 'squid') burst(e.x + e.ax, 1, e.z + e.az, '#3b2a5a', 3, 2, 0.1, 0.3);
        break;
      }
      case 'boom': if (e.ice) { burst(e.x, 0.6, e.z, '#bdf4ff', 24, 7, 0.2, 0.8); ringFx(e.x, e.z, e.r, '#bdf4ff', 0.1); SFX.ice(); break; } boomFx(e.x, e.z, e.r); SFX.boom(); shake = Math.max(shake, e.slam ? 0.25 : 0.4); break;
      case 'zap': zapFx(e.pts); SFX.zap(); break;
      case 'gadget':
        if (e.id === myId) {
          SFX.gadget();
          toast(`${GADGET_ICON[e.g]} ${GADGETS[e.g].name} x${e.n}<small>New gadget! Press ${touchState.on ? 'the green button' : 'Q'} to use it</small>`, GADGET_COLOR[e.g], 1.8);
          for (const gb of [$('gadget'), $('tGadget')]) { gb.classList.remove('pop'); void gb.offsetWidth; gb.classList.add('pop'); }
        }
        break;
      case 'usegadget': SFX.cast(); if (e.g === 'flounder' || e.g === 'jelly' || e.g === 'clam' || e.g === 'grouper') burst(e.x, 0.5, e.z, GADGET_COLOR[e.g], 6, 3, 0.12, 0.4); break;
      case 'scatter': burst(e.x, 0.4, e.z, '#5a2a80', 10, 5, 0.12, 0.5); SFX.slap(); break;
      case 'spike': burst(e.x, 0.6, e.z, '#2a1240', 8, 4, 0.1, 0.4); SFX.slap(); break;
      case 'inkcloud': burst(e.x, 1, e.z, '#1d1430', 18, 6, 0.3, 0.8); SFX.splash(); break;
      case 'zapjelly': ringFx(e.x, e.z, 2.2, '#ff8fd8', 0.6); burst(e.x, 1, e.z, '#ffe3f6', 10, 5, 0.1, 0.4); SFX.zap(); break;
      case 'spit': burst(e.x, 0.9, e.z, '#9fd3ff', 5, 3, 0.1, 0.3); SFX.shoot(); break;
      case 'splash': {
        if (e.id === myId) toast('SPLASH! Swim back', '#9fe8ff', 1.4);
        burst(e.x, WATER_Y + 0.2, e.z, '#ffffff', e.small ? 6 : 18, e.small ? 4 : 7, 0.18, 0.7);
        burst(e.x, WATER_Y + 0.2, e.z, '#9fe8ff', e.small ? 4 : 12, 5, 0.15, 0.7);
        ringFx(e.x, e.z, 3, '#ffffff', WATER_Y + 0.2);
        SFX.splash();
        break;
      }
      case 'ko': {
        if (e.by) feed(e.cause === 'blast' ? `${nameOf(s, e.by)} launched ${nameOf(s, e.id)} off the map 💥` : `${nameOf(s, e.by)} filleted ${nameOf(s, e.id)} 🐟`);
        else feed(`${nameOf(s, e.id)} drifted out to sea`);
        if (e.id === myId) startKillcam(s, e);
        else if (e.by === myId) toast('KO! 🐟', '#ffd23f', 1.4);
        const p = s.players.find((q) => q.id === e.id);
        boomFx(e.x, e.z, 6);
        burst(e.x, 2, e.z, p ? p.color : '#fff', 30, 12, 0.3, 1.2, 6);
        shake = Math.max(shake, 0.5);
        SFX.ko(); SFX.boom();
        break;
      }
      case 'launch': if (e.power > 18) { SFX.slap(); tone(200, 0.35, 'sawtooth', 0.05, 3); } break;
      case 'climb': if (e.id === myId) tone(500, 0.15, 'triangle', 0.06, 1.6); break;
      case 'catch': {
        const w = WEAPONS[e.w];
        const p = s.players.find((q) => q.id === e.id);
        if (p) burst(p.x, 1.5, p.z, RARITY_COLORS[e.rarity], 12, 5, 0.15, 0.7);
        const pv = views.players.get(e.id);
        if (pv) {
          const fm = makeFish(e.w);
          const from = pv.bobber.position.clone();
          scene.add(fm);
          burst(from.x, WATER_Y + 0.2, from.z, '#ffffff', 10, 4, 0.14, 0.5);
          effects.push({ m: fm, life: 0.45, max: 0.45, kind: 'arc', from, target: () => new THREE.Vector3(pv.x, 1.2, pv.z) });
        }
        if (p && e.rarity !== 'common') {
          const label = { uncommon: 'NICE', rare: 'RARE!', epic: 'EPIC!', legendary: 'LEGENDARY!' }[e.rarity];
          floatText(p.x, 3.1, p.z, label, RARITY_COLORS[e.rarity], { cls: 'rarity ' + e.rarity, dur: 1300, rise: 0.8, exact: true });
          if (e.rarity === 'epic' || e.rarity === 'legendary') { burst(p.x, 2.2, p.z, '#ffd23f', 24, 7, 0.14, 1, 4); ringFx(p.x, p.z, 4, RARITY_COLORS[e.rarity], 0.2); }
        }
        if (e.id === myId) {
          toast(`${e.perfect ? 'PERFECT! ' : ''}${w.name}<small style="color:${RARITY_COLORS[e.rarity]}">${e.rarity.toUpperCase()} · ${w.desc} · ${w.uses + (e.perfect ? CFG.perfectBonus : 0)} use${w.uses + (e.perfect ? CFG.perfectBonus : 0) > 1 ? 's' : ''}</small>`, RARITY_COLORS[e.rarity], 1.8);
          SFX.catch(e.rarity);
        } else if (e.rarity === 'epic' || e.rarity === 'legendary') feed(`${nameOf(s, e.id)} reeled in a <b style="color:${RARITY_COLORS[e.rarity]}">${w.name}</b>!`);
        break;
      }
      case 'bite': burst(e.x, WATER_Y + 0.1, e.z, '#ffffff', 6, 2.5, 0.1, 0.35); if (e.id === myId) tone(880, 0.09, 'triangle', 0.08, 1.4); break;
      case 'cast': if (e.id === myId) SFX.cast(); burst(e.x, WATER_Y + 0.2, e.z, '#ffffff', 5, 3, 0.1, 0.4); break;
      case 'snap': if (e.id === myId) { toast('LINE SNAPPED', '#ff9f43', 1.2); SFX.snap(); } break;
      case 'bubble': { const p = s.players.find((q) => q.id === e.id); if (p) burst(p.x, 1, p.z, '#9fe8ff', 10, 4, 0.15, 0.5); if (e.id === myId) SFX.snap(); break; }
      case 'tier': if (e.id === myId) { SFX.tier(); const t = TIERS.find((x) => x.id === e.tier); toast(`<small>sinking into the</small>${t.name}`, '#9fe8ff', 0.9); } break;
      case 'empty': if (e.id === myId) toast('Out of ammo! Go fish.', '#fff', 1.6); break;
      case 'pickup':
        if (e.id === myId) {
          SFX.pickup();
          if (e.kind === 'cooler' && e.w) toast(`🧊 ${WEAPONS[e.w].name}`, RARITY_COLORS[WEAPONS[e.w].rarity], 2);
          else if (DROPS[e.kind]) toast(`${DROP_ICON[e.kind]} ${DROPS[e.kind].name}<small>${DROPS[e.kind].desc}</small>`, DROP_COLORS[e.kind], 1.6);
          else if (e.kind === 'fish' && e.w) toast(WEAPONS[e.w].name, RARITY_COLORS[WEAPONS[e.w].rarity], 1.2);
        }
        break;
      case 'rod': if (e.id === myId) { SFX.pickup(); toast('🎣 Got a rod! Head to an edge.', '#fff', 1.6); } break;
      case 'pelican': SFX.pelican(); feed(`🦩 Pelican inbound with <b style="color:${DROP_COLORS[e.kind]}">${DROPS[e.kind].name}</b>`); break;
      case 'land': burst(e.x, 0.2, e.z, e.player ? '#ffffff' : '#f5d78e', 6, 3, 0.12, 0.4); break;
      case 'noedge': if (e.id === myId) toast('Get to the edge of the pier to cast', '#fff', 1.2); break;
      case 'norod': if (e.id === myId) toast('No rod! Grab one from a red-roofed rack.', '#fff', 1.2); break;
      case 'dash': {
        const p = s.players.find((q) => q.id === e.id);
        if (p) burst(p.x, e.water ? WATER_Y + 0.3 : 0.3, p.z, e.water ? '#bdf4ff' : '#ffffff', e.water ? 12 : 6, e.water ? 5 : 3, 0.14, 0.35, 2);
        if (e.id === myId && (source.local || e.water || performance.now() - (source.dashedAt || 0) > 400)) SFX.dash(e.water);
        break;
      }
      case 'blind': {
        const p = s.players.find((q) => q.id === e.id);
        feed(`${nameOf(s, e.id)} turned the lights out 💡`);
        if (e.id === myId) toast('LIGHTS OUT<small>everyone else is in the dark</small>', '#fff6a0', 1.5);
        burst(e.x, 2.5, e.z, '#fff6a0', 30, 9, 0.2, 0.8, 0);
        SFX.blind();
        break;
      }
      case 'storm': {
        feed(`${nameOf(s, e.id)} summoned the KRAKEN 🐙`);
        toast(e.id === myId ? 'KRAKEN INK STORM<small>everyone else is drowning in ink</small>' : 'KRAKEN STORM!<small>ink is raining down</small>', '#c86bff', 2);
        SFX.storm();
        break;
      }
      case 'bounce': burst(e.x, 0.3, e.z, '#ffd23f', 6, 4, 0.12, 0.3); SFX.boing(); break;
      case 'boomturn': SFX.whoosh(); break;
      case 'catchback': if (e.id === myId) tone(1300, 0.06, 'triangle', 0.05); break;
      case 'dodge': { floatText(e.x, 2.3, e.z, 'DODGE', '#9fe8ff', { cls: 'small' }); if (e.id === myId) SFX.dodge(); break; }
      case 'noweapon': if (e.id === myId) { toast('<small>no slapping! catch a fish first</small>', '#fff', 1); SFX.nope(); } break;
      case 'round': toast(`ROUND ${e.n}<small>last fisher standing wins</small>`, '#ffd23f', 1.6); SFX.round(); break;
      case 'roundover': {
        const w = e.winner && s.players.find((q) => q.id === e.winner);
        if (w && w.id === myId) { toast('YOU TAKE THE ROUND! 🏆', '#ffd23f', 2.5); SFX.win(); }
        else toast(w ? `<span style="color:${w.color}">${escapeHtml(w.name)}</span> takes the round` : 'Nobody survived!', '#fff', 2.5);
        break;
      }
      case 'flagtake': {
        const mine = me && me.team === e.team;
        if (e.id === myId) toast('YOU HAVE THEIR FISH!<small>run it home to your base</small>', '#ffd23f', 2);
        else toast(mine ? '<small>they took our golden fish!</small>' : `<small>${escapeHtml(nameOf(s, e.id))} grabbed the ${TEAM_NAMES[e.team]} fish</small>`, mine ? '#ff5a5f' : '#fff', 1.6);
        tone(mine ? 300 : 700, 0.25, 'square', 0.05, mine ? 0.6 : 1.5);
        break;
      }
      case 'flagdrop': feed(`🐟 The <b style="color:${TEAM_COLORS[e.team]}">${TEAM_NAMES[e.team]}</b> fish was dropped`); break;
      case 'flagreturn': feed(`🐟 The <b style="color:${TEAM_COLORS[e.team]}">${TEAM_NAMES[e.team]}</b> fish went home`); if (e.by === myId) toast('<small>fish returned</small>', '#5ee07a', 1.2); break;
      case 'capture': {
        const ours = me && me.team === e.team;
        toast(ours ? 'CAPTURE! 🐟' : `<span style="color:${TEAM_COLORS[e.team]}">${TEAM_NAMES[e.team]}</span> captured`, ours ? '#ffd23f' : '#fff', 2.2);
        if (ours) SFX.win(); else SFX.ko();
        break;
      }
      case 'hill': toast('<small>the hill moved! 👑</small>', '#fff', 1.4); tone(520, 0.2, 'triangle', 0.06, 1.5); break;
      case 'hilltake': if (me && me.team === e.team) tone(880, 0.12, 'triangle', 0.05, 1.2); break;
      case 'gate': {
        const near = me && Math.hypot(me.x - e.x, me.z - e.z) < 18;
        if (near || e.by === myId) { noise(0.3, 0.12, 500); tone(e.pass ? 180 : 140, 0.35, 'sawtooth', 0.04, e.pass ? 0.6 : 1.6); }
        if (e.by === myId) toast(e.pass ? '<small>bridge down</small>' : '<small>bridge up! nobody follows you over</small>', e.pass ? '#5ee07a' : '#ff5a5f', 1.1);
        break;
      }
      case 'button': if (e.id === myId) tone(1000, 0.05, 'square', 0.05, 0.8); break;
      case 'portal': {
        burst(e.x, 0.6, e.z, '#c86bff', 12, 4, 0.14, 0.4, 0);
        burst(e.tx, 0.6, e.tz, '#2ee6d6', 16, 5, 0.14, 0.5, 0);
        if (e.id === myId) { tone(500, 0.25, 'sine', 0.07, 3); noise(0.2, 0.08, 4000); }
        break;
      }
      case 'frenzy': toast('FEEDING FRENZY<small>lines sink faster and faster: deep fish are biting</small>', '#ff9f43', 2.2); [330, 392, 494, 659].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.05), i * 70)); break;
      case 'overtime': toast('OVERTIME<small>next KO wins</small>', '#ffd23f', 2.5); break;
      case 'start': {
        const goal = { team: `first team to ${CFG.teamKOs} KOs`, koth: `stand in the ring alone to score · ${CFG.kothWin} wins`, ctf: `steal their golden fish, run it home · ${CFG.ctfCaps} wins` }[e.mode];
        if (goal) toast(`${Sim.TEAM_MODES[e.mode].toUpperCase()}<small>${goal}${me && me.team >= 0 ? ` · you're <b style="color:${TEAM_COLORS[me.team]}">${TEAM_NAMES[me.team]}</b>` : ''}</small>`, '#ffd23f', 2.6);
        else if (e.mode !== 'rounds') toast('GO FISH!', '#ffd23f', 1.5);
        break;
      }
      case 'spawn': if (e.id === myId) { const p = s.players.find((q) => q.id === e.id); if (p) cam.yaw = Math.atan2(p.ax, p.az); cam.pitch = 0.32; } break;
    }
  }
}

// ------------------------------------------------------------------ camera
const camTarget = new THREE.Vector3();
let camInit = false;
function updateCamera(me, dt, t) {
  if (me) {
    const want = new THREE.Vector3(me.x, (me.y || 0) + 1.7, me.z);
    if (!cam.init) { cam.target.copy(want); cam.init = true; }
    cam.target.lerp(want, Math.min(1, dt * 14));
  }
  const f = camForward(), r = { x: -f.z, z: f.x };
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dir = new THREE.Vector3(f.x * cp, -sp, f.z * cp);
  const shoulder = 0.7;
  // pull the camera in rather than letting it end up inside a container or crate stack
  let allow = cam.dist;
  if (mapView && mapView.world.map.boxes.length) {
    for (let k = 1; k <= 16; k++) {
      const d = (cam.dist * k) / 16;
      const x = cam.target.x - dir.x * d - r.x * shoulder * (k / 16), y = cam.target.y - dir.y * d, z = cam.target.z - dir.z * d - r.z * shoulder * (k / 16);
      if (y < 2.9 && mapView.world.map.boxes.some((b) => x > b[0] - 0.35 && x < b[1] + 0.35 && z > b[2] - 0.35 && z < b[3] + 0.35)) { allow = Math.max(1.2, (cam.dist * (k - 1)) / 16); break; }
    }
  }
  cam.cur = cam.cur == null ? allow : allow < cam.cur ? allow : cam.cur + (allow - cam.cur) * Math.min(1, dt * 4);
  const sh = shoulder * Math.min(1, cam.cur / cam.dist);
  camera.position.copy(cam.target).addScaledVector(dir, -cam.cur);
  camera.position.x -= r.x * sh; camera.position.z -= r.z * sh;
  camera.position.y = Math.max(camera.position.y, WATER_Y + 0.6);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.5);
  }
  camera.lookAt(camera.position.clone().add(dir));
  sun.position.set(cam.target.x + 18, 30, cam.target.z + 12);
  sun.target.position.set(cam.target.x, 0, cam.target.z);
}

// ------------------------------------------------------------------ killcam
// A 2-second comic replay: freeze, swing the camera onto whoever got you, slam a stamp naming the fish.
const KILL_VERB = {
  boomerang: 'BOOMERANGED', sardine: 'SARDINED', herring: 'CLUBBED', squid: 'INKED', icecod: 'FROZE & FLOPPED', puffer: 'POPPED',
  eel: 'YANKED', ghost: 'SPOOKED', swordfish: 'SKEWERED', angler: 'LIGHTS OUT', tuna: 'TUNA\'D', mantis: 'PUNCHED INTO NEXT WEEK',
  hammerhead: 'HAMMERED', shark: 'TORPEDOED', narwhal: 'RAILED', kraken: 'KRAKEN\'D',
  flounder: 'STEPPED ON A FLOUNDER', urchin: 'SPIKED', jelly: 'JELLIED', grouper: 'GROUPED UP',
};
const FISH_ICON = {
  boomerang: '🪃', sardine: '🐟', herring: '🐟', squid: '🦑', icecod: '🧊', puffer: '🐡', eel: '⚡', ghost: '👻', swordfish: '🗡️', angler: '💡',
  tuna: '🐟', mantis: '🦐', hammerhead: '🔨', shark: '🦈', narwhal: '🦄', kraken: '🐙', flounder: '💥', urchin: '🟣', jelly: '🪼', grouper: '🐟',
};
let killcam = null;
function startKillcam(s, e) {
  const killer = e.by && s.players.find((q) => q.id === e.by);
  const ringOut = e.cause === 'blast';
  const wname = e.w ? (WEAPONS[e.w] ? WEAPONS[e.w].name : GADGETS[e.w] ? GADGETS[e.w].name : '') : '';
  const verb = !killer ? 'LOST AT SEA' : ringOut ? 'YEETED' : KILL_VERB[e.w] || 'FILLETED';
  const el = $('killcam');
  el.innerHTML = `<div class="kc-flash"></div><div class="kc-lines"></div><div class="kc-bar top"></div><div class="kc-bar bot"></div>
    <div class="kc-stamp">${verb}${ringOut && killer ? '<small>off the map</small>' : ''}</div>
    ${killer ? `<div class="kc-card"><span class="kc-icon">${FISH_ICON[e.w] || '🐟'}</span><span><small>by</small> <b style="color:${killer.color}">${escapeHtml(killer.name)}</b><br><small>with a</small> <b>${escapeHtml(wname || 'fish')}</b></span></div>` : ''}`;
  el.className = 'on';
  killcam = { t: 0, dur: killer ? 2.3 : 1.4, by: killer ? killer.id : null, x: e.x, z: e.z };
  SFX.killcam(!!killer);
}
function stepKillcam(s, me, dt) {
  if (!killcam) return false;
  killcam.t += dt;
  if (killcam.t >= killcam.dur || (me && me.alive && killcam.t > 0.6)) {
    killcam = null;
    $('killcam').className = '';
    return false;
  }
  const kv = killcam.by && views.players.get(killcam.by);
  if (!kv) return false;
  // swing in front of the killer, dolly toward their face, tilt for drama
  const k = Math.min(1, killcam.t / 0.35), ease = 1 - Math.pow(1 - k, 3);
  const kp = s.players.find((q) => q.id === killcam.by);
  const fx = kp ? kp.ax : 0, fz = kp ? kp.az : 1;
  const dist = 5.5 - ease * 2.2 - killcam.t * 0.3;
  const want = new THREE.Vector3(kv.x + fx * dist + fz * 1.2, (kv.y || 0) + 1.6 + (1 - ease) * 2, kv.z + fz * dist - fx * 1.2);
  camera.position.lerp(want, ease);
  camera.lookAt(kv.x, (kv.y || 0) + 1.2, kv.z);
  camera.rotateZ(Math.sin(killcam.t * 2) * 0.08 + 0.1);
  return true;
}

// ink on the screen, the anglerfish blackout and the kraken storm
let lastSplat = 0;
function updateScreenFx(me) {
  const splat = $('splat');
  const st = me && me.alive ? me.splatT : 0;
  if (st > lastSplat + 0.3) {
    // a fresh splat: drop a few blobs that drip down
    splat.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const b = document.createElement('i');
      const size = 90 + Math.random() * 160;
      b.style.cssText = `left:${10 + Math.random() * 70}%;top:${10 + Math.random() * 55}%;width:${size}px;height:${size * (0.8 + Math.random() * 0.4)}px;animation-delay:${i * 40}ms`;
      splat.appendChild(b);
    }
    SFX.splat();
  }
  lastSplat = st;
  splat.style.opacity = Math.min(1, st / 1.2);
  const bl = me && me.alive ? me.blindT : 0;
  $('blind').style.opacity = bl > 0 ? Math.min(1, bl / 0.4) * (bl < 0.5 ? bl / 0.5 : 1) : 0;
  $('storm').style.opacity = me && me.alive && me.dotT > 0 ? Math.min(0.85, me.dotT) : 0;
}

// ------------------------------------------------------------------ loop
let lastT = performance.now();
let menuOrbit = 0;
let lastW = 0, lastH = 0;
function frame(now) {
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) { lastW = window.innerWidth; lastH = window.innerHeight; resize(); }
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;
  animateOcean(t);
  for (const b of buoys) { b.position.y = WATER_Y + waveH(b.position.x, b.position.z, t) - 0.2; b.rotation.z = Math.sin(t * 1.5 + b.position.x) * 0.15; }
  for (const c of clouds) { c.position.x += dt * 1.2; if (c.position.x > 130) c.position.x = -130; }
  stepEffects(dt);

  if (source && playing) {
    const s0 = source.curr;
    const me0 = s0 && s0.players.find((p) => p.id === source.myId);
    const v0 = views.players.get(source.myId);
    readInput(me0 && v0 ? { x: v0.x, z: v0.z } : me0, dt);
    source.tick(dt);
    const s = source.curr;
    if (s) {
      const me = s.players.find((p) => p.id === source.myId);
      if (s.map && (!mapView || mapView.id !== s.map)) buildMap(source.local ? source.game.world : source.world);
      updateMap(s, source.prev, source.alpha, t, dt);
      syncPlayers(s, source.prev, source.alpha, t, dt);
      syncObjectives(s, t, dt);
      syncProjectiles(s, source.prev, source.alpha);
      syncItems(s, t);
      syncTraps(s, t);
      syncPelicans(s, source.prev, source.alpha, t);
      handleEvents(s, me);
      updateHud(s, me);
      drawMinimap(s, me);
      const mv = me && views.players.get(me.id);
      // out of the round: follow whoever is still fighting
      let follow = me && me.alive ? (mv ? { x: mv.x, z: mv.z, y: mv.y } : me) : null;
      if (!follow && me && me.out) { const alive = s.players.find((q) => q.alive); const av = alive && views.players.get(alive.id); if (av) follow = { x: av.x, z: av.z, y: av.y }; }
      updateCamera(follow, dt, t);
      stepKillcam(s, me, dt);
      updateScreenFx(me);
      if (s.phase === 'over' && !$('results').classList.contains('shown')) showResults(s);
      if (s.phase === 'play' && $('results').classList.contains('shown')) { $('results').classList.remove('shown'); $('results').classList.add('hidden'); }
    }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  } else {
    updateMap(null, null, 1, t, dt);
    menuOrbit += dt * 0.08;
    camera.position.set(Math.cos(menuOrbit) * 46, 24, Math.sin(menuOrbit) * 46);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ menus
function seg(id) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
  });
  return () => el.querySelector('.on').dataset.v;
}
function renderGuide() {
  const rows = [];
  for (const r of RARITIES) {
    const list = Object.keys(WEAPONS).filter((id) => WEAPONS[id].rarity === r);
    if (!list.length) continue;
    rows.push(`<div class="ghead" style="color:${r === 'common' ? '#7f8c99' : RARITY_COLORS[r]}">${r.toUpperCase()}${r === 'common' ? ' · half a second of fishing' : r === 'legendary' ? ' · the deep Abyss' : ''}</div>`);
    for (const id of list) {
      const w = WEAPONS[id];
      rows.push(`<div class="gfish" style="border-color:${RARITY_COLORS[r]}"><span class="ic">${FISH_ICON[id] || '🐟'}</span><b>${w.name}</b><small>${w.desc} · ${w.uses} use${w.uses > 1 ? 's' : ''}</small></div>`);
    }
  }
  rows.push('<div class="ghead">GADGETS · bycatch, used with Q</div>');
  for (const id in GADGETS) rows.push(`<div class="gfish" style="border-color:${GADGET_COLOR[id]}"><span class="ic">${GADGET_ICON[id]}</span><b>${GADGETS[id].name}</b><small>${GADGETS[id].desc}</small></div>`);
  $('guideList').innerHTML = rows.join('');
}
$('btnGuide').onclick = () => { renderGuide(); $('menu').classList.add('hidden'); $('guide').classList.remove('hidden'); };
$('btnGuideBack').onclick = () => { $('guide').classList.add('hidden'); $('menu').classList.remove('hidden'); };
const getBots = seg('segBots'), getDiff = seg('segDiff'), getRound = seg('segRound'), getRoundNet = seg('segRoundNet'), getBotsNet = seg('segBotsNet'), getMap = seg('segMap'), getMapNet = seg('segMapNet'), getTeams = seg('segTeams'), getTeamsNet = seg('segTeamsNet');
// team formats only matter for team modes; bot count only for free-for-all
function syncModeRows() {
  const team = !!Sim.TEAM_MODES[getRound()];
  $('rowTeams').classList.toggle('hidden', !team);
  $('rowBots').classList.toggle('hidden', team);
  $('rowTeamsNet').classList.toggle('hidden', !Sim.TEAM_MODES[getRoundNet()]);
  $('modeHint').textContent = {
    rounds: 'last fisher standing wins the round · first to 5',
    300: 'most KOs in 5 minutes · respawn in 1.5 s',
    team: `first team to ${CFG.teamKOs} KOs · no friendly fire`,
    koth: `hold the moving ring with nobody else in it · ${CFG.kothWin} s wins`,
    ctf: `steal their golden fish, run it to your base · ${CFG.ctfCaps} wins`,
  }[getRound()];
}
$('segRound').addEventListener('click', syncModeRows);
$('segRoundNet').addEventListener('click', syncModeRows);
syncModeRows();
// the menu backdrop previews whichever map is picked
$('segMap').addEventListener('click', () => { if (!playing) buildMap(Sim.makeWorld(getMap())); });
buildMap(Sim.makeWorld(getMap()));
try { const n = localStorage.getItem('slapfish.name'); if (n) $('name').value = n; } catch (e) {}
function saveName() { try { localStorage.setItem('slapfish.name', $('name').value); } catch (e) {} }

function clearViews() {
  for (const [, v] of views.players) { scene.remove(v.obj, v.line, v.bobber); v.tag.remove(); }
  for (const [, v] of views.traps) scene.remove(v.m);
  views.traps.clear();
  for (const [, v] of views.projectiles) scene.remove(v.m);
  for (const [, v] of views.items) scene.remove(v.m);
  for (const [, v] of views.pelicans) scene.remove(v.m, v.marker);
  for (const k in views) views[k].clear();
  if (objView.group) scene.remove(objView.group);
  objView.key = ''; objView.group = null;
  lastScoreKey = '';
  $('feed').innerHTML = '';
}

function beginPlay(src) {
  source = src;
  playing = true;
  paused = false;
  camInit = false;
  ['menu', 'online', 'results', 'pause'].forEach((id) => $(id).classList.add('hidden'));
  $('results').classList.remove('shown');
  hud.classList.remove('hidden');
  document.getElementById('touch').classList.toggle('hidden', !touchState.on);
  cam.init = false;
  if (!touchState.on) requestLock();
}
$('btnSolo').onclick = () => {
  ac();
  saveName();
  clearViews();
  // team games fill the teams with bots: 2v2, 3v3, or three teams of two
  const team = !!Sim.TEAM_MODES[getRound()], fmt = getTeams();
  const teams = team ? +fmt[0] : 0, size = team ? +fmt[2] : 0;
  beginPlay(localSource({ name: $('name').value || 'You', bots: team ? teams * size - 1 : +getBots(), teams, difficulty: getDiff(), round: getRound(), map: getMap() }));
};
$('btnOnline').onclick = () => {
  saveName();
  $('menu').classList.add('hidden');
  $('online').classList.remove('hidden');
  const def = location.protocol.startsWith('http') && location.host && !location.host.includes('claude') ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : '';
  if (!$('server').value) $('server').value = def || 'ws://localhost:8080';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('room').value = params.get('room');
};
$('btnBack').onclick = () => {
  if (source && !source.local) source.stop();
  source = null;
  $('online').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('menu').classList.remove('hidden');
};
let netSrc = null;
$('btnConnect').onclick = () => {
  ac();
  if (netSrc) netSrc.stop();
  clearViews();
  $('netStatus').textContent = 'Connecting…';
  netSrc = netSource($('server').value.trim(), $('room').value.trim() || 'pier', $('name').value || 'Angler', (msg) => {
    $('netStatus').textContent = 'Connected. Share the room name with friends.';
    $('lobby').classList.remove('hidden');
    $('lobbyList').innerHTML = msg.players.map((p) => `<li><span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${p.color}"></span>${escapeHtml(p.name)}${p.bot ? ' 🤖' : ''}${p.id === msg.host ? ' (host)' : ''}</li>`).join('');
    const isHost = netSrc.myId === msg.host;
    $('btnStartNet').disabled = !isHost;
    $('btnStartNet').style.opacity = isHost ? 1 : 0.5;
    $('lobbyNote').textContent = isHost ? 'You are the host. Start when everyone is in.' : 'Waiting for the host to start the round.';
    if (msg.phase === 'over' && playing) { /* results already shown */ }
  }, (err) => {
    $('netStatus').textContent = err ? 'Could not connect to ' + $('server').value + '. Is the server running?' : 'Disconnected.';
    if (playing && source === netSrc) { playing = false; hud.classList.add('hidden'); $('online').classList.remove('hidden'); }
  });
};
$('btnStartNet').onclick = () => { if (netSrc) netSrc.start(getRoundNet(), +getBotsNet(), getMapNet(), +getTeamsNet()); };

function togglePause() {
  if (!playing) return;
  if (source.local) paused = !paused;
  $('pause').classList.toggle('hidden', !($('pause').classList.contains('hidden')));
  if (!source.local) $('pause').querySelector('h1').textContent = 'MENU';
}
$('btnResume').onclick = () => { paused = false; $('pause').classList.add('hidden'); if (!touchState.on) requestLock(); };
$('btnQuit').onclick = () => { quitToMenu(); };
function quitToMenu() {
  if (source) source.stop();
  source = null; playing = false; paused = false;
  if (document.pointerLockElement) document.exitPointerLock();
  clearViews();
  hud.classList.add('hidden');
  document.getElementById('touch').classList.add('hidden');
  ['pause', 'results', 'online'].forEach((id) => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
  buildMap(Sim.makeWorld(getMap()));
}
function showResults(s) {
  $('results').classList.add('shown');
  const rounds = s.mode === 'rounds';
  const ranked = [...s.players].sort((a, b) => (rounds ? b.roundWins - a.roundWins : 0) || b.kos - a.kos || a.deaths - b.deaths);
  const win = (s.winner && s.players.find((p) => p.id === s.winner)) || ranked[0];
  const meP = s.players.find((p) => p.id === source.myId);
  if (s.teams && s.winTeam != null) {
    ranked.sort((a, b) => (a.team === s.winTeam ? -1 : 0) - (b.team === s.winTeam ? -1 : 0) || b.kos - a.kos);
    $('resTitle').innerHTML = meP && meP.team === s.winTeam ? 'YOUR TEAM <span>WINS!</span>' : `<b style="color:${TEAM_COLORS[s.winTeam]}">${TEAM_NAMES[s.winTeam]}</b> <span>WINS</span>`;
  } else $('resTitle').innerHTML = win && win.id === source.myId ? 'YOU <span>WIN!</span>' : `${escapeHtml(win ? win.name : '?')} <span>WINS</span>`;
  $('resHead').innerHTML = `<tr><th>Angler</th>${rounds ? '<th>Rounds</th>' : ''}<th>KOs</th><th>Deaths</th><th>Fish caught</th></tr>`;
  $('resBody').innerHTML = ranked.map((p) => `<tr><td><b style="color:${p.color}">${escapeHtml(p.name)}</b></td>${rounds ? `<td>${p.roundWins}</td>` : ''}<td>${p.kos}</td><td>${p.deaths}</td><td>${p.caught}</td></tr>`).join('');
  setTimeout(() => { if (playing) $('results').classList.remove('hidden'); }, 1500);
}
$('btnAgain').onclick = () => {
  $('results').classList.add('hidden');
  $('results').classList.remove('shown');
  clearViews();
  source.restart();
};
$('btnMenu').onclick = quitToMenu;

// expose for debugging / automated tests
window.__slap = { get source() { return source; }, input, THREE, scene };
