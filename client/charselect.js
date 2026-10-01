// Slap Fish - character select screen. Self-contained: it injects its own overlay and styles.
// Hook for menus:
//   openCharacterSelect({ color, onPick, onClose })  shows the screen; onPick(id) fires on "Lock in"
//   getCharacter() / setCharacter(id)               the saved pick (localStorage 'slapfish.char')
//   characterName(id)                                display name for buttons and lobby lists
import * as THREE from 'three';
import { CHARACTERS, DEFAULT_CHARACTER, isCharacter, buildFigure } from './characters.js';

const KEY = 'slapfish.char';
export function getCharacter() {
  try { const v = localStorage.getItem(KEY); if (isCharacter(v)) return v; } catch (e) {}
  return DEFAULT_CHARACTER;
}
export function setCharacter(id) {
  if (!isCharacter(id)) return;
  try { localStorage.setItem(KEY, id); } catch (e) {}
}
export function characterName(id) { const c = CHARACTERS.find((q) => q.id === id); return c ? c.name : CHARACTERS[0].name; }

const CSS = `
#charsel { position: fixed; inset: 0; z-index: 8; display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto;
  background: linear-gradient(180deg, #7fd6f0f2, #1fa3c9f8); font-family: 'Baloo 2', system-ui, sans-serif; color: #10223a; }
#charsel .cs-card { background: #fff8ec; border-radius: 24px; padding: 18px 20px 20px; width: min(980px, 100%); box-shadow: 0 10px 0 #10223a33; }
#charsel h1 { margin: 0 0 8px; text-align: center; font-size: 40px; line-height: 1; font-weight: 800; color: #10223a; }
#charsel h1 span { color: #ff5a5f; }
#charsel .cs-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 16px; }
#charsel .cs-stage { position: relative; background: radial-gradient(circle at 50% 70%, #ffffff, #cdeffa 70%); border-radius: 18px; min-height: 360px; overflow: hidden; cursor: grab; touch-action: none; }
#charsel .cs-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#charsel .cs-info { position: absolute; left: 12px; right: 12px; top: 10px; text-align: center; pointer-events: none; }
#charsel .cs-name { font-size: 28px; font-weight: 800; line-height: 1.05; }
#charsel .cs-tag { font-size: 15px; opacity: .8; line-height: 1.2; }
#charsel .cs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; align-content: start; max-height: 420px; overflow-y: auto; padding: 2px; }
#charsel .cs-pick { border: 3px solid transparent; background: #10223a10; border-radius: 14px; padding: 4px 4px 6px; cursor: pointer; font: inherit; color: inherit; text-align: center; }
#charsel .cs-pick:hover { background: #10223a1c; }
#charsel .cs-pick.on { border-color: #ff5a5f; background: #ffffff; box-shadow: 0 3px 0 #ff5a5f55; }
#charsel .cs-pick img, #charsel .cs-pick .ph { width: 100%; aspect-ratio: 1; display: block; border-radius: 10px; }
#charsel .cs-pick .ph { background: #10223a10; }
#charsel .cs-pick b { display: block; font-size: 13px; line-height: 1.1; margin-top: 2px; overflow-wrap: anywhere; }
#charsel .cs-actions { display: flex; gap: 10px; margin-top: 14px; }
#charsel .cs-actions button { flex: 1; border: 0; border-radius: 16px; padding: 12px; font: inherit; font-size: 22px; font-weight: 800; cursor: pointer; box-shadow: 0 5px 0 #10223a55; }
#charsel .cs-actions button:active { transform: translateY(3px); box-shadow: 0 2px 0 #10223a55; }
#charsel .cs-go { background: #ff5a5f; color: #fff8ec; }
#charsel .cs-back { background: #10223a14; color: #10223a; box-shadow: none !important; flex: 0 0 30% !important; }
#charsel .cs-hint { text-align: center; font-size: 12px; opacity: .6; margin-top: 8px; }
@media (max-width: 720px) {
  #charsel { align-items: flex-start; padding: 12px; }
  #charsel .cs-card { padding: 14px 12px 14px; }
  #charsel h1 { font-size: 30px; }
  #charsel .cs-body { grid-template-columns: 1fr; gap: 10px; }
  #charsel .cs-stage { min-height: 0; height: 36vh; }
  #charsel .cs-grid { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); max-height: none; }
  #charsel .cs-name { font-size: 22px; }
  #charsel .cs-tag { font-size: 13px; }
  #charsel .cs-hint { display: none; }
}`;

let ui = null; // built once, reused
let open = null; // { id, color, onPick, onClose, raf }

function build() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'charsel';
  root.style.display = 'none';
  root.innerHTML = `<div class="cs-card" role="dialog" aria-label="Choose your character">
    <h1>PICK YOUR <span>ANGLER</span></h1>
    <div class="cs-body">
      <div class="cs-stage"><canvas></canvas><div class="cs-info"><div class="cs-name"></div><div class="cs-tag"></div></div></div>
      <div class="cs-grid"></div>
    </div>
    <div class="cs-actions"><button class="cs-back">Back</button><button class="cs-go">Lock in</button></div>
    <div class="cs-hint">Arrow keys to browse, Enter to lock in. Drag to spin. Looks only: every angler has the same moves.</div>
  </div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const canvas = q('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6e0', '#2a7fa8', 1.5));
  const sun = new THREE.DirectionalLight('#fff3d6', 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const plank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.18, 24), new THREE.MeshToonMaterial({ color: '#c8935a' }));
  plank.position.y = -0.09;
  scene.add(plank);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const turn = new THREE.Group();
  scene.add(turn);

  const grid = q('.cs-grid');
  grid.innerHTML = CHARACTERS.map((c) => `<button class="cs-pick" data-id="${c.id}" title="${c.name}"><div class="ph"></div><b>${c.name}</b></button>`).join('');
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.cs-pick');
    if (b) select(b.dataset.id);
  });
  grid.addEventListener('dblclick', (e) => { if (e.target.closest('.cs-pick')) lockIn(); });
  q('.cs-go').onclick = lockIn;
  q('.cs-back').onclick = close;

  // drag to spin
  let drag = null, spin = 0, spinV = 0.6;
  const stage = q('.cs-stage');
  stage.addEventListener('pointerdown', (e) => { drag = e.clientX; stage.setPointerCapture(e.pointerId); stage.style.cursor = 'grabbing'; });
  stage.addEventListener('pointermove', (e) => { if (drag == null) return; spin += (e.clientX - drag) * 0.012; spinV = (e.clientX - drag) * 0.4; drag = e.clientX; });
  const endDrag = () => { drag = null; stage.style.cursor = ''; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    const ids = CHARACTERS.map((c) => c.id);
    const i = ids.indexOf(open.id);
    const cols = Math.max(1, Math.round(grid.clientWidth / (grid.querySelector('.cs-pick').offsetWidth + 8)));
    let n = null;
    if (e.key === 'ArrowRight') n = i + 1; else if (e.key === 'ArrowLeft') n = i - 1;
    else if (e.key === 'ArrowDown') n = i + cols; else if (e.key === 'ArrowUp') n = i - cols;
    else if (e.key === 'Enter') { e.preventDefault(); lockIn(); return; }
    else if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
    select(ids[(n + ids.length) % ids.length]);
  }, true);

  function size() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    const dist = camera.aspect < 0.9 ? 8.2 : camera.aspect > 1.6 ? 6.2 : 6.8;
    camera.position.set(0, 1.7, dist);
    camera.lookAt(0, 1.3, 0);
  }

  // one-time portrait thumbnails, rendered with the same renderer
  function thumbs(color) {
    renderer.setSize(192, 192, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    camera.position.set(0, 1.7, 4.6);
    camera.lookAt(0, 1.0, 0);
    plank.visible = false;
    for (const c of CHARACTERS) {
      turn.clear();
      const fig = buildFigure(c.id, color);
      fig.rotation.y = -0.45;
      turn.add(fig);
      if (fig.userData.tick) fig.userData.tick(0.4);
      renderer.render(scene, camera);
      const img = document.createElement('img');
      img.alt = c.name;
      img.src = canvas.toDataURL('image/png');
      const ph = grid.querySelector(`[data-id="${c.id}"] .ph, [data-id="${c.id}"] img`);
      ph.replaceWith(img);
    }
    plank.visible = true;
    turn.clear();
  }

  let fig = null;
  function show(id, color) {
    turn.clear();
    fig = buildFigure(id, color);
    turn.add(fig);
  }
  function loop(now) {
    if (!open) return;
    const t = now / 1000;
    if (drag == null) { spinV += (0.6 - spinV) * 0.03; spin += spinV * 0.016; }
    turn.rotation.y = spin;
    if (fig) {
      const u = fig.userData;
      u.bodyG.position.y = Math.abs(Math.sin(t * 2.2)) * 0.06;
      if (u.tick) u.tick(t);
    }
    renderer.render(scene, camera);
    open.raf = requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => { if (open) size(); });

  return { root, q, grid, show, size, thumbs, loop, thumbColor: null };
}

function select(id) {
  if (!open || !isCharacter(id)) return;
  open.id = id;
  const c = CHARACTERS.find((x) => x.id === id);
  ui.q('.cs-name').textContent = c.name;
  ui.q('.cs-tag').textContent = c.tag;
  ui.grid.querySelectorAll('.cs-pick').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  const on = ui.grid.querySelector('.cs-pick.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  ui.show(id, open.color);
}

function lockIn() {
  if (!open) return;
  const { id, onPick } = open;
  setCharacter(id);
  close(true);
  if (onPick) onPick(id);
}

function close(picked) {
  if (!open) return;
  cancelAnimationFrame(open.raf);
  const cb = open.onClose;
  open = null;
  ui.root.style.display = 'none';
  if (picked !== true && cb) cb();
}

export function openCharacterSelect(opts) {
  opts = opts || {};
  if (!ui) ui = build();
  const color = opts.color || '#ff5a5f';
  open = { id: getCharacter(), color, onPick: opts.onPick, onClose: opts.onClose, raf: 0 };
  ui.root.style.display = '';
  if (ui.thumbColor !== color) { ui.thumbs(color); ui.thumbColor = color; }
  ui.size();
  select(opts.current && isCharacter(opts.current) ? opts.current : open.id);
  open.raf = requestAnimationFrame(ui.loop);
}
export function isCharacterSelectOpen() { return !!open; }
