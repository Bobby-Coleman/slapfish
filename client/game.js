// Slap Fish - browser client: rendering, input, HUD, and either a local sim (vs bots) or an online connection.
import * as THREE from 'three';
import { buildCharacter, characterFor } from './characters.js';
import { openCharacterSelect, getCharacter, characterName } from './charselect.js';

const Sim = window.SlapSim;
const { WEAPONS, TIERS, RARITIES, RARITY_COLORS, DROPS, GADGETS, MAP, CFG } = Sim;
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

// pier
const pier = new THREE.Group();
scene.add(pier);
const woodA = '#d9a066', woodB = '#c98d55', woodC = '#b97c47', postCol = '#7a5230';
function plankStrip(x0, x1, z0, z1, alongX) {
  // planks run perpendicular to "along"
  const n = Math.round(alongX ? (x1 - x0) : (z1 - z0));
  for (let i = 0; i < n; i++) {
    const col = [woodA, woodB, woodC][(i * 7 + (alongX ? 1 : 0)) % 3];
    const w = 0.94;
    const geo = alongX ? new THREE.BoxGeometry(w, 0.4, z1 - z0) : new THREE.BoxGeometry(x1 - x0, 0.4, w);
    const m = mesh(geo, col);
    if (alongX) m.position.set(x0 + i + 0.5, -0.2, (z0 + z1) / 2);
    else m.position.set((x0 + x1) / 2, -0.2, z0 + i + 0.5);
    pier.add(m);
  }
}
const H = MAP.coreHalf, PH = MAP.pierHalf, PL = MAP.pierLen;
plankStrip(-H, H, -H, H, true);
plankStrip(-PH, PH, H, PL, false);
plankStrip(-PH, PH, -PL, -H, false);
plankStrip(H, PL, -PH, PH, true);
plankStrip(-PL, -H, -PH, PH, true);
// posts
const postGeo = new THREE.CylinderGeometry(0.28, 0.32, 3.2, 6);
function post(x, z) { const p = mesh(postGeo, postCol); p.position.set(x, -1.3, z); pier.add(p); }
for (let i = -H; i <= H; i += 4) { post(i, H); post(i, -H); post(H, i); post(-H, i); }
for (let i = H + 4; i <= PL; i += 4) { post(PH, i); post(-PH, i); post(PH, -i); post(-PH, -i); post(i, PH); post(i, -PH); post(-i, PH); post(-i, -PH); }
// pier tip deep-water buoys
const tips = [[0, PL + 2.5], [0, -PL - 2.5], [PL + 2.5, 0], [-PL - 2.5, 0]];
const buoySpots = [[-6, PL + 1], [6, -PL - 1], [PL + 1, 6], [-PL - 1, -6]];
const buoys = [];
for (const [x, z] of buoySpots) {
  const b = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 8), '#ff5a5f');
  const band = mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.3, 8), '#ffffff');
  band.position.y = 0.1;
  const flag = mesh(new THREE.BoxGeometry(0.05, 0.6, 0.8), '#164f96');
  flag.position.set(0, 1.3, 0.35);
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), '#ffffff');
  pole.position.y = 1.1;
  b.add(body, band, pole, flag);
  b.position.set(x, WATER_Y, z);
  scene.add(b);
  buoys.push(b);
}
// a ring of little buoys marks the edge of the map: get launched past it and you're out
for (let i = 0; i < 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  const b = mesh(new THREE.SphereGeometry(0.35, 8, 6), i % 2 ? '#ffd23f' : '#ff5a5f');
  b.position.set(Math.cos(a) * CFG.blastRadius, WATER_Y, Math.sin(a) * CFG.blastRadius);
  b.userData.phase = i;
  scene.add(b);
  buoys.push(b);
}

// "DEEP" signs at the pier tips
function makeSign(text, x, z, rotY) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#164f96'; ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.y = 1.6;
  const pole = mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), postCol);
  pole.position.y = 0.8;
  g.add(board, pole);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  return g;
}
makeSign('RODS', 0, 0, 0).position.y = 2.2;
makeSign('DEEP', 2.4, PL - 0.5, 0);
makeSign('DEEP', -2.4, -PL + 0.5, Math.PI);
makeSign('DEEP', PL - 0.5, -2.4, Math.PI / 2);
makeSign('DEEP', -PL + 0.5, 2.4, -Math.PI / 2);

// obstacles: barrels + rope coils
for (const o of MAP.obstacles) {
  const g = new THREE.Group();
  const big = o.r > 0.8;
  const col = big ? '#e8613c' : '#3fa7ff';
  const b = mesh(new THREE.CylinderGeometry(o.r, o.r, 1.4, 10), col);
  b.position.y = 0.7;
  const r1 = mesh(new THREE.CylinderGeometry(o.r + 0.04, o.r + 0.04, 0.12, 10), '#3b3b4f');
  r1.position.y = 0.3;
  const r2 = r1.clone(); r2.position.y = 1.1;
  g.add(b, r1, r2);
  g.position.set(o.x, 0, o.z);
  scene.add(g);
}
// rod rack in the middle
const rack = new THREE.Group();
scene.add(rack);
{
  const base = mesh(new THREE.CylinderGeometry(MAP.rack.r, MAP.rack.r + 0.2, 0.5, 8), '#7a5230');
  base.position.y = 0.25;
  const top = mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 6), '#7a5230');
  top.position.y = 1.4;
  const roof = mesh(new THREE.ConeGeometry(1.4, 0.8, 8), '#ff5a5f');
  roof.position.y = 2.9;
  rack.add(base, top, roof);
}
const rackRods = [];
function ensureRackRods(n) {
  while (rackRods.length < n) { const r = makeRod(); rack.add(r); rackRods.push(r); }
  rackRods.forEach((r, i) => {
    const a = (i / n) * Math.PI * 2;
    r.position.set(Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85);
    r.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
    r.visible = i < n;
  });
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
  const body = mesh(sphereGeo, L.body);
  body.scale.set(gi * 0.8, gi, len / 2);
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

function makePlayer(color, char) {
  const root = new THREE.Group();
  // the character supplies the body, feet and fish hand; everything below is shared gameplay dressing
  const ch = buildCharacter(char, color);
  const { bodyG, hand, footL, footR } = ch;
  root.add(bodyG, footL, footR);
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
  root.userData = { bodyG, hand, rod, footL, footR, arrow, bubble, armorShell, ring, tick: ch.tick, fishId: null, fishMesh: null, walk: 0 };
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
  catch: (r) => { const base = 520 + RARITIES.indexOf(r) * 90; tone(base, 0.12, 'triangle', 0.1); setTimeout(() => tone(base * 1.5, 0.2, 'triangle', 0.1), 110); if (r === 'legendary' || r === 'epic') setTimeout(() => tone(base * 2, 0.3, 'triangle', 0.1), 230); },
  snap: () => tone(1200, 0.12, 'sawtooth', 0.06, 0.3),
  zap: () => { tone(1400, 0.15, 'sawtooth', 0.05, 0.2); noise(0.1, 0.1, 5000); },
  pickup: () => tone(780, 0.1, 'triangle', 0.08, 1.5),
  ko: () => { tone(300, 0.3, 'square', 0.08, 0.3); },
  pelican: () => { tone(500, 0.1, 'square', 0.04, 1.4); setTimeout(() => tone(450, 0.12, 'square', 0.04, 1.3), 140); },
  tier: () => tone(340, 0.18, 'sine', 0.07, 0.7),
};

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
  const g = Sim.createGame({ roundSeconds: opts.round });
  g.addPlayer('me', opts.name, false, undefined, opts.char);
  const names = ['Captain Cod', 'Salty Sue', 'Barnacle Bo', 'Gill Bates', 'Reel Steel'];
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

function netSource(url, room, name, char, onLobby, onClose) {
  const ws = new WebSocket(url);
  let lastSnapAt = 0, interval = 50, sendAcc = 0, seq = 0;
  const hist = []; // inputs the server hasn't acknowledged yet, replayed for prediction
  const pending = { dash: false, fish: false, use: false, gadget: false };
  const src = {
    myId: null, local: false, events: [], curr: null, prev: null, alpha: 1, ws, pred: null, off: { x: 0, z: 0 },
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
        ws.send(JSON.stringify({ t: 'input', i: Object.assign({}, input, pending, { seq }) }));
        hist.push({ seq, mx: input.mx, mz: input.mz });
        if (hist.length > 90) hist.shift();
        if (src.pred) Sim.walkStep(src.pred, input.mx, input.mz, STEP);
        pending.dash = pending.fish = pending.use = pending.gadget = false;
      }
    },
    setChar(c) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'char', char: c })); },
    start(round, bots) { ws.send(JSON.stringify({ t: 'start', round, bots })); },
    restart() { ws.send(JSON.stringify({ t: 'start' })); },
    stop() { try { ws.close(); } catch (e) {} },
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, char }));
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
      // client-side prediction for our own walking; anything else (dash, knockback, fishing) follows the server
      const me = msg.s.players.find((p) => p.id === src.myId);
      if (me && me.alive && !me.air && !me.swim && me.climbT <= 0 && !me.fishing && me.kbT <= 0 && me.dashT <= 0 && me.stunT <= 0 && me.ack != null) {
        const np = { x: me.x, z: me.z, vx: me.vx, vz: me.vz, weapon: me.weapon, slowT: me.slowT };
        while (hist.length && hist[0].seq <= me.ack) hist.shift();
        for (const h of hist) Sim.walkStep(np, h.mx, h.mz, STEP);
        if (src.pred) {
          src.off.x += src.pred.x - np.x; src.off.z += src.pred.z - np.z;
          if (Math.hypot(src.off.x, src.off.z) > 3) src.off.x = src.off.z = 0;
        }
        src.pred = np;
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
    if (!v) {
      const char = characterFor(p.id, p.char);
      const obj = makePlayer(p.color, char);
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
      v = { obj, tag, line, bobber, tierRing, char, x: p.x, z: p.z, y: 0, rippleT: 0 };
      views.players.set(p.id, v);
    }
    const o = v.obj, u = o.userData;
    if (u.tick) u.tick(t);
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
    // flashing when invulnerable
    u.bodyG.visible = !(p.invulnT > 0 && Math.floor(t * 12) % 2 === 0);
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
    if (u.fishMesh) {
      const swing = p.swingT > 0 ? Math.sin((p.swingT / 0.2) * Math.PI) : 0;
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
    const vis = o.visible && head.z < 1 && p.id !== source.myId && !inked;
    v.tag.style.display = vis ? '' : 'none';
    if (vis) {
      v.tag.style.left = ((head.x + 1) / 2) * window.innerWidth + 'px';
      v.tag.style.top = ((1 - head.y) / 2) * window.innerHeight + 'px';
      const nm = v.tag.querySelector('.nm');
      nm.textContent = p.name;
      nm.style.color = p.color;
      const pc = v.tag.querySelector('.pc');
      pc.textContent = p.pct + '%' + (p.armor > 0 ? ' 🦀' : '');
      pc.style.color = pctColor(p.pct);
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
    if (!seen.has(id)) { scene.remove(v.obj, v.line, v.bobber); v.tag.remove(); views.players.delete(id); }
  }
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
      if (GADGETS[pr.w]) { m = pr.w === 'grouper' ? mesh(lowSphere, '#2b2b2b') : makeGadget(pr.w === 'urchin' ? 'urchin' : 'ink'); if (pr.w === 'grouper') m.scale.setScalar(0.28); if (pr.w === 'ink') m.scale.setScalar(0.18); }
      else if (pr.w === 'shark' || pr.w === 'puffer' || pr.w === 'tuna') { m = makeFish(pr.w); m.scale.setScalar(pr.w === 'puffer' ? 1 : 0.8); }
      else if (pr.w === 'narwhal') { m = mesh(new THREE.ConeGeometry(0.12, 1.4, 6), '#ffcc33'); m.geometry.rotateX(Math.PI / 2); }
      else { const L = PROJ_LOOK[pr.w] || ['#fff', 0.2]; m = mesh(lowSphere, L[0]); m.scale.setScalar(L[1]); }
      scene.add(m);
      v = { m };
      views.projectiles.set(pr.id, v);
    }
    const pos = interp(prev && prev.projectiles, pr, alpha);
    v.m.position.set(pos.x, 0.9 + (pr.h || 0), pos.z);
    if (pr.vx || pr.vz) v.m.rotation.y = Math.atan2(pr.vx, pr.vz);
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
function floatText(x, y, z, text, color) {
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.color = color;
  tagsEl.appendChild(el);
  const start = performance.now();
  const p = new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z);
  (function anim() {
    const k = (performance.now() - start) / 800;
    if (k >= 1) { el.remove(); return; }
    const v = p.clone(); v.y += k * 1.5;
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
  $('timer').textContent = s.overtime && s.roundLeft <= 0 ? 'OVERTIME' : fmtTime(s.roundLeft);
  $('timer').classList.toggle('ot', s.roundLeft < 30);
  const sorted = [...s.players].sort((a, b) => b.kos - a.kos);
  const key = sorted.map((p) => p.id + p.kos).join();
  if (key !== lastScoreKey) {
    lastScoreKey = key;
    document.querySelectorAll('#topbar .score').forEach((e) => e.remove());
    for (const p of sorted) {
      const d = document.createElement('div');
      d.className = 'score' + (me && p.id === me.id ? ' me' : '');
      d.innerHTML = `<span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)} <b>${p.kos}</b>`;
      $('topbar').appendChild(d);
    }
  }
  if (!me) return;
  if (touchState.on) $('tFish').textContent = me.fishing ? (me.fishing.depth < CFG.fishMinBite ? 'CANCEL' : 'REEL') : 'CAST';
  $('pct').textContent = me.alive ? me.pct + '%' : 'KO';
  $('pct').style.color = pctColor(me.pct);
  $('pctsub').textContent = me.alive ? (me.swim ? 'Swim back to the pier!' : 'damage') : 'back in ' + Math.ceil(me.respawnT);
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
    $('wname').textContent = 'Slap';
    $('wname').style.color = '#fff';
    $('wdesc').textContent = me.hasRod ? 'Out of fish! Cast off any edge.' : 'Grab a rod from the rack in the middle.';
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
    else if (!me.hasRod && !me.weapon) msg = 'Run to the rod rack in the middle';
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
    $('needle').style.top = Math.min(100, (d / 26) * 100) + '%';
    const tier = Sim.tierFor(d);
    const total = tier.w.reduce((a, b) => a + b, 0);
    $('odds').innerHTML = tier.w.map((w, i) => (w ? `<i style="width:${(w / total) * 100}%;background:${RARITY_COLORS[RARITIES[i]]}"></i>` : '')).join('');
    $('oddsTxt').textContent = d < CFG.fishMinBite ? 'Waiting for a bite…' : tier.w.map((w, i) => (w ? `${RARITIES[i][0].toUpperCase()}${Math.round((w / total) * 100)}%` : '')).filter(Boolean).join(' ');
    $('reelhint').textContent = me.fishing.reelT > 0 ? 'Reeling in…' : d < CFG.fishMinBite ? 'R cancels · Space bails' : me.fishing.biteT > 0 ? 'BITE! Reel now!' : 'R to reel in';
    $('reelhint').style.color = me.fishing.biteT > 0 ? '#ffd23f' : '';
    fp.querySelector('h3').textContent = me.fishing.mult > 1.01 ? `Line in ×${me.fishing.mult.toFixed(2)}` : 'Line in the water';
  } else fp.classList.add('hidden');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

const mm = $('minimap').getContext('2d');
function drawMinimap(s, me) {
  const W = 300, sc = W / 64;
  mm.clearRect(0, 0, W, W);
  mm.save();
  mm.translate(W / 2, W / 2);
  mm.fillStyle = '#d9a066';
  mm.fillRect(-H * sc, -H * sc, 2 * H * sc, 2 * H * sc);
  mm.fillRect(-PH * sc, -PL * sc, 2 * PH * sc, 2 * PL * sc);
  mm.fillRect(-PL * sc, -PH * sc, 2 * PL * sc, 2 * PH * sc);
  mm.fillStyle = '#164f96';
  for (const [x, z] of tips) { mm.beginPath(); mm.arc(x * sc, z * sc, 7, 0, 7); mm.fill(); }
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
        if (w.kind === 'shot' || w.kind === 'pierce' || w.kind === 'rocket') SFX.shoot();
        if (w.kind === 'melee') ringFx(e.x + e.ax * 1.2, e.z + e.az * 1.2, w.range * 0.6, '#ffffff', 0);
        if (e.w === 'squid') burst(e.x + e.ax, 1, e.z + e.az, '#3b2a5a', 3, 2, 0.1, 0.3);
        break;
      }
      case 'boom': boomFx(e.x, e.z, e.r); SFX.boom(); shake = Math.max(shake, e.slam ? 0.25 : 0.4); break;
      case 'zap': zapFx(e.pts); SFX.zap(); break;
      case 'gadget':
        if (e.id === myId) { SFX.pickup(); toast(`${GADGET_ICON[e.g]} ${GADGETS[e.g].name} x${e.n}<small>Bycatch! Press Q to use. ${GADGETS[e.g].desc}</small>`, GADGET_COLOR[e.g], 2); }
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
        if (e.by) feed(`${nameOf(s, e.by)} launched ${nameOf(s, e.id)} off the map 💥`);
        else feed(`${nameOf(s, e.id)} drifted out to sea`);
        if (e.id === myId) toast('KNOCKED OUT', '#ff5a5f', 2);
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
        if (e.id === myId) {
          toast(`${e.perfect ? 'PERFECT! ' : ''}${w.name}<small style="color:${RARITY_COLORS[e.rarity]}">${e.rarity.toUpperCase()} · ${w.desc}${e.perfect ? ' · +25% ammo' : ''}</small>`, RARITY_COLORS[e.rarity], 2.4);
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
      case 'norod': if (e.id === myId) toast('No rod! Grab one in the middle.', '#fff', 1.2); break;
      case 'dash': { const p = s.players.find((q) => q.id === e.id); if (p) burst(p.x, 0.3, p.z, '#ffffff', 4, 2, 0.12, 0.3, 2); break; }
      case 'overtime': toast('OVERTIME<small>next KO wins</small>', '#ffd23f', 2.5); break;
      case 'start': toast('GO FISH!', '#ffd23f', 1.5); break;
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
  camera.position.copy(cam.target).addScaledVector(dir, -cam.dist);
  camera.position.x -= r.x * shoulder; camera.position.z -= r.z * shoulder;
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
      ensureRackRods(s.rack.length);
      rackRods.forEach((r, i) => (r.visible = !!s.rack[i]));
      syncPlayers(s, source.prev, source.alpha, t, dt);
      syncProjectiles(s, source.prev, source.alpha);
      syncItems(s, t);
      syncTraps(s, t);
      syncPelicans(s, source.prev, source.alpha, t);
      handleEvents(s, me);
      updateHud(s, me);
      drawMinimap(s, me);
      const mv = me && views.players.get(me.id);
      updateCamera(me && me.alive ? (mv ? { x: mv.x, z: mv.z, y: mv.y } : me) : null, dt, t);
      if (s.phase === 'over' && !$('results').classList.contains('shown')) showResults(s);
      if (s.phase === 'play' && $('results').classList.contains('shown')) { $('results').classList.remove('shown'); $('results').classList.add('hidden'); }
    }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  } else {
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
const getBots = seg('segBots'), getDiff = seg('segDiff'), getRound = seg('segRound'), getRoundNet = seg('segRoundNet'), getBotsNet = seg('segBotsNet');
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
  beginPlay(localSource({ name: $('name').value || 'You', char: getCharacter(), bots: +getBots(), difficulty: getDiff(), round: +getRound() }));
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
  netSrc = netSource($('server').value.trim(), $('room').value.trim() || 'pier', $('name').value || 'Angler', getCharacter(), (msg) => {
    $('netStatus').textContent = 'Connected. Share the room name with friends.';
    $('lobby').classList.remove('hidden');
    $('lobbyList').innerHTML = msg.players.map((p) => `<li><span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${p.color}"></span>${escapeHtml(p.name)} <small style="opacity:.7">${escapeHtml(characterName(characterFor(p.id, p.char)))}</small>${p.bot ? ' 🤖' : ''}${p.id === msg.host ? ' (host)' : ''}</li>`).join('');
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
$('btnStartNet').onclick = () => { if (netSrc) netSrc.start(+getRoundNet(), +getBotsNet()); };

// character select: the menu button shows the current pick and opens the select screen
function showCharPick() { $('btnChar').textContent = characterName(getCharacter()) + ' ▸'; }
showCharPick();
$('btnChar').onclick = () => openCharacterSelect({
  onPick: (id) => { showCharPick(); if (netSrc && !playing) netSrc.setChar(id); },
});
$('btnCharNet').onclick = $('btnChar').onclick;

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
}
function showResults(s) {
  $('results').classList.add('shown');
  const ranked = [...s.players].sort((a, b) => b.kos - a.kos || a.deaths - b.deaths);
  const win = ranked[0];
  $('resTitle').innerHTML = win && win.id === source.myId ? 'YOU <span>WIN!</span>' : `${escapeHtml(win ? win.name : '?')} <span>WINS</span>`;
  $('resBody').innerHTML = ranked.map((p) => `<tr><td><b style="color:${p.color}">${escapeHtml(p.name)}</b></td><td>${p.kos}</td><td>${p.deaths}</td><td>${p.caught}</td></tr>`).join('');
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
