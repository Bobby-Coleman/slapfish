// Slap Fish - playable characters. Cosmetic only: every character uses the same hitbox and stats.
// buildCharacter(id, color) returns the parts the renderer animates: { bodyG, footL, footR, hand, tick }.
//   bodyG  bobs and leans with the waddle, footL/footR swing on z (rest z = 0.03), hand holds the fish.
//   tick(t) is optional idle animation (claws snapping, goldfish swimming), called once per frame.
// `color` is the player's color from the sim; every character wears it somewhere so players stay readable.
import * as THREE from 'three';

export const CHARACTERS = [
  { id: 'skipper', name: 'Skipper', tag: 'The classic. Hat, vest, unearned confidence.' },
  { id: 'gillguy', name: 'Gill Guy', tag: 'Half man, half fish, all slap.' },
  { id: 'sigma', name: 'Sigma Salmon', tag: 'Up at 4am for cold plunges. He lives in the ocean.' },
  { id: 'shark', name: 'Sneaker Shark', tag: 'Tralala energy. Three sneakers, zero explanations.' },
  { id: 'crab', name: 'Rave Crab', tag: 'Has been dancing since 2016. Cannot stop.' },
  { id: 'capy', name: 'Capy Chill', tag: 'Unbothered. Moisturized. Holding a fish.' },
  { id: 'dad', name: 'Bucket Hat Dad', tag: '"They\'re biting today." They are not.' },
  { id: 'captain', name: "Cap'n Barnacle", tag: 'Lost a leg to a sardine. Still holds a grudge.' },
  { id: 'bowl', name: 'Bowl Boss', tag: 'A goldfish piloting a diving suit. Allegedly.' },
  { id: 'lobster', name: 'Lobster Lawyer', tag: 'Objection! (Slaps you with a mackerel.)' },
  { id: 'octo', name: 'Uncle Octo', tag: 'Eight arms. Every one of them slaps.' },
  { id: 'npc', name: 'Background NPC', tag: 'Default settings. Has a quest for you. The quest is fish.' },
  { id: 'trench', name: 'Definitely A Guy', tag: 'One normal adult man. Not three fish in a coat.' },
];
export const DEFAULT_CHARACTER = 'skipper';
const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
export function isCharacter(id) { return !!BY_ID[id]; }

// Bots and players without a pick get a stable character from their id, so every client agrees.
export function characterFor(id, picked) {
  if (picked && BY_ID[picked]) return picked;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHARACTERS[1 + (h % (CHARACTERS.length - 1))].id;
}

// ------------------------------------------------------------------ toon kit
const grad = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const matCache = {};
function mat(color, opts) {
  const key = color + JSON.stringify(opts || {});
  if (!matCache[key]) matCache[key] = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: grad }, opts || {}));
  return matCache[key];
}
const geoCache = {};
function geo(key, make) { return geoCache[key] || (geoCache[key] = make()); }
const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 12, 10));
const LOW = () => geo('low', () => new THREE.SphereGeometry(1, 7, 5));
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 10));
const CONE = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 8));
const CAP = (r, l) => geo('cap' + r + ':' + l, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const TORUS = (r, t) => geo('tor' + r + ':' + t, () => new THREE.TorusGeometry(r, t, 6, 18));
const TAPER = (a, b) => geo('tap' + a + ':' + b, () => new THREE.CylinderGeometry(a, b, 1, 12));

// put(parent, geometry, color, [x,y,z], scale (number or [x,y,z]), [rx,ry,rz], material opts)
function put(parent, g, color, p, s, r, opts) {
  const m = new THREE.Mesh(g, mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  if (p) m.position.set(p[0], p[1], p[2]);
  if (s != null) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (parent) parent.add(m);
  return m;
}
function group(parent, p) {
  const g = new THREE.Group();
  if (p) g.position.set(p[0], p[1], p[2]);
  if (parent) parent.add(g);
  return g;
}
function darken(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }

const SKIN = '#ffd7b0';
const INK = '#10223a';

// The shared frame: a body group, two feet, a left arm nub and the right hand that holds the fish.
function frame(o) {
  const bodyG = new THREE.Group();
  const footL = group(null, [0.17, 0, 0.03]);
  const footR = group(null, [-0.17, 0, 0.03]);
  if (o.foot !== false) for (const f of [footL, footR]) put(f, BOX(), o.foot || '#3b3b4f', [0, 0.08, 0], o.footSize || [0.2, 0.15, 0.32]);
  const hand = group(bodyG, o.handPos || [-0.45, 0.95, 0.35]);
  if (o.handColor) put(hand, LOW(), o.handColor, null, o.handSize || 0.12);
  if (o.armColor) put(bodyG, LOW(), o.armColor, [0.48, 0.9, 0.1], 0.12);
  return { bodyG, footL, footR, hand, tick: null };
}

function eyes(g, y, z, x, size, color) {
  put(g, LOW(), color || INK, [x, y, z], size || 0.055);
  put(g, LOW(), color || INK, [-x, y, z], size || 0.055);
}

// A fish's head on a person's neck: wide eyes on the sides, pouty lips, a dorsal fin and gill slits.
function fishHead(g, o) {
  const y = o.y != null ? o.y : 1.5;
  const w = o.w || 1;
  put(g, SPH(), o.body, [0, y, 0.05], [0.4 * w, 0.4, 0.56]);
  put(g, SPH(), o.belly, [0, y - 0.13, 0.12], [0.34 * w, 0.26, 0.48]);
  if (o.eyes !== false) {
    for (const s of [1, -1]) {
      put(g, LOW(), '#ffffff', [s * 0.3 * w, y + 0.1, 0.24], 0.14);
      put(g, LOW(), INK, [s * 0.37 * w, y + 0.11, 0.3], 0.07);
    }
  }
  if (o.lips !== false) put(g, SPH(), o.lips || '#ff8fa3', [0, y - 0.06, 0.6], [0.15, 0.08, 0.07]);
  if (o.fin !== false) put(g, BOX(), o.finColor || darken(o.body, 0.75), [0, y + 0.42, -0.08], [0.05, 0.32, 0.42], [0.35, 0, 0]);
  for (const s of [1, -1]) put(g, BOX(), darken(o.body, 0.7), [s * 0.37 * w, y - 0.04, -0.14], [0.02, 0.18, 0.05]);
}

// ------------------------------------------------------------------ the roster
const BUILD = {
  skipper(color) {
    const c = frame({ handColor: SKIN, armColor: color });
    const b = c.bodyG;
    put(b, CAP(0.42, 0.45), color, [0, 0.78, 0]);
    put(b, CAP(0.44, 0.2), '#ffd23f', [0, 0.72, 0], [1, 0.9, 1]);
    put(b, SPH(), SKIN, [0, 1.5, 0], 0.34);
    put(b, TAPER(0.26, 0.32), darken(color, 0.8), [0, 1.78, 0], [1, 0.25, 1]);
    put(b, CYL(), darken(color, 0.8), [0, 1.68, 0], [0.5, 0.05, 0.5]);
    eyes(b, 1.53, 0.3, 0.12);
    put(b, LOW(), '#ffb48a', [0, 1.45, 0.34], 0.07);
    return c;
  },

  gillguy(color) {
    const fish = '#4fb39c';
    const c = frame({ handColor: fish, armColor: fish, foot: '#2f8a78', footSize: [0.26, 0.08, 0.44] });
    const b = c.bodyG;
    put(b, CAP(0.42, 0.45), color, [0, 0.78, 0]);
    put(b, CAP(0.44, 0.2), '#3e5c8a', [0, 0.6, 0], [1, 0.75, 1]);
    for (const s of [1, -1]) put(b, BOX(), '#3e5c8a', [s * 0.2, 0.98, 0.33], [0.08, 0.4, 0.05], [0.25, 0, 0]);
    put(b, LOW(), '#ffd23f', [0.2, 0.86, 0.43], 0.04);
    put(b, LOW(), '#ffd23f', [-0.2, 0.86, 0.43], 0.04);
    fishHead(b, { body: fish, belly: '#d8f5e8', lips: '#ff8fa3', finColor: '#2f8a78', y: 1.52 });
    // webbed fins on the elbows
    put(b, BOX(), '#2f8a78', [0.55, 0.95, 0], [0.04, 0.2, 0.22], [0, 0, -0.4]);
    return c;
  },

  sigma(color) {
    const fish = '#ff8a65';
    const c = frame({ handColor: fish, armColor: fish });
    const b = c.bodyG;
    put(b, CAP(0.44, 0.45), color, [0, 0.78, 0], [1.1, 1, 1]);
    fishHead(b, { body: fish, belly: '#ffd0bf', lips: '#d9443c', finColor: '#e2614d', eyes: false, y: 1.55 });
    // wraparound shades, chiseled jaw, gold chain
    put(b, BOX(), '#111111', [0, 1.66, 0.42], [0.86, 0.12, 0.2]);
    put(b, BOX(), '#2a2a2a', [0, 1.72, 0.44], [0.86, 0.03, 0.2]);
    put(b, BOX(), fish, [0, 1.27, 0.2], [0.66, 0.26, 0.52]);
    put(b, BOX(), darken(fish, 0.85), [0, 1.2, 0.47], [0.36, 0.1, 0.06]);
    put(b, TORUS(0.3, 0.035), '#ffcc33', [0, 1.13, 0.06], 1, [Math.PI / 2 - 0.35, 0, 0], { emissive: '#664400' });
    put(b, BOX(), '#ffcc33', [0, 1.0, 0.4], [0.1, 0.12, 0.03], null, { emissive: '#664400' });
    return c;
  },

  shark(color) {
    const grey = '#7f9bb3', belly = '#f4f4f4';
    const c = frame({ handColor: grey, armColor: grey, foot: false });
    const b = c.bodyG;
    put(b, CAP(0.44, 0.5), grey, [0, 0.8, 0]);
    put(b, CAP(0.36, 0.4), belly, [0, 0.76, 0.12], [1, 1, 0.9]);
    // big shark head with a toothy grin
    put(b, SPH(), grey, [0, 1.5, 0.1], [0.44, 0.42, 0.62]);
    put(b, SPH(), belly, [0, 1.36, 0.2], [0.38, 0.22, 0.52]);
    put(b, BOX(), '#3a1f2b', [0, 1.4, 0.56], [0.42, 0.08, 0.14]);
    for (let i = 0; i < 5; i++) put(b, CONE(), '#ffffff', [-0.16 + i * 0.08, 1.42, 0.62], [0.03, 0.07, 0.03], [Math.PI, 0, 0]);
    eyes(b, 1.62, 0.42, 0.24, 0.05);
    put(b, CONE(), grey, [0, 1.98, -0.05], [0.07, 0.42, 0.24], [-0.3, 0, 0]);
    put(b, CONE(), grey, [0, 0.9, -0.55], [0.06, 0.36, 0.2], [-1.9, 0, 0]);
    put(b, BOX(), grey, [0.5, 1.0, 0.05], [0.04, 0.12, 0.3], [0, 0, -0.6]);
    // sneakers in the player's color: two that walk, one extra out back that just comes along
    const sneaker = (g, p) => {
      put(g, BOX(), color, [p[0], p[1] + 0.1, p[2]], [0.24, 0.16, 0.4]);
      put(g, BOX(), '#ffffff', [p[0], p[1] + 0.025, p[2] + 0.01], [0.26, 0.05, 0.44]);
      put(g, BOX(), '#ffffff', [p[0] + 0.125, p[1] + 0.1, p[2] - 0.02], [0.01, 0.05, 0.22], [0, 0, 0]);
    };
    sneaker(c.footL, [0, 0, 0]);
    sneaker(c.footR, [0, 0, 0]);
    put(b, CYL(), grey, [0, 0.3, -0.42], [0.08, 0.3, 0.08], [0.5, 0, 0]);
    sneaker(b, [0, 0.0, -0.55]);
    return c;
  },

  crab(color) {
    const red = '#e8452c', pale = '#ffb199';
    const c = frame({ foot: red, footSize: [0.14, 0.1, 0.2], handPos: [-0.6, 0.95, 0.35] });
    const b = c.bodyG;
    put(b, SPH(), red, [0, 0.85, 0], [0.62, 0.42, 0.5]);
    put(b, SPH(), pale, [0, 0.72, 0.06], [0.54, 0.26, 0.44]);
    for (const s of [1, -1]) {
      put(b, LOW(), '#ff7a5c', [s * 0.25, 1.12, 0.08], [0.1, 0.05, 0.1]);
      put(b, CYL(), red, [s * 0.15, 1.38, 0.22], [0.035, 0.38, 0.035], [0, 0, s * -0.15]);
      put(b, LOW(), '#ffffff', [s * 0.18, 1.6, 0.24], 0.11);
      put(b, LOW(), INK, [s * 0.18, 1.6, 0.34], 0.055);
      for (let i = 0; i < 3; i++) put(b, CYL(), red, [s * 0.58, 0.45, -0.2 + i * 0.18], [0.035, 0.45, 0.035], [0, 0, s * 0.7]);
    }
    put(b, BOX(), INK, [0, 0.95, 0.47], [0.16, 0.03, 0.03]);
    // glow-stick necklace in the player's color
    put(b, TORUS(0.4, 0.035), color, [0, 1.02, 0.04], [1, 1, 1], [Math.PI / 2 - 0.2, 0, 0], { emissive: color, emissiveIntensity: 0.6 });
    // big snapping claws
    const claw = (g, scale) => {
      put(g, SPH(), red, [0, 0, 0], [0.16 * scale, 0.13 * scale, 0.2 * scale]);
      const top = group(g, [0, 0.04 * scale, 0.12 * scale]);
      put(top, SPH(), red, [0, 0.05 * scale, 0.1 * scale], [0.07 * scale, 0.05 * scale, 0.16 * scale]);
      put(g, SPH(), red, [0, -0.06 * scale, 0.22 * scale], [0.07 * scale, 0.05 * scale, 0.14 * scale]);
      return top;
    };
    const armL = group(b, [0.62, 0.95, 0.2]);
    put(armL, CYL(), red, [-0.05, -0.05, -0.1], [0.05, 0.3, 0.05], [1.0, 0, 0.3]);
    const pincerL = claw(armL, 1.5);
    const pincerR = claw(c.hand, 0.9);
    c.tick = (t) => {
      pincerL.rotation.x = -Math.abs(Math.sin(t * 6)) * 0.6;
      pincerR.rotation.x = -Math.abs(Math.sin(t * 6 + 1.5)) * 0.5;
    };
    return c;
  },

  capy(color) {
    const fur = '#a0703f', dark = '#6b4526';
    const c = frame({ handColor: fur, armColor: fur, foot: dark, footSize: [0.2, 0.13, 0.28] });
    const b = c.bodyG;
    put(b, CAP(0.46, 0.4), fur, [0, 0.78, 0], [1.05, 1, 1]);
    put(b, SPH(), fur, [0, 1.42, 0.1], [0.36, 0.33, 0.5]);
    put(b, SPH(), dark, [0, 1.38, 0.52], [0.22, 0.17, 0.13]);
    put(b, LOW(), INK, [0.07, 1.42, 0.63], 0.025);
    put(b, LOW(), INK, [-0.07, 1.42, 0.63], 0.025);
    for (const s of [1, -1]) {
      put(b, BOX(), INK, [s * 0.18, 1.52, 0.4], [0.1, 0.022, 0.03], [0, 0, s * 0.1]);
      put(b, LOW(), dark, [s * 0.22, 1.72, -0.08], [0.07, 0.06, 0.04]);
    }
    // the yuzu on top, and a scarf in the player's color
    put(b, SPH(), '#ff9a1f', [0, 1.86, 0.05], 0.15);
    put(b, BOX(), '#4caf50', [0.06, 2.02, 0.05], [0.12, 0.02, 0.06], [0, 0, 0.4]);
    put(b, TORUS(0.32, 0.07), color, [0, 1.16, 0.05], 1, [Math.PI / 2 - 0.15, 0, 0]);
    put(b, BOX(), color, [0.18, 0.98, 0.32], [0.12, 0.3, 0.06], [0.2, 0, 0.2]);
    return c;
  },

  dad(color) {
    const khaki = '#c8b38a';
    const c = frame({ handColor: SKIN, armColor: color, foot: false });
    const b = c.bodyG;
    put(b, CAP(0.45, 0.45), color, [0, 0.78, 0], [1.12, 1, 1.08]);
    for (let i = 0; i < 4; i++) put(b, LOW(), '#ffffff', [-0.2 + i * 0.13, 0.62 + (i % 2) * 0.28, 0.46], [0.06, 0.06, 0.02]);
    for (const s of [1, -1]) {
      put(b, BOX(), khaki, [s * 0.3, 0.8, 0.28], [0.22, 0.62, 0.22]);
      put(b, BOX(), darken(khaki, 0.85), [s * 0.3, 0.75, 0.4], [0.16, 0.14, 0.03]);
    }
    put(b, SPH(), SKIN, [0, 1.5, 0], 0.34);
    // bucket hat with lures stuck in it
    put(b, TAPER(0.3, 0.34), khaki, [0, 1.76, 0], [1, 0.24, 1]);
    put(b, TAPER(0.36, 0.52), khaki, [0, 1.65, 0], [1, 0.08, 1]);
    put(b, LOW(), '#ff3b3b', [0.25, 1.78, 0.15], 0.04);
    put(b, LOW(), '#3fa7ff', [-0.2, 1.8, 0.2], 0.04);
    put(b, LOW(), '#ffd23f', [0.05, 1.82, 0.3], 0.035);
    // aviators and the mustache
    for (const s of [1, -1]) put(b, SPH(), '#1b2a3a', [s * 0.13, 1.53, 0.3], [0.1, 0.07, 0.03]);
    put(b, BOX(), '#c0c0c0', [0, 1.55, 0.32], [0.08, 0.015, 0.015]);
    put(b, BOX(), '#6b4526', [0, 1.4, 0.32], [0.24, 0.06, 0.06]);
    // white socks and sandals
    for (const f of [c.footL, c.footR]) {
      put(f, CYL(), '#ffffff', [0, 0.17, -0.04], [0.09, 0.22, 0.09]);
      put(f, BOX(), '#8a5a2b', [0, 0.03, 0.02], [0.22, 0.06, 0.36]);
      put(f, BOX(), '#5a3a1a', [0, 0.08, 0.06], [0.22, 0.03, 0.06]);
    }
    return c;
  },

  captain(color) {
    const c = frame({ handColor: SKIN, armColor: color, foot: false });
    const b = c.bodyG;
    put(b, CAP(0.43, 0.48), color, [0, 0.78, 0]);
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) put(b, LOW(), '#ffcc33', [s * 0.12, 0.6 + i * 0.18, 0.42], 0.035, null, { emissive: '#664400' });
    put(b, SPH(), SKIN, [0, 1.5, 0], 0.34);
    put(b, SPH(), '#f2f2f2', [0, 1.33, 0.14], [0.34, 0.3, 0.24]);
    put(b, BOX(), '#f2f2f2', [0, 1.43, 0.32], [0.22, 0.05, 0.05]);
    put(b, LOW(), '#ff9a8a', [0, 1.5, 0.34], 0.07);
    eyes(b, 1.58, 0.3, 0.12);
    put(b, BOX(), '#f2f2f2', [0.12, 1.65, 0.3], [0.12, 0.03, 0.03]);
    put(b, BOX(), '#f2f2f2', [-0.12, 1.65, 0.3], [0.12, 0.03, 0.03]);
    // captain's hat
    put(b, TAPER(0.38, 0.3), '#ffffff', [0, 1.82, 0], [1, 0.2, 1]);
    put(b, CYL(), '#1d2b4a', [0, 1.72, 0.04], [0.34, 0.05, 0.36]);
    put(b, BOX(), '#1d2b4a', [0, 1.69, 0.32], [0.36, 0.03, 0.18], [0.2, 0, 0]);
    put(b, LOW(), '#ffcc33', [0, 1.8, 0.34], [0.07, 0.06, 0.03], null, { emissive: '#664400' });
    // one boot, one peg
    put(c.footL, BOX(), '#2a2a2a', [0, 0.1, 0], [0.22, 0.2, 0.32]);
    put(c.footR, CYL(), '#8a5a2b', [0, 0.18, -0.02], [0.06, 0.36, 0.06]);
    return c;
  },

  bowl(color) {
    const brass = '#c9a24a', glove = '#5d6470';
    const c = frame({ handColor: glove, armColor: glove, foot: '#4a4f58', footSize: [0.24, 0.2, 0.36] });
    const b = c.bodyG;
    put(b, CAP(0.45, 0.45), color, [0, 0.78, 0]);
    put(b, BOX(), '#4a4f58', [0, 0.55, 0.38], [0.5, 0.08, 0.1]);
    put(b, BOX(), brass, [0, 0.82, 0.42], [0.2, 0.2, 0.06]);
    put(b, TORUS(0.32, 0.07), brass, [0, 1.17, 0], 1, [Math.PI / 2, 0, 0]);
    // the bowl, the water, the actual pilot
    put(b, SPH(), '#3fa7ff', [0, 1.5, 0], 0.37, null, { transparent: true, opacity: 0.35, depthWrite: false });
    put(b, SPH(), '#d6f6ff', [0, 1.55, 0], 0.44, null, { transparent: true, opacity: 0.28, depthWrite: false });
    const fishG = group(b, [0, 1.55, 0]);
    const swim = group(fishG, [0.16, 0, 0]);
    put(swim, SPH(), '#ff8a1f', [0, 0, 0], [0.07, 0.09, 0.13]);
    put(swim, BOX(), '#ffb24a', [0, 0, -0.15], [0.02, 0.12, 0.08]);
    put(swim, LOW(), INK, [0.05, 0.03, 0.08], 0.02);
    put(swim, LOW(), INK, [-0.05, 0.03, 0.08], 0.02);
    swim.rotation.y = Math.PI / 2;
    for (let i = 0; i < 3; i++) put(b, LOW(), '#ffffff', [-0.15 + i * 0.1, 1.68 + i * 0.07, 0.2], 0.025, null, { transparent: true, opacity: 0.7 });
    c.tick = (t) => {
      fishG.rotation.y = t * 1.6;
      swim.position.y = Math.sin(t * 3) * 0.04;
    };
    return c;
  },

  lobster(color) {
    const red = '#d7372b', suit = '#2b2f3a';
    const c = frame({ armColor: suit, foot: '#1a1a1a' });
    const b = c.bodyG;
    put(b, CAP(0.43, 0.45), suit, [0, 0.78, 0]);
    put(b, BOX(), '#ffffff', [0, 0.95, 0.38], [0.18, 0.36, 0.06], [0.15, 0, 0]);
    put(b, BOX(), color, [0, 0.93, 0.42], [0.08, 0.3, 0.03], [0.15, 0, 0]);
    put(b, BOX(), color, [0, 1.1, 0.41], [0.1, 0.06, 0.04]);
    put(b, SPH(), red, [0, 1.5, 0.05], [0.34, 0.38, 0.42]);
    for (const s of [1, -1]) {
      put(b, CYL(), red, [s * 0.12, 1.86, 0.18], [0.03, 0.22, 0.03]);
      put(b, LOW(), INK, [s * 0.12, 1.98, 0.18], 0.06);
      put(b, CYL(), red, [s * 0.18, 1.95, -0.25], [0.012, 0.9, 0.012], [-0.9, 0, s * 0.3]);
      put(b, CYL(), '#ffb199', [s * 0.12, 1.36, 0.42], [0.012, 0.22, 0.012], [0, 0, s * 1.2]);
    }
    put(b, BOX(), darken(red, 0.7), [0, 1.42, 0.46], [0.2, 0.04, 0.04]);
    // briefcase in the off hand, a claw on the fish hand
    put(b, BOX(), '#6b4526', [0.52, 0.55, 0.1], [0.1, 0.32, 0.42]);
    put(b, BOX(), '#ffcc33', [0.52, 0.73, 0.1], [0.05, 0.04, 0.12]);
    put(c.hand, SPH(), red, [0, 0, 0.05], [0.12, 0.1, 0.18]);
    put(c.hand, SPH(), red, [0, 0.06, 0.18], [0.05, 0.04, 0.1]);
    return c;
  },

  octo(color) {
    const purple = '#9b59d0', spot = '#c79bf0';
    const c = frame({ handColor: purple, foot: false });
    const b = c.bodyG;
    put(b, SPH(), purple, [0, 1.3, -0.05], [0.5, 0.58, 0.5]);
    for (const p of [[0.25, 1.62, 0.28], [-0.3, 1.45, 0.3], [0.1, 1.82, 0.05], [-0.15, 1.15, 0.4]]) put(b, LOW(), spot, p, [0.07, 0.07, 0.03]);
    for (const s of [1, -1]) {
      put(b, LOW(), '#ffffff', [s * 0.17, 1.28, 0.4], 0.13);
      put(b, LOW(), INK, [s * 0.17, 1.28, 0.51], 0.06);
    }
    put(b, TORUS(0.12, 0.018), '#ffcc33', [-0.17, 1.28, 0.53], 1, null, { emissive: '#664400' });
    put(b, CYL(), '#ffcc33', [-0.26, 1.08, 0.5], [0.006, 0.3, 0.006], [0, 0, 0.3]);
    // tiny top hat, bow tie
    put(b, CYL(), '#1a1a1a', [0.08, 1.92, 0], [0.24, 0.03, 0.24], [0, 0, -0.2]);
    put(b, CYL(), '#1a1a1a', [0.1, 2.06, 0], [0.16, 0.26, 0.16], [0, 0, -0.2]);
    put(b, CYL(), color, [0.09, 1.98, 0], [0.165, 0.06, 0.165], [0, 0, -0.2]);
    put(b, CONE(), color, [0.09, 0.88, 0.42], [0.08, 0.14, 0.08], [0, 0, Math.PI / 2]);
    put(b, CONE(), color, [-0.09, 0.88, 0.42], [0.08, 0.14, 0.08], [0, 0, -Math.PI / 2]);
    // tentacles
    const arms = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const t = group(b, [Math.sin(a) * 0.28, 0.85, Math.cos(a) * 0.28]);
      t.rotation.y = a;
      put(t, TAPER(0.05, 0.11), purple, [0, -0.38, 0.12], [1, 0.85, 1], [0.35, 0, 0]);
      put(t, LOW(), spot, [0, -0.78, 0.28], [0.07, 0.05, 0.1]);
      arms.push(t);
    }
    for (const f of [c.footL, c.footR]) put(f, LOW(), purple, [0, 0.06, 0.05], [0.12, 0.06, 0.16]);
    put(b, TAPER(0.04, 0.08), purple, [0.45, 0.95, 0.1], [1, 0.5, 1], [0, 0, 1.2]);
    c.tick = (t) => arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 3 + i) * 0.15; });
    return c;
  },

  npc(color) {
    const grey = '#a2a8ae';
    const c = frame({ handColor: grey, armColor: grey, foot: '#6d7379' });
    const b = c.bodyG;
    put(b, CAP(0.42, 0.45), grey, [0, 0.78, 0]);
    put(b, CAP(0.43, 0.08), color, [0, 0.5, 0], [1, 0.8, 1]);
    put(b, SPH(), grey, [0, 1.5, 0], 0.34);
    eyes(b, 1.54, 0.31, 0.11, 0.035);
    put(b, BOX(), INK, [0, 1.42, 0.32], [0.14, 0.015, 0.02]);
    // the quest marker
    const q = group(b, [0, 2.35, 0]);
    put(q, BOX(), '#ffd23f', [0, 0.12, 0], [0.1, 0.32, 0.1], null, { emissive: '#7a5a00' });
    put(q, BOX(), '#ffd23f', [0, -0.15, 0], [0.1, 0.1, 0.1], null, { emissive: '#7a5a00' });
    c.tick = (t) => { q.position.y = 2.35 + Math.sin(t * 3) * 0.06; q.rotation.y = t * 2; };
    return c;
  },

  trench(color) {
    const coat = '#b08850', fish = '#6f9fc0', belly = '#e6f0f5';
    const c = frame({ handColor: fish, armColor: coat, foot: '#4a3018' });
    const b = c.bodyG;
    put(b, TAPER(0.38, 0.5), coat, [0, 0.8, 0], [1, 1.25, 1]);
    for (const s of [1, -1]) put(b, BOX(), darken(coat, 0.8), [s * 0.14, 1.22, 0.3], [0.16, 0.3, 0.06], [0.3, 0, s * -0.4]);
    put(b, TORUS(0.45, 0.04), color, [0, 0.72, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 2; i++) put(b, LOW(), '#3a2a18', [0.1, 0.5 + i * 0.2, 0.47], 0.03);
    // fish #1: the head, in a fedora
    fishHead(b, { body: fish, belly, finColor: '#4d7c9c', lips: '#ff8fa3', y: 1.55, fin: false });
    put(b, CYL(), '#5a3a1a', [0, 1.88, 0.02], [0.5, 0.04, 0.5]);
    put(b, TAPER(0.24, 0.3), '#5a3a1a', [0, 2.0, 0.02], [1, 0.22, 1]);
    put(b, CYL(), color, [0, 1.94, 0.02], [0.305, 0.06, 0.305]);
    // fish #2 peeks out between the lapels, fish #3's tail hangs out the back
    put(b, SPH(), fish, [0, 1.0, 0.4], [0.13, 0.12, 0.12]);
    put(b, LOW(), '#ffffff', [0.06, 1.04, 0.5], 0.04);
    put(b, LOW(), INK, [0.06, 1.04, 0.53], 0.02);
    put(b, CONE(), fish, [0, 0.22, -0.45], [0.18, 0.3, 0.05], [Math.PI - 0.5, 0, 0]);
    return c;
  },
};

export function buildCharacter(id, color) {
  return (BUILD[id] || BUILD[DEFAULT_CHARACTER])(color);
}

// A standalone figure for menus and previews: the character with its feet attached.
export function buildFigure(id, color) {
  const c = buildCharacter(id, color);
  const root = new THREE.Group();
  root.add(c.bodyG, c.footL, c.footR);
  root.userData = c;
  return root;
}
