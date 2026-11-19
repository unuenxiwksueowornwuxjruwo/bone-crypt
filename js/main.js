// Bone Crypt — a 3D arena brawler for Poki.
// Models and animations: KayKit by Kay Lousberg (CC0). Engine: three.js r170.
import * as THREE from '../lib/three.module.min.js';
import { GLTFLoader } from '../lib/addons/GLTFLoader.js';
import { MeshoptDecoder } from '../lib/addons/meshopt_decoder.module.js';
import * as SkeletonUtils from '../lib/addons/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// =====================================================================
// POKI SDK (falls back to no-ops when the SDK is blocked)
// =====================================================================
const Poki = window.PokiSDK || {
  init: () => Promise.resolve(), gameLoadingFinished() {}, gameplayStart() {}, gameplayStop() {},
  commercialBreak: () => Promise.resolve(), rewardedBreak: () => Promise.resolve(false),
};
let gameplayOn = false, adActive = false, noAds = false;   // noAds: test hook only
function gpStart() { if (!gameplayOn) { gameplayOn = true; try { Poki.gameplayStart(); } catch (e) {} } }
function gpStop() { if (gameplayOn) { gameplayOn = false; try { Poki.gameplayStop(); } catch (e) {} } }
function commercial() {
  if (noAds) return Promise.resolve();
  adActive = true; Audio.setAd(true);
  return Promise.resolve().then(() => Poki.commercialBreak(() => Audio.setAd(true))).catch(() => {})
    .then(() => { adActive = false; Audio.setAd(false); last = performance.now(); });
}
function rewarded() {
  if (noAds) return Promise.resolve(true);
  adActive = true; Audio.setAd(true);
  return Promise.resolve().then(() => Poki.rewardedBreak(() => Audio.setAd(true))).then(s => !!s, () => false)
    .then(s => { adActive = false; Audio.setAd(false); last = performance.now(); return s; });
}

// =====================================================================
// SAVE
// =====================================================================
const SAVE_KEY = 'boneCrypt_v1';
const save = { gold: 0, best: 0, heroes: ['knight'], hero: 'knight', music: true, sfx: true };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

// =====================================================================
// AUDIO: recorded CC0 samples (audio/CREDITS.txt), played through WebAudio
// =====================================================================
const Audio = (() => {
  const SFX = ['swing1', 'swing2', 'hit1', 'hit2', 'hit3', 'collapse', 'shatter', 'rise', 'resurrect', 'cast', 'boltHit', 'hurt', 'die', 'roar',
    'dodge', 'coin', 'gem', 'gong', 'slam', 'chain', 'click', 'nope'];
  const MUSIC = { battle: { file: 'music_battle', loop: 95.5987, vol: 0.32 }, boss: { file: 'music_boss', loop: 123.4286, vol: 0.3 } };
  const PAD = 0.5, raw = {}, buf = {};
  SFX.forEach(n => { raw[n] = fetch('audio/' + n + '.mp3').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null); });
  let ac = null, master, musicGain, sfxGain, ad = false, hidden = false, want = null, src = null, cur = null;
  const lastAt = {}; let voices = 0;
  const decoding = {};
  function decode(n, ab) {
    // decodeAudioData detaches the buffer, so each file is decoded exactly once
    return decoding[n] || (decoding[n] = new Promise(res => { try { ac.decodeAudioData(ab, b => { buf[n] = b; res(); }, () => res()); } catch (e) { res(); } }));
  }
  function init() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.connect(ac.destination);
        musicGain = ac.createGain(); musicGain.connect(master);
        sfxGain = ac.createGain(); sfxGain.connect(master);
        Object.keys(raw).forEach(n => raw[n].then(ab => ab && decode(n, ab)));
      } catch (e) { ac = null; }
    }
    apply(); return ac;
  }
  // music is large: fetched after the game has loaded, decoded when first needed
  function loadMusic() { for (const m of Object.values(MUSIC)) if (!raw[m.file]) raw[m.file] = fetch('audio/' + m.file + '.mp3').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null); }
  function apply() {
    if (!ac) return;
    const off = ad || hidden;
    if (off && ac.state === 'running') ac.suspend().catch(() => {});
    else if (!off && ac.state !== 'running') ac.resume().catch(() => {});
  }
  function play(name, vol = 0.5, rate = 1, gap = 0.04) {
    if (!ac || !save.sfx || !buf[name] || ac.state !== 'running') return;
    const now = ac.currentTime; if (now - (lastAt[name] ?? -1) < gap || voices > 20) return;
    lastAt[name] = now; voices++;
    const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = buf[name]; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g); g.connect(sfxGain); s.onended = () => { voices = Math.max(0, voices - 1); g.disconnect(); }; s.start();
  }
  async function startMusic() {
    if (!ac || !want || !save.music) return;
    const m = MUSIC[want]; if (cur === want && src) return;
    if (!buf[m.file]) { loadMusic(); const ab = await raw[m.file]; if (!ab) return; await decode(m.file, ab); if (!buf[m.file]) return; }
    if (!want || MUSIC[want] !== m || !save.music || (cur === want && src)) return;
    stopSrc();
    const s = ac.createBufferSource(); s.buffer = buf[m.file]; s.loop = true; s.loopStart = PAD; s.loopEnd = PAD + m.loop;
    musicGain.gain.value = m.vol; s.connect(musicGain); s.start(0, PAD); src = s; cur = want;
  }
  function stopSrc() { if (src) { try { src.stop(); } catch (e) {} src.disconnect(); } src = null; cur = null; }
  return {
    init, play, loadMusic,
    music(which) { want = which; if (!which) stopSrc(); else if (init()) startMusic(); },
    prefs() { if (save.music) startMusic(); else stopSrc(); },
    setAd(v) { ad = v; apply(); },
    setHidden(v) { hidden = v; apply(); },
    state: () => ({ ctx: ac && ac.state, decoded: Object.keys(buf).length, music: cur, ad }),
  };
})();
const sfx = {
  swing: () => Audio.play(Math.random() < 0.5 ? 'swing1' : 'swing2', 0.35, rand(0.9, 1.15), 0.05),
  hit: () => Audio.play(pick(['hit1', 'hit2', 'hit3']), 0.55, rand(0.85, 1.15), 0.03),
  collapse: () => Audio.play('collapse', 0.5, rand(0.9, 1.1), 0.05),
  shatter: () => Audio.play('shatter', 0.6, rand(0.9, 1.15), 0.04),
  rise: () => Audio.play('rise', 0.35, rand(0.8, 1.1), 0.15),
  resurrect: () => Audio.play('resurrect', 0.45, rand(0.9, 1.1), 0.1),
  cast: () => Audio.play('cast', 0.3, rand(1, 1.2), 0.1),
  boltHit: () => Audio.play('boltHit', 0.35, 1, 0.1),
  hurt: () => Audio.play('hurt', 0.55, rand(0.9, 1.1), 0.1),
  die: () => Audio.play('die', 0.6),
  roar: () => Audio.play('roar', 0.7, 0.8, 0.5),
  dodge: () => Audio.play('dodge', 0.45, rand(1, 1.2), 0.1),
  coin: () => Audio.play('coin', 0.25, rand(0.95, 1.2), 0.06),
  gem: () => Audio.play('gem', 0.5),
  gong: () => Audio.play('gong', 0.45, 1, 0.5),
  slam: () => Audio.play('slam', 0.8, 0.8, 0.1),
  chain: () => Audio.play('chain', 0.4),
  click: () => Audio.play('click', 0.4, 1, 0.02),
  nope: () => Audio.play('nope', 0.45),
};
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.btn, .hcard, .card')) { Audio.init(); sfx.click(); } }, true);

// =====================================================================
// RENDERER, SCENE, LIGHTS
// =====================================================================
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const SHADOWS = !isTouch;
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = SHADOWS; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0c1c);
scene.fog = new THREE.Fog(0x0f0c1c, 26, 58);
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 140);
scene.add(new THREE.HemisphereLight(0x6a64b8, 0x1a1418, 0.85));
const moon = new THREE.DirectionalLight(0x9fb4ff, 1.05);
moon.position.set(-10, 26, 9); scene.add(moon); scene.add(moon.target);
// a warm light that follows the hero keeps the fight readable in the dark
const heroLight = new THREE.PointLight(0xffc89a, 30, 11, 1.4); heroLight.position.set(0, 4, 0); scene.add(heroLight);
if (SHADOWS) {
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, near: 2, far: 70 });
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03;
}
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 58 : 42; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// soft round textures for blob shadows and glows
function radialTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const BLOB_TEX = radialTex('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
const GLOW_TEX = radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: BLOB_TEX, transparent: true, depthWrite: false });

// =====================================================================
// PARTICLES: one draw call per blend mode, each particle with its own size, colour and alpha
// =====================================================================
const hex3 = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
class Particles {
  constructor(max, additive) {
    this.max = max; this.p = [];
    const g = new THREE.BufferGeometry();
    const attr = (name, n) => { const a = new THREE.BufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = attr('position', 3); this.aCol = attr('pcol', 3); this.aAlpha = attr('alpha', 1); this.aSize = attr('size', 1);
    g.setDrawRange(0, 0); this.g = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: GLOW_TEX }, uScale: { value: 400 } },
      vertexShader: `attribute vec3 pcol; attribute float alpha; attribute float size; uniform float uScale; varying vec3 vC; varying float vA;
        void main() { vC = pcol; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = size * projectionMatrix[1][1] * uScale / -mv.z; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() { float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(g, this.mat); pts.frustumCulled = false; pts.renderOrder = additive ? 6 : 5; scene.add(pts);
  }
  // o: {x,y,z, vx,vy,vz, life, size, color, a, grav, drag, grow, fin}
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    o.max = o.life; [o.r, o.g, o.b] = hex3(o.color); this.p.push(o);
  }
  update(dt) {
    let n = 0; const P = this.aPos.array, C = this.aCol.array, A = this.aAlpha.array, S = this.aSize.array;
    for (const q of this.p) {
      q.life -= dt; if (q.life <= 0) continue;
      const dr = Math.exp(-(q.drag || 0) * dt); q.vx *= dr; q.vz *= dr; q.vy = q.vy * dr - (q.grav || 0) * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy *= -0.3; }
      const k = q.life / q.max;
      P[n * 3] = q.x; P[n * 3 + 1] = q.y; P[n * 3 + 2] = q.z; C[n * 3] = q.r; C[n * 3 + 1] = q.g; C[n * 3 + 2] = q.b;
      A[n] = q.a * Math.min(1, k * 2.5) * (q.fin ? Math.min(1, (1 - k) * q.fin) : 1);
      S[n] = q.size * (1 + (1 - k) * (q.grow || 0)); n++;
    }
    if (n !== this.p.length) this.p = this.p.filter(q => q.life > 0);
    this.g.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aAlpha.needsUpdate = this.aSize.needsUpdate = true;
  }
}
const FXA = new Particles(isTouch ? 500 : 1000, true);   // sparks, embers, wisps
const FXD = new Particles(isTouch ? 160 : 320, false);   // dust
function particleScale() { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); FXA.mat.uniforms.uScale.value = FXD.mat.uniforms.uScale.value = v.y / 2; }
addEventListener('resize', particleScale); particleScale();
function sparks(x, y, z, n, color, speed = 6, dx = 0, dz = 0, size = 1) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.35, 1) * speed;
    FXA.emit({ x, y, z, vx: Math.cos(a) * s * 0.6 + dx * s, vy: rand(0.5, 1.6) * speed * 0.5, vz: Math.sin(a) * s * 0.6 + dz * s,
      life: rand(0.22, 0.45), size: rand(0.12, 0.24) * size, color, a: 1, grav: 16, drag: 3 });
  }
}
function dust(x, z, n, size = 1, spread = 1.5, color = 0x8a7c74) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.3, 1) * spread;
    FXD.emit({ x: x + Math.cos(a) * 0.2, y: rand(0.15, 0.4), z: z + Math.sin(a) * 0.2, vx: Math.cos(a) * s, vy: rand(0.3, 1.1), vz: Math.sin(a) * s,
      life: rand(0.45, 0.85), size: rand(0.55, 1) * size, color, a: 0.4, grav: -0.4, drag: 4, grow: 1.3, fin: 6 });
  }
}
function wisp(x, z, color = 0xb07aff) {
  FXA.emit({ x: x + rand(-0.5, 0.5), y: rand(0.15, 0.5), z: z + rand(-0.5, 0.5), vx: rand(-0.2, 0.2), vy: rand(0.7, 1.5), vz: rand(-0.2, 0.2),
    life: rand(0.8, 1.3), size: rand(0.25, 0.42), color, a: 0.75, grav: -0.4, drag: 1, fin: 5 });
}
// sword trails: a flat arc that brightens toward its middle and outer edge
const slashGeos = {};
function slashGeo(r0, r1, arc) {
  const key = r0.toFixed(2) + r1.toFixed(2) + arc.toFixed(2); if (slashGeos[key]) return slashGeos[key];
  const g = new THREE.RingGeometry(r0, r1, 28, 3, -Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), t = clamp((Math.atan2(x, z) + arc / 2) / arc, 0, 1), rr = clamp((Math.hypot(x, z) - r0) / (r1 - r0), 0, 1);
    const v = Math.pow(Math.sin(Math.PI * t), 0.8) * Math.pow(rr, 2.2); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return (slashGeos[key] = g);
}
function slash(x, z, face, range, arc, color, dur = 0.17, y = 1.05, spin = 0) {
  const m = new THREE.Mesh(slashGeo(range * 0.5, range * 1.05, arc), new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  m.rotation.order = 'YXZ'; m.rotation.set(0, face, rand(-0.3, 0.3)); m.position.set(x, y, z); scene.add(m);
  fx.push({ k: 'slash', m, t: 0, dur, face, spin: spin || rand(-1, 1) * 0.6 });
}

// =====================================================================
// ASSETS
// =====================================================================
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const CHAR = {}, CLIPS = {}, P = {};
async function loadAssets(onProgress) {
  const files = ['characters/knight.glb', 'characters/barbarian.glb', 'characters/skel_minion.glb', 'characters/skel_warrior.glb',
    'characters/skel_rogue.glb', 'characters/skel_mage.glb', 'anims.glb', 'props.glb'];
  let done = 0;
  const res = await Promise.all(files.map(f => loader.loadAsync('assets/' + f).then(g => { onProgress(++done / files.length); return [f, g]; })));
  for (const [f, g] of res) {
    const name = f.split('/').pop().replace('.glb', '');
    if (name === 'anims') g.animations.forEach(a => CLIPS[a.name] = a);
    else if (name === 'props') g.scene.children.forEach(n => { P[n.name] = n; fixMats(n); });
    else { CHAR[name] = g.scene; fixMats(g.scene); }
  }
}
function fixMats(root) { root.traverse(o => { if (o.isMesh) { const m = o.material; if (m.metalness !== undefined) { m.metalness = 0; m.roughness = Math.max(0.65, m.roughness); } } }); }

// =====================================================================
// ARENA
// =====================================================================
const HALF = 14.6;                 // walkable half-size of the courtyard
const colliders = [];              // static circles {x, z, r}
const GRAVES = [];                 // spawn points
const torches = [];
function prop(name, x, z, ry = 0, s = 1, y = 0, shadow = true) {
  const src = P[name]; if (!src) return null;
  const o = src.clone(); o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
  o.traverse(m => { if (m.isMesh) { m.castShadow = shadow && SHADOWS; m.receiveShadow = SHADOWS; } });
  scene.add(o); o.updateMatrixWorld(true); o.traverse(m => m.matrixAutoUpdate = false);
  return o;
}
function buildArena() {
  // ground beyond the walls, so the fog has something to swallow
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2433, roughness: 1 }));
  ground.position.y = -0.02; ground.receiveShadow = SHADOWS; scene.add(ground);
  const R = () => Math.floor(Math.random() * 4) * Math.PI / 2;
  for (let x = -14; x <= 14; x += 4) for (let z = -14; z <= 14; z += 4) {
    const plaza = Math.abs(x) < 8 && Math.abs(z) < 8;
    prop(plaza ? 'floor_tile_large' : 'floor_dirt', x, z, R(), 1, 0, false);
  }
  for (let x = -22; x <= 22; x += 4) for (let z = -22; z <= 22; z += 4) if (Math.abs(x) > 16 || Math.abs(z) > 16) prop('floor_dirt', x, z, R(), 1, -0.01, false);
  // fence with a gate on the north side
  for (let i = -14; i <= 14; i += 4) {
    const gate = Math.abs(i) === 2;
    prop(gate ? 'fence_gate' : (Math.random() < 0.2 ? 'fence_broken' : 'fence'), i, -16, i > 0 && gate ? Math.PI : 0);
    prop(Math.random() < 0.2 ? 'fence_broken' : 'fence', i, 16, Math.PI);
    prop(Math.random() < 0.2 ? 'fence_broken' : 'fence', -16, i, Math.PI / 2);
    prop(Math.random() < 0.2 ? 'fence_broken' : 'fence', 16, i, -Math.PI / 2);
  }
  for (let i = -16; i <= 16; i += 4) { prop('fence_pillar', i, -16); prop('fence_pillar', i, 16); prop('fence_pillar', -16, i); prop('fence_pillar', 16, i); }
  prop('crypt', 0, -23, 0, 1.15);
  prop('arch_gate', 0, -17.2);
  // dead forest outside
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), r = rand(19, 30), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -17 && Math.abs(x) < 7) continue;
    prop(pick(['tree_dead_large', 'tree_dead_medium', 'tree_dead_small', 'tree_dead_large']), x, z, rand(0, TAU), rand(0.9, 1.4));
  }
  for (const [x, z] of [[-18.5, -18.5], [18.5, -18.5], [-18.5, 18.5], [18.5, 18.5]]) prop('post_lantern', x, z, Math.atan2(-x, -z));
  for (let i = 0; i < 14; i++) { const a = rand(0, TAU), r = rand(17.5, 22); prop(pick(['gravestone', 'gravemarker_A', 'gravemarker_B', 'grave_B']), Math.cos(a) * r, Math.sin(a) * r, rand(-0.4, 0.4) + Math.PI); }
  // graves inside the yard: skeletons climb out in front of them
  for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11], [0, -12.5], [0, 12.5], [-12.5, 0], [12.5, 0]]) {
    const ry = Math.atan2(-x, -z), dx = Math.sin(ry), dz = Math.cos(ry);
    prop(Math.random() < 0.5 ? 'grave_A' : 'grave_B', x, z, ry);
    prop('floor_dirt_small', x + dx * 1.7, z + dz * 1.7, R(), 1, 0.02, false);
    colliders.push({ x, z, r: 1.05 });
    GRAVES.push({ x: x + dx * 2, z: z + dz * 2, ry });
    prop('candle_triple', x - dz * 1.3, z + dx * 1.3, rand(0, TAU), 1, 0, false);
  }
  // torch posts around the plaza
  for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
    prop('column', x, z); prop('torch_lit', x, z, 0, 1, 1.4 + 0.4);
    colliders.push({ x, z, r: 0.55 });
    const l = new THREE.PointLight(0xff7a2a, 60, 17, 1.5); l.position.set(x, 2.6, z); scene.add(l);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff9a4a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    glow.scale.setScalar(1.6); glow.position.set(x, 2.35, z); scene.add(glow);
    torches.push({ l, glow, base: 60, ph: rand(0, 10) });
  }
  // clutter
  for (let i = 0; i < 26; i++) {
    const x = rand(-13.5, 13.5), z = rand(-13.5, 13.5);
    if (Math.abs(x) < 8.5 && Math.abs(z) < 8.5) continue;
    prop(pick(['bone_A', 'bone_B', 'bone_C', 'skull', 'bone_A', 'bone_C']), x, z, rand(0, TAU), 0.7, 0.08, false);
  }
  for (const [x, z] of [[-13.6, -5], [13.4, 5.5], [-4.5, 13.6], [5, -13.6]]) prop(pick(['pumpkin_orange_jackolantern', 'pumpkin_yellow_small', 'skull_candle']), x, z, rand(0, TAU));
}

// =====================================================================
// ACTORS (skinned KayKit characters sharing one rig and one clip set)
// =====================================================================
class Actor {
  constructor(model, { hide = [], weapons = null, scale = 1 } = {}) {
    this.obj = new THREE.Group();
    const m = SkeletonUtils.clone(CHAR[model]); this.model = m; m.scale.setScalar(scale);
    this.mats = [];
    m.traverse(o => {
      if (hide.includes(o.name)) o.visible = false;
      if (o.isMesh) { o.material = o.material.clone(); this.mats.push(o.material); o.castShadow = SHADOWS; o.frustumCulled = false; }
    });
    if (weapons) for (const [side, name] of Object.entries(weapons)) {
      const bone = m.getObjectByName(side === 'r' ? 'handslotr' : 'handslotl'); if (!bone || !P[name]) continue;
      const w = P[name].clone(); w.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); this.mats.push(o.material); o.castShadow = SHADOWS; } });
      bone.add(w);
    }
    this.obj.add(m);
    if (!SHADOWS) { const b = new THREE.Mesh(blobGeo, blobMat); b.scale.setScalar(1.6 * scale); b.position.y = 0.06; this.obj.add(b); }
    this.mixer = new THREE.AnimationMixer(m);
    this.cur = null; this.act = null; this.flash = 0; this.glow = new THREE.Color(0, 0, 0);
    scene.add(this.obj);
  }
  play(name, { once = false, speed = 1, fade = 0.12, restart = false } = {}) {
    const clip = CLIPS[name]; if (!clip) return 0;
    if (this.cur === name && !restart && !once) { this.act.timeScale = speed; return clip.duration / speed; }
    const a = this.mixer.clipAction(clip);
    if (this.act === a) a.stop();
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.timeScale = speed; a.setEffectiveWeight(1);
    if (this.act && this.act !== a && fade > 0) a.crossFadeFrom(this.act, fade, false); else if (this.act && this.act !== a) this.act.stop();
    a.play(); this.act = a; this.cur = name;
    return clip.duration / speed;
  }
  hit() { this.flash = 0.12; }
  update(dt) {
    this.mixer.update(dt);
    const k = Math.max(0, this.flash) / 0.12; if (this.flash > 0) this.flash -= dt;
    for (const m of this.mats) if (m.emissive) m.emissive.setRGB(k + this.glow.r, k + this.glow.g, k + this.glow.b);
  }
  dispose() { this.mixer.stopAllAction(); scene.remove(this.obj); }
}

// =====================================================================
// GAME DATA
// =====================================================================
const HEROES = {
  knight: {
    name: 'KNIGHT', model: 'knight', hide: [], price: 0, desc: 'Sword and shield. Fast combos.',
    hp: 110, speed: 5.4, dmg: 14, idle: 'Idle', run: 'Running_A',
    combo: [
      { clip: '1H_Melee_Attack_Slice_Diagonal', ts: 1.7, hit: 0.36, chain: 0.5, range: 2.6, arc: 2.4, mul: 1, kb: 3, lunge: 1.1 },
      { clip: '1H_Melee_Attack_Slice_Horizontal', ts: 1.7, hit: 0.38, chain: 0.52, range: 2.7, arc: 2.8, mul: 1.1, kb: 3, lunge: 1.1 },
      { clip: '1H_Melee_Attack_Chop', ts: 1.5, hit: 0.42, chain: 0.7, range: 2.8, arc: 2.0, mul: 1.9, kb: 8, lunge: 1.5, heavy: true },
    ],
  },
  barbarian: {
    name: 'BARBARIAN', model: 'barbarian', hide: ['1H_Axe_Offhand', '1H_Axe', 'Mug', 'Barbarian_Round_Shield'], price: 400,
    desc: 'Two-handed axe. Slow, huge hits.', hp: 150, speed: 5.0, dmg: 22, idle: '2H_Melee_Idle', run: 'Running_A',
    combo: [
      { clip: '2H_Melee_Attack_Slice', ts: 1.45, hit: 0.42, chain: 0.58, range: 3.1, arc: 3.0, mul: 1, kb: 5, lunge: 1.0 },
      { clip: '2H_Melee_Attack_Chop', ts: 1.6, hit: 0.45, chain: 0.7, range: 3.2, arc: 2.0, mul: 2, kb: 10, lunge: 1.4, heavy: true },
    ],
  },
};
const FOES = {
  minion: { model: 'skel_minion', hp: 26, speed: 3.3, dmg: 7, range: 1.7, atk: '1H_Melee_Attack_Stab', atkTs: 1.5, hitAt: 0.42, cd: 1.3, run: 'Running_C', weapons: { r: 'Skeleton_Blade' }, gold: 2, scale: 0.92, r: 0.55 },
  warrior: { model: 'skel_warrior', hp: 58, speed: 2.5, dmg: 13, range: 2.0, atk: '1H_Melee_Attack_Chop', atkTs: 1.15, hitAt: 0.45, cd: 1.7, run: 'Walking_D_Skeletons', runTs: 1.5, weapons: { r: 'Skeleton_Axe', l: 'Skeleton_Shield_Small_A' }, gold: 4, scale: 1, r: 0.6 },
  rogue: { model: 'skel_rogue', hp: 38, speed: 4.3, dmg: 9, range: 1.8, atk: 'Dualwield_Melee_Attack_Slice', atkTs: 1.5, hitAt: 0.38, cd: 1.1, run: 'Running_C', weapons: { r: 'Skeleton_Blade', l: 'Skeleton_Blade' }, gold: 4, scale: 0.95, r: 0.55, lunge: 3 },
  mage: { model: 'skel_mage', hp: 34, speed: 2.7, dmg: 12, ranged: true, atk: 'Spellcast_Shoot', atkTs: 1.15, hitAt: 0.55, cd: 3.2, run: 'Walking_D_Skeletons', runTs: 1.6, weapons: { r: 'Skeleton_Staff' }, gold: 6, scale: 1, r: 0.55 },
  boss: { model: 'skel_warrior', hp: 650, speed: 2.4, dmg: 26, range: 3.6, atk: '2H_Melee_Attack_Chop', atkTs: 0.9, hitAt: 0.47, cd: 2.4, run: 'Walking_D_Skeletons', runTs: 1.2, weapons: { r: 'Skeleton_Axe', l: 'Skeleton_Shield_Large_A' }, gold: 80, scale: 2.1, r: 1.25, boss: true },
};
const UPGRADES = [
  { id: 'dmg', ic: '⚔', name: 'Sharpened Steel', desc: '+20% damage', max: 5, apply: s => s.dmg *= 1.2 },
  { id: 'hp', ic: '♥', name: 'Iron Skin', desc: '+30 max health and a full heal', max: 5, apply: s => { s.maxHp += 30; player.hp = s.maxHp; } },
  { id: 'speed', ic: '»', name: 'Swift Boots', desc: '+12% move speed', max: 3, apply: s => s.speed *= 1.12 },
  { id: 'atkspd', ic: '✦', name: 'Battle Rhythm', desc: '+15% attack speed', max: 4, apply: s => s.atkSpd *= 1.15 },
  { id: 'vamp', ic: '✚', name: 'Bone Drinker', desc: 'Heal 4 health for every skeleton you shatter', max: 3, apply: s => s.vamp += 4 },
  { id: 'quake', ic: '✺', name: 'Bone Quake', desc: 'Shattering a pile blasts nearby skeletons', max: 3, apply: s => s.quake += 1 },
  { id: 'roll', ic: '↻', name: 'Quick Roll', desc: 'Roll recharges 35% faster', max: 2, apply: s => s.dodgeCd *= 0.65 },
  { id: 'ult', ic: '◎', name: 'Whirlwind', desc: 'Ultimate charges 30% faster', max: 3, apply: s => s.ultGain *= 1.3 },
  { id: 'ward', ic: '⌛', name: 'Grave Warden', desc: 'Bone piles take 1.5 s longer to rise', max: 3, apply: s => s.ward += 1.5 },
  { id: 'reach', ic: '⟷', name: 'Long Reach', desc: '+18% attack range', max: 3, apply: s => s.reach *= 1.18 },
  { id: 'armor', ic: '⛨', name: 'Plate Armor', desc: 'Take 12% less damage', max: 4, apply: s => s.armor = 1 - (1 - s.armor) * 0.88 },
];
const PILE_TIME = 3.6, MAX_REVIVES = 2;

// =====================================================================
// STATE
// =====================================================================
let state = 'loading';               // loading | menu | play | upgrade | paused | dead | results
let player = null, st = null, ups = {};
let enemies = [], bolts = [], debris = [], coins = [], fx = [];
let wave = 0, queue = [], spawnT = 0, waveActive = false, clearT = 0;
let kills = 0, runGold = 0, banked = 0, revived = false, doubled = false, bossRef = null;
let shake = 0, hitstop = 0, slowmo = 0, menuT = 0, timeT = 0, punch = 0, streak = 0, streakT = 0, ultWasReady = false;
const input = { x: 0, z: 0, atk: false, atkHeld: false, dodge: false, ult: false, aim: null };

function newStats(h) { return { maxHp: h.hp, speed: h.speed, dmg: h.dmg, atkSpd: 1, reach: 1, dodgeCd: 0.65, ultGain: 1, vamp: 0, quake: 0, ward: 0, armor: 0 }; }
function makePlayer(heroId) {
  if (player) player.actor.dispose();
  const h = HEROES[heroId];
  player = { id: heroId, def: h, actor: new Actor(h.model, { hide: h.hide }), x: 0, z: 2, face: Math.PI, vx: 0, vz: 0, hp: h.hp, state: 'idle', t: 0,
    combo: 0, queued: false, atk: null, atkDur: 0, hitDone: false, dodgeCd: 0, dodgeT: 0, dx: 0, dz: 0, inv: 0, ult: 0, ultT: 0, tick: 0, hurtT: 0, r: 0.6 };
  player.actor.play(h.idle);
  syncObj(player);
}
function syncObj(a) { a.actor.obj.position.set(a.x, 0, a.z); a.actor.obj.rotation.y = a.face; }

// =====================================================================
// PLAYER
// =====================================================================
function nearestTarget(maxD, piles = true) {
  let best = null, bd = maxD;
  for (const e of enemies) {
    if (e.state === 'dead' || e.state === 'spawn') continue;
    if (!piles && isPile(e)) continue;
    const p = hitPoint(e), d = Math.hypot(p.x - player.x, p.z - player.z) - e.r;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function startAttack() {
  const step = player.def.combo[player.combo % player.def.combo.length];
  let tgt = input.aim || nearestTarget(5);
  if (tgt) player.face = Math.atan2(tgt.x - player.x, tgt.z - player.z);
  else if (input.x || input.z) player.face = Math.atan2(input.x, input.z);
  input.aim = null;
  player.state = 'attack'; player.atk = step; player.t = 0; player.hitDone = false; player.queued = false;
  player.atkDur = player.actor.play(step.clip, { once: true, speed: step.ts * st.atkSpd, restart: true, fade: 0.06 });
  sfx.swing();
}
function startDodge() {
  if (player.dodgeCd > 0) return;
  let a = (input.x || input.z) ? Math.atan2(input.x, input.z) : player.face;
  player.face = a; player.dx = Math.sin(a); player.dz = Math.cos(a);
  player.state = 'dodge'; player.t = 0; player.dodgeT = 0.42; player.dodgeCd = st.dodgeCd; player.inv = Math.max(player.inv, 0.45);
  player.actor.play('Dodge_Forward', { once: true, speed: 0.95, restart: true, fade: 0.05 });
  sfx.dodge(); dust(player.x, player.z, 5, 0.9, 2);
}
function startUlt() {
  if (player.ult < 100) return;
  player.ult = 0; player.state = 'ult'; player.ultT = player.id === 'barbarian' ? 3.2 : 2.6; player.tick = 0;
  player.actor.play('2H_Melee_Attack_Spinning', { speed: 1.35, fade: 0.08 });
  sfx.roar(); shake = Math.max(shake, 0.3);
}
function meleeHit(range, arc, mul, kb, heavy) {
  const fx_ = Math.sin(player.face), fz = Math.cos(player.face); let landed = 0;
  slash(player.x, player.z, player.face, range, Math.min(arc, 3.4), heavy ? 0xb08a40 : 0x7d8db0, heavy ? 0.22 : 0.16);
  for (const e of enemies) {
    if (e.state === 'dead' || (e.state === 'spawn' && e.t < e.spawnDur * 0.45)) continue;
    const p = hitPoint(e), dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
    if (d > range + e.r) continue;
    if (d > 0.9 && (dx * fx_ + dz * fz) / d < Math.cos(arc / 2)) continue;
    landed++;
    if (isPile(e)) { shatter(e); continue; }
    damageEnemy(e, st.dmg * mul * rand(0.9, 1.1), dx / (d || 1), dz / (d || 1), kb, heavy);
  }
  if (landed) { hitstop = heavy ? 0.09 : 0.055; shake = Math.max(shake, heavy ? 0.35 : 0.18); punch = Math.max(punch, heavy ? 0.06 : 0.025); sfx.hit(); }
  return landed;
}
function hurtPlayer(dmg, fromX, fromZ) {
  if (!player || player.state === 'dead' || player.inv > 0) return false;
  dmg *= (1 - st.armor);
  player.hp -= dmg; player.inv = 0.55; player.actor.hit(); sparks(player.x, 1.3, player.z, 8, 0xff5a6a, 4);
  num(player.x, 2.6, player.z, Math.round(dmg), '#ff5a6a');
  shake = Math.max(shake, 0.4); sfx.hurt();
  $('vignette').style.opacity = 1; setTimeout(() => $('vignette').style.opacity = 0, 180);
  if (fromX != null) { const d = Math.hypot(player.x - fromX, player.z - fromZ) || 1; player.vx += (player.x - fromX) / d * 6; player.vz += (player.z - fromZ) / d * 6; }
  if (player.hp <= 0) { playerDie(); return true; }
  if (player.state === 'idle' || player.state === 'run') { player.state = 'hurt'; player.t = 0; player.actor.play('Hit_A', { once: true, speed: 2, restart: true, fade: 0.05 }); }
  return true;
}
function playerDie() {
  player.hp = 0; player.state = 'dead'; player.actor.play('Death_A', { once: true, fade: 0.1 });
  sfx.die(); slowmo = 1.2; gpStop();
  setTimeout(() => { if (state === 'play' && player.state === 'dead') showResults(false); }, 1700);
}
function updatePlayer(dt) {
  const p = player, h = p.def;
  p.dodgeCd -= dt; p.inv -= dt; p.t += dt;
  // knockback
  p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= Math.exp(-dt * 8); p.vz *= Math.exp(-dt * 8);
  if (p.state === 'dead') { syncObj(p); return; }
  const moving = Math.hypot(input.x, input.z) > 0.15;
  const mv = (spd) => { p.x += input.x * spd * dt; p.z += input.z * spd * dt; };
  if (input.dodge) { input.dodge = false; if (p.state !== 'ult') { startDodge(); } }
  if (input.ult) { input.ult = false; if (p.ult >= 100 && p.state !== 'dodge') startUlt(); }

  if (p.state === 'dodge') {
    p.dodgeT -= dt; const k = p.dodgeT > 0.1 ? 1 : p.dodgeT / 0.1;
    p.x += p.dx * 11 * k * dt; p.z += p.dz * 11 * k * dt;
    if (Math.random() < dt * 30) dust(p.x, p.z, 1, 0.7, 0.5);
    if (p.dodgeT <= 0) { p.state = 'idle'; p.combo = 0; if (input.atk || input.atkHeld) { input.atk = false; startAttack(); } }
  } else if (p.state === 'ult') {
    p.ultT -= dt; p.tick -= dt; mv(st.speed * 0.8);
    p.face += dt * 14;
    if (p.tick <= 0) {
      p.tick = 0.22; let any = 0;
      slash(p.x, p.z, p.face, 3.3 * st.reach, 5.6, 0x7a5cb0, 0.24, 0.9, 7);
      for (const e of enemies) {
        if (e.state === 'dead' || (e.state === 'spawn' && e.t < e.spawnDur * 0.45)) continue;
        const q = hitPoint(e), dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d > 3.3 * st.reach + e.r) continue; any++;
        if (isPile(e)) shatter(e); else damageEnemy(e, st.dmg * 0.75, dx / (d || 1), dz / (d || 1), 5, false, true);
      }
      if (any) { sfx.hit(); shake = Math.max(shake, 0.15); }
      sfx.swing();
    }
    if (p.ultT <= 0) { p.state = 'idle'; p.actor.play(h.idle, { fade: 0.15 }); }
  } else if (p.state === 'attack') {
    const s = p.atk, frac = p.t / p.atkDur;
    if (frac < 0.38) { const l = s.lunge / (0.38 * p.atkDur); p.x += Math.sin(p.face) * l * dt; p.z += Math.cos(p.face) * l * dt; }
    if (!p.hitDone && frac >= s.hit) { p.hitDone = true; meleeHit(s.range * st.reach, s.arc, s.mul, s.kb, s.heavy); }
    if (input.atk) { input.atk = false; p.queued = true; }
    if (frac >= s.chain && (p.queued || input.atkHeld)) { p.combo = (p.combo + 1) % h.combo.length; startAttack(); }
    else if (frac >= 1 || (frac >= s.chain + 0.12 && moving)) { p.state = 'idle'; p.combo = 0; }
  } else if (p.state === 'hurt') {
    mv(st.speed * 0.4);
    if (p.t > 0.3) p.state = 'idle';
  }
  if (p.state === 'idle' || p.state === 'run') {
    if (input.atk || input.atkHeld) { input.atk = false; startAttack(); }
    else if (moving) {
      if (p.state !== 'run') { p.state = 'run'; }
      p.actor.play(h.run, { speed: 1.05 * st.speed / h.speed });
      mv(st.speed);
      if ((p.stepT = (p.stepT || 0) - dt) <= 0) { p.stepT = 0.27; dust(p.x - Math.sin(p.face) * 0.3, p.z - Math.cos(p.face) * 0.3, 1, 0.6, 0.6); }
      p.face += angDiff(p.face, Math.atan2(input.x, input.z)) * Math.min(1, dt * 14);
    } else { p.state = 'idle'; p.actor.play(h.idle, { fade: 0.18 }); }
  }
  pushOut(p); syncObj(p);
}

// =====================================================================
// ENEMIES
// =====================================================================
function hitPoint(e) { return isPile(e) ? { x: e.px, z: e.pz } : { x: e.x, z: e.z }; }
const isPile = e => e.state === 'pile' || e.state === 'rise';
let ringGeo = null;
function spawnEnemy(type, at) {
  const d = FOES[type], sc = 1 + (wave - 1) * 0.11;
  const g = at || pickGrave();
  const e = { type, def: d, actor: new Actor(d.model, { weapons: d.weapons, scale: d.scale }), x: g.x + rand(-0.6, 0.6), z: g.z + rand(-0.6, 0.6), vx: 0, vz: 0,
    face: g.ry, hp: d.hp * sc, maxHp: d.hp * sc, dmg: d.dmg * (1 + (wave - 1) * 0.06), state: 'spawn', t: 0, atkCd: rand(0.6, 1.4), revives: 0,
    pileT: 0, px: 0, pz: 0, ring: null, r: d.r, hitDone: false, stagger: 0, castCd: rand(4, 7), summonDone: 0, slamAt: null };
  e.spawnDur = e.actor.play('Spawn_Ground_Skeletons', { once: true, speed: d.boss ? 1.1 : 1.7, fade: 0 });
  syncObj(e); enemies.push(e); sfx.rise(); dust(e.x, e.z, d.boss ? 18 : 8, d.boss ? 2 : 1.1, 2.2, 0x6a5a66); sparks(e.x, 0.3, e.z, 8, 0x9b6bff, 3);
  for (let i = 0; i < 3; i++) spawnDebris(e.x, 0.2, e.z, 4, 0.5);
  if (d.boss) { bossRef = e; $('bossbar').classList.remove('hidden'); sfx.roar(); }
  return e;
}
function pickGrave() {
  const far = GRAVES.filter(g => !player || Math.hypot(g.x - player.x, g.z - player.z) > 7);
  return pick(far.length ? far : GRAVES);
}
function damageEnemy(e, dmg, dx, dz, kb, heavy, noStagger) {
  if (e.state === 'dead' || isPile(e)) return;
  e.hp -= dmg; e.actor.hit();
  sparks(e.x - dx * 0.3 * e.def.scale, 1.3 * e.def.scale, e.z - dz * 0.3 * e.def.scale, heavy ? 12 : 7, heavy ? 0xffd27a : 0xfff2d8, heavy ? 7 : 5, dx * 0.6, dz * 0.6);
  num(e.x, e.def.boss ? 5 : 2.8, e.z, Math.round(dmg), heavy ? '#ffcc4d' : '#fff');
  const kbm = e.def.boss ? 0.15 : 1; e.vx += dx * kb * kbm; e.vz += dz * kb * kbm;
  player.ult = Math.min(100, player.ult + 2.5 * st.ultGain);
  if (e.hp <= 0) {
    if (e.def.boss) return bossDie(e);
    if (e.revives >= MAX_REVIVES) return shatter(e);
    return collapse(e);
  }
  if (!e.def.boss && !noStagger && (heavy || e.state !== 'attack' || e.type === 'minion')) {
    e.state = 'stagger'; e.t = 0; e.stagger = heavy ? 0.55 : 0.32;
    e.actor.play('Hit_B', { once: true, speed: 2.2, restart: true, fade: 0.05 });
  }
}
function collapse(e) {
  e.state = 'pile'; e.t = 0; e.pileT = PILE_TIME + st.ward;
  e.actor.play('Death_C_Skeletons', { once: true, speed: 1.6, fade: 0.06 });
  const back = 0.95 * e.def.scale; e.px = e.x - Math.sin(e.face) * back; e.pz = e.z - Math.cos(e.face) * back;
  if (!ringGeo) ringGeo = new THREE.RingGeometry(0.85, 1.05, 40).rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xb48aff, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.position.set(e.px, 0.1, e.pz); scene.add(ring); e.ring = ring;
  e.actor.glow.setRGB(0, 0, 0);
  sfx.collapse(); dust(e.px, e.pz, 6, 1, 1.8);
}
function resurrect(e, fast) {
  e.state = 'rise'; e.t = 0;
  e.riseDur = e.actor.play('Death_C_Skeletons_Resurrect', { once: true, speed: fast ? 2.2 : 1.7, fade: 0.05 });
  sfx.resurrect();
}
function shatter(e) {
  if (e.state === 'dead') return;
  const p = hitPoint(e);
  e.state = 'dead'; if (e.ring) { scene.remove(e.ring); e.ring.material.dispose(); e.ring = null; }
  e.actor.dispose();
  kills++; shake = Math.max(shake, 0.25); punch = Math.max(punch, 0.035);
  sparks(p.x, 0.7, p.z, 16, 0xd9c2ff, 7); sparks(p.x, 0.7, p.z, 8, 0xfff2d8, 5); dust(p.x, p.z, 6, 1.2, 2.5);
  // shatter streaks: several piles in quick succession pay extra gold
  streak = streakT > 0 ? streak + 1 : 1; streakT = 2.2;
  Audio.play('shatter', 0.6, rand(0.92, 1.02) + Math.min(0.45, (streak - 1) * 0.06), 0.03);
  if (streak >= 3) { runGold += streak - 2; showStreak(streak); }
  save.smashed = Math.min(99, (save.smashed || 0) + 1);
  for (let i = 0; i < 7; i++) spawnDebris(p.x, 0.6, p.z, 7, 1);
  dropCoins(p.x, p.z, e.def.gold + Math.floor(wave / 3));
  player.ult = Math.min(100, player.ult + 6 * st.ultGain);
  if (st.vamp) { player.hp = Math.min(st.maxHp, player.hp + st.vamp); num(player.x, 2.8, player.z, '+' + st.vamp, '#66e08a'); }
  if (st.quake) {
    fx.push({ k: 'wave', x: p.x, z: p.z, t: 0, dur: 0.35, r: 3.2 });
    for (const o of enemies) {
      if (o === e || o.state === 'dead' || isPile(o)) continue;
      const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
      if (d < 3.2 + o.r) damageEnemy(o, st.dmg * 0.6 * st.quake, dx / (d || 1), dz / (d || 1), 7, false);
    }
  }
}
function bossDie(e) {
  e.state = 'dead'; bossRef = null; $('bossbar').classList.add('hidden');
  e.actor.play('Death_A', { once: true, speed: 0.8 });
  slowmo = 1.6; shake = 1; sfx.slam(); sfx.shatter();
  kills++;
  setTimeout(() => {
    e.actor.dispose();
    for (let i = 0; i < 26; i++) spawnDebris(e.x + rand(-1, 1), 1.5, e.z + rand(-1, 1), 10, 1.6);
    dropCoins(e.x, e.z, e.def.gold); sfx.shatter(); shake = 0.8;
  }, 900);
}
function updateEnemies(dt) {
  const alive = enemies.filter(e => e.state !== 'dead' && !isPile(e) && e.state !== 'spawn');
  for (const e of enemies) {
    if (e.state === 'dead') continue;
    e.t += dt; e.atkCd -= dt; e.castCd -= dt;
    const d = e.def, dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz);
    // knockback
    e.x += e.vx * dt; e.z += e.vz * dt; e.vx *= Math.exp(-dt * 7); e.vz *= Math.exp(-dt * 7);
    const faceTo = (ang, k) => { e.face += angDiff(e.face, ang) * Math.min(1, dt * k); };
    switch (e.state) {
      case 'spawn': if (e.t >= e.spawnDur) { e.state = 'chase'; e.t = 0; } break;
      case 'stagger': if (e.t >= e.stagger) { e.state = 'chase'; e.t = 0; } break;
      case 'pile': {
        e.pileT -= dt;
        const k = clamp(e.pileT / (PILE_TIME + st.ward), 0, 1);
        if (e.ring) { e.ring.scale.setScalar(0.6 + k * 0.8); e.ring.material.opacity = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(timeT * (k < 0.3 ? 22 : 8))); e.ring.material.color.setHex(k < 0.3 ? 0xff4d5e : 0xb48aff); }
        if (Math.random() < dt * (k < 0.3 ? 14 : 6)) wisp(e.px, e.pz, k < 0.3 ? 0xff6a8a : 0xb07aff);
        if (e.pileT <= 0) resurrect(e, false);
        break;
      }
      case 'rise':
        if (e.t >= e.riseDur) {
          e.state = 'chase'; e.t = 0; e.revives++; e.hp = e.maxHp * 0.55; e.atkCd = 0.6;
          if (e.ring) { scene.remove(e.ring); e.ring.material.dispose(); e.ring = null; }
          e.actor.glow.setRGB(0.25 * e.revives, 0.02, 0.05 * e.revives);
        }
        break;
      case 'chase': {
        if (player.state === 'dead') { e.actor.play('Idle_Combat'); break; }
        let want = d.ranged ? (dist < 6 ? -1 : dist > 10 ? 1 : 0) : (dist > d.range * 0.85 ? 1 : 0);
        // a mage first raises the nearest pile it can reach
        if (d.ranged && e.castCd <= 0) {
          const pile = enemies.find(o => o.state === 'pile' && o.pileT > 0.8 && Math.hypot(o.px - e.x, o.pz - e.z) < 11);
          if (pile) { e.state = 'summon'; e.t = 0; e.target = pile; e.castDur = e.actor.play('Spellcast_Summon', { once: true, speed: 2.6, fade: 0.1 }); e.castCd = 8; e.hitDone = false; sfx.chain(); break; }
        }
        if (e.atkCd <= 0 && (d.ranged ? dist < 13 : dist <= d.range + 0.2)) {
          e.state = 'attack'; e.t = 0; e.hitDone = false;
          e.atkDur = e.actor.play(d.atk, { once: true, speed: d.atkTs, restart: true, fade: 0.08 });
          if (d.boss) { e.slamAt = { x: player.x, z: player.z }; fx.push({ k: 'tele', x: player.x, z: player.z, t: 0, dur: e.atkDur * d.hitAt, r: 3.1 }); }
          break;
        }
        // steering: toward/away from the player, apart from the others
        let mx = 0, mz = 0;
        if (want) { mx = dx / (dist || 1) * want; mz = dz / (dist || 1) * want; }
        else if (d.ranged) { mx = -dz / (dist || 1) * 0.6; mz = dx / (dist || 1) * 0.6; }
        for (const o of alive) {
          if (o === e) continue; const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), min = e.r + o.r + 0.35;
          if (od < min && od > 0.001) { mx += ox / od * (min - od) * 2.2; mz += oz / od * (min - od) * 2.2; }
        }
        const ml = Math.hypot(mx, mz);
        if (ml > 0.05) {
          const sp = d.speed * (1 + (wave - 1) * 0.02); e.x += mx / Math.max(1, ml) * sp * dt; e.z += mz / Math.max(1, ml) * sp * dt;
          e.actor.play(d.run, { speed: d.runTs || 1 });
        } else e.actor.play('Idle_Combat', { fade: 0.2 });
        faceTo(Math.atan2(dx, dz), 8);
        break;
      }
      case 'attack': {
        const frac = e.t / e.atkDur;
        if (frac < d.hitAt) faceTo(Math.atan2(dx, dz), d.boss ? 2 : 6);
        if (d.lunge && frac < d.hitAt) { e.x += Math.sin(e.face) * d.lunge * dt; e.z += Math.cos(e.face) * d.lunge * dt; }
        if (!e.hitDone && frac >= d.hitAt) {
          e.hitDone = true;
          if (d.ranged) castBolt(e);
          else if (d.boss) {
            const s = e.slamAt; shake = 0.7; sfx.slam(); fx.push({ k: 'wave', x: s.x, z: s.z, t: 0, dur: 0.4, r: 3.1 });
            for (let i = 0; i < 6; i++) spawnDebris(s.x, 0.3, s.z, 6, 0.6);
            dust(s.x, s.z, 16, 1.6, 5); sparks(s.x, 0.4, s.z, 14, 0xffb070, 6); punch = Math.max(punch, 0.08);
            if (Math.hypot(player.x - s.x, player.z - s.z) < 3.1 + player.r) hurtPlayer(e.dmg, s.x, s.z);
          } else {
            const ang = Math.abs(angDiff(e.face, Math.atan2(dx, dz)));
            if (dist < d.range + 0.8 && ang < 1.2) hurtPlayer(e.dmg, e.x, e.z);
          }
        }
        if (frac >= 1) { e.state = 'chase'; e.t = 0; e.atkCd = d.cd * rand(0.8, 1.25); }
        break;
      }
      case 'summon': {
        const frac = e.t / e.castDur;
        if (!e.hitDone && frac >= 0.45) {
          e.hitDone = true; const pile = e.target;
          if (pile && pile.state === 'pile') { resurrect(pile, true); fx.push({ k: 'beam', a: e, b: pile, t: 0, dur: 0.6 }); }
        }
        if (frac >= 1) { e.state = 'chase'; e.t = 0; }
        break;
      }
    }
    // the boss calls for help at 2/3 and 1/3 health
    if (d.boss && e.state !== 'dead') {
      const step = e.hp < e.maxHp / 3 ? 2 : e.hp < e.maxHp * 2 / 3 ? 1 : 0;
      if (step > e.summonDone) { e.summonDone = step; sfx.roar(); banner('THE DEAD ANSWER', 'Minions are rising'); for (let i = 0; i < 3 + wave / 5; i++) queue.unshift(i % 3 === 2 ? 'warrior' : 'minion'); spawnT = 0.3; }
      $('bossfill').style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
    }
    if (!isPile(e) && e.state !== 'spawn') pushOut(e);
    syncObj(e);
    e.actor.update(dt);
  }
  enemies = enemies.filter(e => e.state !== 'dead' || e === bossRef);
}
function pushOut(a) {
  for (const c of colliders) {
    const dx = a.x - c.x, dz = a.z - c.z, d = Math.hypot(dx, dz), min = c.r + a.r;
    if (d < min && d > 0.0001) { a.x = c.x + dx / d * min; a.z = c.z + dz / d * min; }
  }
  a.x = clamp(a.x, -HALF, HALF); a.z = clamp(a.z, -HALF, HALF);
}

// =====================================================================
// PROJECTILES, DEBRIS, COINS, FX
// =====================================================================
const boltGeo = new THREE.SphereGeometry(0.28, 12, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: 0xd9b8ff });
function castBolt(e) {
  const a = Math.atan2(player.x - e.x, player.z - e.z);
  const m = new THREE.Mesh(boltGeo, boltMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x9b6bff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(1.8); m.add(glow);
  m.position.set(e.x + Math.sin(a) * 0.8, 1.7, e.z + Math.cos(a) * 0.8); scene.add(m);
  bolts.push({ m, vx: Math.sin(a) * 9.5, vz: Math.cos(a) * 9.5, life: 2.6, dmg: e.dmg });
  sfx.cast();
}
function updateBolts(dt) {
  for (const b of bolts) {
    b.life -= dt; b.m.position.x += b.vx * dt; b.m.position.z += b.vz * dt;
    if (Math.random() < dt * 40) FXA.emit({ x: b.m.position.x, y: 1.7, z: b.m.position.z, vx: rand(-0.4, 0.4), vy: rand(-0.2, 0.4), vz: rand(-0.4, 0.4), life: 0.35, size: rand(0.25, 0.4), color: 0xa070ff, a: 0.8 });
    if (player.state !== 'dead' && Math.hypot(b.m.position.x - player.x, b.m.position.z - player.z) < 0.85) {
      if (hurtPlayer(b.dmg, b.m.position.x - b.vx, b.m.position.z - b.vz)) { b.life = 0; sfx.boltHit(); }
    }
    if (Math.abs(b.m.position.x) > HALF + 2 || Math.abs(b.m.position.z) > HALF + 2) b.life = 0;
    if (b.life <= 0) { scene.remove(b.m); b.m.children[0].material.dispose(); }
  }
  bolts = bolts.filter(b => b.life > 0);
}
const DEBRIS = ['bone_A', 'bone_B', 'bone_C', 'bone_A', 'skull', 'ribcage'];
function spawnDebris(x, y, z, power, scale) {
  if (debris.length > 140) { const old = debris.shift(); scene.remove(old.o); }
  const o = P[pick(DEBRIS)].clone(); o.scale.setScalar(0.55 * scale * rand(0.8, 1.2));
  o.position.set(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3)); o.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
  o.traverse(m => { if (m.isMesh) m.castShadow = false; });
  scene.add(o);
  const a = rand(0, TAU), s = rand(0.3, 1) * power;
  debris.push({ o, vx: Math.cos(a) * s, vy: rand(3, 6) * (power / 7 + 0.4), vz: Math.sin(a) * s, wx: rand(-12, 12), wz: rand(-12, 12), life: rand(5, 8), rest: false });
}
function updateDebris(dt) {
  for (const d of debris) {
    d.life -= dt;
    if (!d.rest) {
      d.vy -= 24 * dt; d.o.position.x += d.vx * dt; d.o.position.y += d.vy * dt; d.o.position.z += d.vz * dt;
      d.o.rotation.x += d.wx * dt; d.o.rotation.z += d.wz * dt;
      if (d.o.position.y < 0.1) { d.o.position.y = 0.1; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.wx *= 0.5; d.wz *= 0.5; if (Math.abs(d.vy) < 1.2) d.rest = true; }
    }
    if (d.life < 0.6) d.o.scale.multiplyScalar(Math.max(0.01, 1 - dt * 4));
    if (d.life <= 0) scene.remove(d.o);
  }
  debris = debris.filter(d => d.life > 0);
}
function dropCoins(x, z, value) {
  const n = Math.min(6, 1 + Math.floor(value / 3)); let left = value;
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? left : Math.max(1, Math.floor(value / n)); left -= v;
    const o = P.coin.clone(); o.scale.setScalar(1.6); o.position.set(x, 0.6, z); scene.add(o);
    const a = rand(0, TAU), s = rand(1.5, 4);
    coins.push({ o, v, vx: Math.cos(a) * s, vy: rand(4, 7), vz: Math.sin(a) * s, t: 0 });
  }
}
function updateCoins(dt) {
  for (const c of coins) {
    c.t += dt; const p = c.o.position;
    const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz);
    if (c.t > 0.7 && (d < 4.5 || c.t > 1.6 || !waveActive) && player.state !== 'dead') {
      const sp = 14 + c.t * 6; p.x += dx / (d || 1) * sp * dt; p.z += dz / (d || 1) * sp * dt; p.y += (1.2 - p.y) * Math.min(1, dt * 8);
      if (d < 0.7) { c.done = true; runGold += c.v; sfx.coin(); sparks(p.x, 1.1, p.z, 4, 0xffd24d, 2.5, 0, 0, 0.8); }
    } else {
      c.vy -= 20 * dt; p.x += c.vx * dt; p.y += c.vy * dt; p.z += c.vz * dt;
      if (p.y < 0.15) { p.y = 0.15; c.vy *= -0.4; c.vx *= 0.5; c.vz *= 0.5; }
    }
    c.o.rotation.y += dt * 6;
    if (c.done) scene.remove(c.o);
  }
  coins = coins.filter(c => !c.done);
}
const fxRingGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
const teleGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
function updateFx(dt) {
  for (const f of fx) {
    f.t += dt; const k = f.t / f.dur;
    if (!f.m) {
      if (f.k === 'wave') f.m = new THREE.Mesh(fxRingGeo, new THREE.MeshBasicMaterial({ color: 0xe8dcff, transparent: true, depthWrite: false }));
      if (f.k === 'tele') f.m = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.25, depthWrite: false }));
      if (f.k === 'beam') {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        f.m = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xc89bff, transparent: true }));
      }
      scene.add(f.m);
    }
    if (f.k === 'slash') { f.m.rotation.y = f.face + f.spin * k; f.m.scale.setScalar(0.82 + 0.26 * Math.sqrt(k)); f.m.material.opacity = 1 - k * k; }
    if (f.k === 'wave') { f.m.position.set(f.x, 0.12, f.z); f.m.scale.setScalar(0.3 + k * f.r); f.m.material.opacity = 1 - k; }
    if (f.k === 'tele') { f.m.position.set(f.x, 0.11, f.z); f.m.scale.setScalar(f.r * (0.3 + 0.7 * Math.min(1, k * 1.4))); f.m.material.opacity = 0.18 + 0.3 * k; }
    if (f.k === 'beam') {
      const a = f.m.geometry.attributes.position; a.setXYZ(0, f.a.x, 2.2, f.a.z); a.setXYZ(1, f.b.px, 0.5, f.b.pz); a.needsUpdate = true; f.m.material.opacity = 1 - k;
    }
    if (k >= 1) { scene.remove(f.m); f.m.material.dispose(); if (f.k === 'beam') f.m.geometry.dispose(); f.gone = true; }
  }
  fx = fx.filter(f => !f.gone);
}

// floating damage numbers (DOM)
const NUMS = []; const _v = new THREE.Vector3();
for (let i = 0; i < 28; i++) { const d = document.createElement('div'); d.className = 'num'; d.style.display = 'none'; $('nums').appendChild(d); NUMS.push({ d, t: 1, x: 0, y: 0, z: 0 }); }
let numI = 0;
function num(x, y, z, text, color) { const n = NUMS[numI++ % NUMS.length]; n.t = 0; n.x = x + rand(-0.4, 0.4); n.y = y; n.z = z; n.d.textContent = text; n.d.style.color = color; n.d.style.display = ''; }
const pool = (cls, n, html = '') => Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; d.style.display = 'none'; $('nums').appendChild(d); return d; });
const EHP = pool('ehp', 14, '<i></i>'), SMASH = pool('smash', 6, '<span>SMASH!</span>'), ARROWS = pool('oarrow', 8);
const toScreen = (x, y, z) => { _v.set(x, y, z).project(camera); return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, nx: _v.x, ny: _v.y, behind: _v.z > 1 }; };
function show(el, on) { const v = on ? '' : 'none'; if (el.style.display !== v) el.style.display = v; }
function updateWorldUI() {
  const live = state === 'play';
  if (!live) $('lowhp').classList.remove('on');
  let bi = 0, si = 0, ai = 0;
  const tutorial = (save.smashed || 0) < 12 || wave <= 1;
  if (live) for (const e of enemies) {
    if (e.state === 'dead') continue;
    if (isPile(e)) {
      if (tutorial && e.state === 'pile' && si < SMASH.length) {
        const q = toScreen(e.px, 1.3, e.pz), el = SMASH[si++]; show(el, true);
        el.style.transform = `translate(${q.x}px, ${q.y}px) translate(-50%, -50%)`; el.classList.toggle('urgent', e.pileT < 1.2);
      }
      continue;
    }
    if (!e.def.boss && e.hp < e.maxHp && e.state !== 'spawn' && bi < EHP.length) {
      const q = toScreen(e.x, 2.75 * e.def.scale, e.z), el = EHP[bi++]; show(el, true);
      el.style.transform = `translate(${q.x}px, ${q.y}px)`; el.firstChild.style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`; el.classList.toggle('rev', e.revives > 0);
    }
    // arrows at the screen edge point to skeletons the camera cannot see
    if (ai < ARROWS.length && (e.state !== 'spawn' || e.t > 0.6)) {
      const q = toScreen(e.x, 1, e.z);
      let nx = q.nx, ny = q.ny; if (q.behind) { nx = -nx; ny = -ny; }
      if (!q.behind && Math.abs(nx) < 0.98 && Math.abs(ny) < 0.98) continue;
      const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1; nx /= m; ny /= m;
      const x = clamp((nx * 0.5 + 0.5) * innerWidth, 22, innerWidth - 22), y = clamp((-ny * 0.5 + 0.5) * innerHeight, 96, innerHeight - 22);
      const el = ARROWS[ai++]; show(el, true);
      el.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(-ny, nx)}rad)`;
      el.style.background = e.def.boss ? '#ffcc4d' : e.type === 'mage' ? '#b48aff' : '#ff5a6a';
    }
  }
  for (; bi < EHP.length; bi++) show(EHP[bi], false);
  for (; si < SMASH.length; si++) show(SMASH[si], false);
  for (; ai < ARROWS.length; ai++) show(ARROWS[ai], false);
}
let streakTimer = null;
function showStreak(n) {
  const el = $('streak'); el.innerHTML = `${n}x SHATTER<small>+${n - 2} gold</small>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(streakTimer); streakTimer = setTimeout(() => el.classList.remove('on'), 1500);
}
function updateNums(dt) {
  for (const n of NUMS) {
    if (n.t >= 1) continue; n.t += dt * 1.4;
    if (n.t >= 1) { n.d.style.display = 'none'; continue; }
    _v.set(n.x, n.y + n.t * 1.2, n.z).project(camera);
    const sx = (_v.x * 0.5 + 0.5) * innerWidth, sy = (-_v.y * 0.5 + 0.5) * innerHeight;
    n.d.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${n.t < 0.15 ? 0.6 + n.t * 4 : 1})`; n.d.style.opacity = 1 - Math.max(0, n.t - 0.6) / 0.4;
  }
}

// =====================================================================
// WAVES
// =====================================================================
function buildWave(n) {
  const list = [];
  if (n % 5 === 0) { list.push('boss'); for (let i = 0; i < 2 + n / 5; i++) list.push('minion'); if (n >= 10) list.push('mage', 'mage'); return list; }
  const total = 5 + Math.floor(n * 2.1);
  const pool = [['minion', 5], ['warrior', n >= 2 ? 3 : 0], ['rogue', n >= 3 ? 2.2 : 0], ['mage', n >= 4 ? 1.4 : 0]];
  const sum = pool.reduce((s, p) => s + p[1], 0); let mages = 0;
  for (let i = 0; i < total; i++) {
    let r = Math.random() * sum, t = 'minion';
    for (const [k, w] of pool) { if ((r -= w) <= 0) { t = k; break; } }
    if (t === 'mage' && ++mages > 1 + Math.floor(n / 4)) t = 'warrior';
    list.push(t);
  }
  return list;
}
function startWave() {
  wave++; queue = buildWave(wave); waveActive = true; spawnT = 1.6;
  const boss = wave % 5 === 0;
  banner(boss ? 'THE BONE KING' : 'WAVE ' + wave, boss ? 'Smash his minions, then break the king' : (wave === 1 ? 'Cut them down, then smash the bones!' : queue.length + ' skeletons rise'));
  sfx.gong(); Audio.music(boss ? 'boss' : 'battle');
}
function updateWave(dt) {
  if (!waveActive) return;
  spawnT -= dt;
  const active = enemies.filter(e => e.state !== 'dead' && !isPile(e)).length;
  const cap = Math.min(13, 5 + wave);
  if (queue.length && spawnT <= 0 && active < cap) {
    spawnEnemy(queue.shift());
    spawnT = rand(0.5, 1.3) * Math.max(0.45, 1 - wave * 0.05);
  }
  if (!queue.length && !enemies.some(e => e.state !== 'dead') && !bossRef) {
    waveActive = false; clearT = 2.4; slowmo = 0.8;
    banner('WAVE CLEARED', '+25% health');
    player.hp = Math.min(st.maxHp, player.hp + st.maxHp * 0.25);
    sfx.gem();
    if (player.state === 'idle' || player.state === 'run') { player.state = 'cheer'; player.actor.play('Cheer', { once: true, fade: 0.15 }); }
  }
}

// =====================================================================
// UI
// =====================================================================
let bannerT = null;
function banner(text, small) { const b = $('banner'); b.innerHTML = text + (small ? `<small>${small}</small>` : ''); b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2300); }
let toastT = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }
const SCREENS = ['menu', 'upgrade', 'pause', 'results'];
function only(id) { SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
const hudCache = {};
function setT(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function hud() {
  const hp = Math.max(0, player.hp) / st.maxHp;
  $('hpfill').style.transform = `scaleX(${hp})`; setT('hptext', Math.ceil(Math.max(0, player.hp)) + ' / ' + Math.round(st.maxHp));
  $('ultfill').style.transform = `scaleX(${player.ult / 100})`;
  const ready = player.ult >= 100; $('ultbar').classList.toggle('ready', ready); $('bUlt').classList.toggle('ready', ready);
  setT('wavelabel', 'WAVE ' + wave);
  const left = queue.length + enemies.filter(e => e.state !== 'dead').length;
  setT('leftlabel', waveActive ? left + ' left' : '');
  if (hudCache.goldlabel !== runGold) { const g = $('goldlabel'); g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump'); }
  setT('goldlabel', runGold);
  $('lowhp').classList.toggle('on', hp < 0.3 && player.state !== 'dead');
  if (ready && !ultWasReady) { sfx.gem(); toast(isTouch ? 'ULTIMATE READY!' : 'ULTIMATE READY: press K'); sparks(player.x, 1.5, player.z, 18, 0xc9a7ff, 5); }
  ultWasReady = ready;
}
function refreshMenu() {
  setT('menuGold', save.gold); setT('menuBest', save.best);
  $('heroes').innerHTML = '';
  for (const id in HEROES) {
    const h = HEROES[id], own = save.heroes.includes(id);
    const b = document.createElement('button'); b.className = 'hcard' + (save.hero === id ? ' sel' : '');
    b.innerHTML = `<div class="hn">${h.name}</div><div class="hd">${h.desc}</div><div class="hp">${own ? (save.hero === id ? '<span style="color:var(--green)">SELECTED</span>' : 'TAP TO SELECT') : `<span class="gold">${h.price} gold</span>`}</div>`;
    b.onclick = () => {
      if (!own) { if (save.gold < h.price) { sfx.nope(); toast('NOT ENOUGH GOLD'); return; } save.gold -= h.price; save.heroes.push(id); sfx.gem(); }
      save.hero = id; persist(); makePlayer(id); player.x = 0; player.z = 0; player.face = 0; syncObj(player); refreshMenu();
    };
    $('heroes').appendChild(b);
  }
  applyAudioLabels();
}
function applyAudioLabels() {
  ['musicBtn', 'pMusic'].forEach(id => $(id).textContent = 'MUSIC: ' + (save.music ? 'ON' : 'OFF'));
  ['sfxBtn', 'pSfx'].forEach(id => $(id).textContent = 'SOUND: ' + (save.sfx ? 'ON' : 'OFF'));
}
function showUpgrades() {
  state = 'upgrade'; gpStop();
  const opts = UPGRADES.filter(u => (ups[u.id] || 0) < u.max).sort(() => Math.random() - 0.5).slice(0, 3);
  $('upTitle').textContent = 'WAVE ' + wave + ' CLEARED';
  $('cards').innerHTML = opts.map((u, i) => `<button class="card" data-i="${i}"><div class="ic">${u.ic}</div><div><div class="cn">${u.name}${ups[u.id] ? `<span class="lv">LV ${ups[u.id] + 1}</span>` : ''}</div><div class="cd">${u.desc}</div></div>${isTouch ? '' : `<span class="key">${i + 1}</span>`}</button>`).join('');
  $('cards').onclick = ev => {
    const b = ev.target.closest('.card'); if (!b || state !== 'upgrade') return;
    const u = opts[+b.dataset.i]; ups[u.id] = (ups[u.id] || 0) + 1; u.apply(st); sfx.gem();
    only(null); state = 'break';
    commercial().then(() => { state = 'play'; gpStart(); startWave(); });
  };
  only('upgrade');
}
function showResults(win) {
  state = 'results'; gpStop();
  // a revived run can end twice: bank only the gold earned since the last results screen
  save.best = Math.max(save.best, wave); save.gold += runGold - banked; banked = runGold; persist();
  $('resStats').innerHTML = [['Wave', wave], ['Skeletons shattered', kills], ['Hero', player.def.name]].map(([a, b]) => `<div>${a}</div><div>${b}</div>`).join('');
  $('resGold').textContent = '+' + runGold + ' gold';
  $('reviveBtn').style.display = revived ? 'none' : '';
  $('doubleBtn').style.display = runGold > 0 && !doubled ? '' : 'none';
  only('results'); Audio.music(null);
}
function startRun() {
  for (const e of enemies) { e.actor.dispose(); if (e.ring) scene.remove(e.ring); }
  for (const b of bolts) scene.remove(b.m); for (const d of debris) scene.remove(d.o); for (const c of coins) scene.remove(c.o); for (const f of fx) f.m && scene.remove(f.m);
  enemies = []; bolts = []; debris = []; coins = []; fx = []; bossRef = null; $('bossbar').classList.add('hidden');
  makePlayer(save.hero); st = newStats(player.def); ups = {};
  player.x = 0; player.z = 0; player.face = Math.PI; syncObj(player);
  streak = 0; streakT = 0; ultWasReady = false; wave = 0; kills = 0; runGold = 0; banked = 0; revived = false; doubled = false; queue = []; waveActive = false;
  only(null); $('hud').classList.remove('hidden'); if (isTouch) $('touch').classList.remove('hidden');
  state = 'play'; gpStart(); startWave();
}
function revive() {
  revived = true; player.hp = st.maxHp * 0.6; player.state = 'idle'; player.inv = 2.5; player.actor.play(player.def.idle, { fade: 0.2 });
  fx.push({ k: 'wave', x: player.x, z: player.z, t: 0, dur: 0.5, r: 6 });
  for (const e of enemies) {
    if (e.state === 'dead' || isPile(e)) continue;
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
    if (d < 6) damageEnemy(e, e.def.boss ? 0 : 999, dx / (d || 1), dz / (d || 1), 12, true);
  }
  only(null); state = 'play'; gpStart(); Audio.music(wave % 5 === 0 ? 'boss' : 'battle');
}
function togglePause() {
  if (state === 'play') {
    state = 'paused'; gpStop();
    $('pauseStats').innerHTML = [['Wave', wave], ['Shattered', kills], ['Gold', runGold], ['Damage', Math.round(st.dmg)], ['Max health', Math.round(st.maxHp)]].map(([a, b]) => `<div>${a}</div><div>${b}</div>`).join('');
    only('pause');
  } else if (state === 'paused') {
    only(null); state = 'play'; last = performance.now(); gpStart();
  }
}
function toMenu() {
  state = 'menu'; gpStop(); Audio.music(null);
  for (const e of enemies) { e.actor.dispose(); if (e.ring) scene.remove(e.ring); } enemies = []; bossRef = null;
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('bossbar').classList.add('hidden');
  makePlayer(save.hero); player.x = 0; player.z = 0; player.face = 0; syncObj(player); st = newStats(player.def);
  refreshMenu(); only('menu');
}

$('playBtn').onclick = () => { Audio.init(); startRun(); };
$('againBtn').onclick = () => { only(null); state = 'break'; commercial().then(startRun); };
$('menuBtn').onclick = () => { toMenu(); };
$('reviveBtn').onclick = () => { rewarded().then(ok => { if (ok) revive(); else toast('NO AD AVAILABLE RIGHT NOW'); }); };
$('doubleBtn').onclick = () => rewarded().then(ok => {
  if (!ok) { toast('NO AD AVAILABLE RIGHT NOW'); return; }
  if (doubled) return; doubled = true; save.gold += runGold; persist();
  $('resGold').textContent = '+' + runGold * 2 + ' gold (doubled!)'; $('doubleBtn').style.display = 'none'; sfx.gem();
});
$('pauseBtn').onclick = togglePause; $('resumeBtn').onclick = togglePause;
$('quitBtn').onclick = () => { only(null); player.hp = 0; player.state = 'dead'; showResults(false); $('reviveBtn').style.display = 'none'; };
const toggleMusic = () => { save.music = !save.music; persist(); applyAudioLabels(); Audio.prefs(); };
const toggleSfx = () => { save.sfx = !save.sfx; persist(); applyAudioLabels(); };
$('musicBtn').onclick = toggleMusic; $('pMusic').onclick = toggleMusic; $('sfxBtn').onclick = toggleSfx; $('pSfx').onclick = toggleSfx;

// =====================================================================
// INPUT
// =====================================================================
const keys = {};
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (keys[e.code]) return; keys[e.code] = true;
  if (state === 'play') {
    if (e.code === 'KeyJ' || e.code === 'KeyZ') input.atk = true;
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') input.dodge = true;
    if (e.code === 'KeyK' || e.code === 'KeyE' || e.code === 'KeyC') input.ult = true;
  }
  if (state === 'upgrade' && /^Digit[1-3]$/.test(e.code)) { const c = document.querySelectorAll('#cards .card')[+e.code.slice(5) - 1]; if (c) c.click(); }
  if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'play' || state === 'paused')) togglePause();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.atkHeld = false; });
addEventListener('wheel', e => e.preventDefault(), { passive: false });
addEventListener('contextmenu', e => e.preventDefault());
const raycaster = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _m = new THREE.Vector2(), _hit = new THREE.Vector3();
function groundAt(cx, cy) { _m.set(cx / innerWidth * 2 - 1, -cy / innerHeight * 2 + 1); raycaster.setFromCamera(_m, camera); return raycaster.ray.intersectPlane(groundPlane, _hit) ? { x: _hit.x, z: _hit.z } : null; }
let mouseDown = false;
$('c').addEventListener('pointerdown', e => {
  Audio.init();
  if (e.pointerType === 'mouse' && state === 'play') {
    if (e.button === 0) { input.aim = groundAt(e.clientX, e.clientY); input.atk = true; mouseDown = true; }
    if (e.button === 2) input.ult = true;
  }
});
addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) mouseDown = false; });
// touch: floating joystick on the left part of the screen, buttons on the right
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
function joyStart(t) { joy.id = t.identifier; joy.ox = joy.x = t.clientX; joy.oy = joy.y = t.clientY; const j = $('joy'); j.style.display = 'block'; j.style.left = t.clientX + 'px'; j.style.top = t.clientY + 'px'; $('joyknob').style.transform = ''; }
addEventListener('touchstart', e => {
  Audio.init();
  if (state !== 'play') return;
  for (const t of e.changedTouches) if (joy.id === null && t.clientX < innerWidth * 0.55 && !t.target.closest('.tbtn, button')) joyStart(t);
}, { passive: true });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (t.identifier === joy.id) {
    joy.x = t.clientX; joy.y = t.clientY; const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy), m = Math.min(d, 48);
    $('joyknob').style.transform = d ? `translate(${dx / d * m}px, ${dy / d * m}px)` : '';
  }
}, { passive: true });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joy.id) { joy.id = null; $('joy').style.display = 'none'; } };
addEventListener('touchend', joyEnd); addEventListener('touchcancel', joyEnd);
function holdBtn(id, down, up) {
  const b = $(id);
  b.addEventListener('touchstart', e => { e.preventDefault(); Audio.init(); b.classList.add('down'); down(); }, { passive: false });
  const end = e => { e.preventDefault(); b.classList.remove('down'); up && up(); };
  b.addEventListener('touchend', end); b.addEventListener('touchcancel', end);
}
holdBtn('bAtk', () => { input.atk = true; input.atkHeld = true; }, () => { input.atkHeld = false; });
holdBtn('bDodge', () => { input.dodge = true; });
holdBtn('bUlt', () => { input.ult = true; });
// camera-relative movement (the camera looks north, so screen up = -z)
function readInput() {
  let x = 0, z = 0;
  if (keys.KeyA || keys.ArrowLeft) x--; if (keys.KeyD || keys.ArrowRight) x++;
  if (keys.KeyW || keys.ArrowUp) z--; if (keys.KeyS || keys.ArrowDown) z++;
  if (joy.id !== null) { const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy); if (d > 8) { const m = Math.min(1, d / 48); x = dx / d * m; z = dy / d * m; } }
  const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
  input.x = x; input.z = z;
  input.atkHeld = (keys.KeyJ || keys.KeyZ || mouseDown || $('bAtk').classList.contains('down'));
}
document.addEventListener('visibilitychange', () => { Audio.setHidden(document.hidden); if (document.hidden && state === 'play') togglePause(); });

// =====================================================================
// LOOP
// =====================================================================
const camPos = new THREE.Vector3(0, 16, 14), camLook = new THREE.Vector3();
let last = performance.now();
function update(dt) {
  timeT += dt;
  for (const t of torches) { const f = 0.85 + Math.sin(timeT * 9 + t.ph) * 0.08 + Math.sin(timeT * 23 + t.ph * 2) * 0.05; t.l.intensity = t.base * f; t.glow.material.opacity = 0.45 + f * 0.2; }
  if (state === 'play') {
    readInput();
    let w = dt; if (hitstop > 0) { hitstop -= dt; w *= 0.08; } if (slowmo > 0) { slowmo -= dt; w *= 0.35; }
    streakT -= w;
    updatePlayer(w); updateEnemies(w); updateBolts(w); updateDebris(w); updateCoins(w); updateFx(w); updateWave(w);
    player.actor.update(w);
    if (!waveActive && clearT > 0) { clearT -= dt; if (player.state === 'cheer' && clearT < 1) player.state = 'idle'; if (clearT <= 0 && !coins.length) showUpgrades(); else if (clearT <= 0) clearT = 0.1; }
    hud();
  } else if (state === 'menu') {
    menuT += dt; player.actor.update(dt); updateDebris(dt);
  } else if (state === 'results' || state === 'upgrade') {
    player.actor.update(dt); for (const e of enemies) if (e.state !== 'dead') e.actor.update(dt); updateDebris(dt);
  }
  if (player) heroLight.position.set(player.x, 4.2, player.z + 1);
  if (state !== 'paused') {
    // embers drifting up from the torches, and faint grave-dust motes around the camera target
    for (const t of torches) if (Math.random() < dt * 5) FXA.emit({ x: t.l.position.x + rand(-0.15, 0.15), y: 2.2, z: t.l.position.z + rand(-0.15, 0.15),
      vx: rand(-0.3, 0.3), vy: rand(0.8, 1.6), vz: rand(-0.3, 0.3), life: rand(1, 1.8), size: rand(0.06, 0.11), color: 0xffa040, a: 1, grav: -0.2, drag: 0.6 });
    if (Math.random() < dt * (isTouch ? 5 : 9)) FXA.emit({ x: camLook.x + rand(-13, 13), y: rand(0.2, 2.2), z: camLook.z + rand(-10, 10), vx: rand(-0.25, 0.25), vy: rand(0.05, 0.25), vz: rand(-0.25, 0.25),
      life: rand(3, 5), size: rand(0.07, 0.13), color: 0x9a86d8, a: 0.55, fin: 3 });
    const pw = state === 'play' ? (hitstop > 0 ? dt * 0.15 : slowmo > 0 ? dt * 0.4 : dt) : dt;
    FXA.update(pw); FXD.update(pw);
    if (state !== 'play') { updateFx(dt); }
  }
  // camera
  const portrait = innerWidth < innerHeight;
  if (state === 'menu') {
    const a = menuT * 0.12; camPos.set(Math.sin(a) * 15, 8.5, Math.cos(a) * 15); camLook.set(0, 1.6, 0);
    camera.position.lerp(camPos, 0.08);
  } else if (player) {
    // in portrait, back off until about 16 units of the yard fit across the screen
    const k = portrait ? clamp(0.62 / camera.aspect, 1.15, 1.75) : 1;
    camPos.set(player.x * 0.85, 15.5 * k, player.z * 0.85 + 12.5 * k); camLook.set(player.x * 0.85, 0.5, player.z * 0.85 - 0.5);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6));
  }
  if (punch > 0.001 && state === 'play') { camera.position.lerp(camLook, punch); punch *= Math.exp(-dt * 9); }
  if (shake > 0) { shake = Math.max(0, shake - dt * 2.2); camera.position.x += rand(-1, 1) * shake * 0.35; camera.position.y += rand(-1, 1) * shake * 0.25; }
  camera.lookAt(camLook);
  updateNums(dt); updateWorldUI();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (adActive || state === 'loading') return;
  if (state !== 'paused') update(dt);
  renderer.render(scene, camera);
}

// =====================================================================
// BOOT
// =====================================================================
// ?cover: load the scene only, for rendering store art with tools/cover.js (players never see this)
const COVER = new URLSearchParams(location.search).has('cover');
async function boot() {
  if (!COVER) try { await Poki.init(); } catch (e) {}
  const fill = $('loadfill');
  try { await loadAssets(p => fill.style.width = Math.round(p * 100) + '%'); }
  catch (e) { console.error(e); $('loadtext').textContent = 'Could not load the game files. Please reload.'; return; }
  buildArena();
  if (COVER) { $('loading').classList.add('hidden'); state = 'cover'; window.BC_READY = true; return; }
  makePlayer(save.hero); player.x = 0; player.z = 0; player.face = 0; syncObj(player); st = newStats(player.def);
  for (let i = 0; i < 18; i++) spawnDebris(rand(-6, 6), 0.3, rand(-6, 6), 2, 1);
  $('controlsHint').textContent = isTouch ? 'Drag on the left to move · ATTACK, ROLL and ULT buttons on the right' : 'Move: WASD · Attack: J or left click · Roll: Space · Ultimate: K or right click';
  camera.position.set(0, 9, 15);
  $('loading').classList.add('hidden'); state = 'menu'; refreshMenu(); only('menu');
  try { Poki.gameLoadingFinished(); } catch (e) {}
  Audio.loadMusic();
  requestAnimationFrame(frame);
}
boot();

// test hooks for automated checks (not used by the game)
window.BC = {
  get state() { return state; }, get player() { return player; }, get enemies() { return enemies; }, get wave() { return wave; }, input, keys,
  step(sec = 1, fps = 30) { for (let i = 0; i < sec * fps; i++) update(1 / fps); renderer.render(scene, camera); },
  spawn: (t) => spawnEnemy(t), audio: () => Audio.state(), info: () => ({ state, wave, kills, runGold, hp: player && Math.round(player.hp), pstate: player && player.state, ult: player && Math.round(player.ult), enemies: enemies.map(e => e.type + ':' + e.state + (e.revives ? '+' + e.revives : '')), queue: queue.length, debris: debris.length }),
  start: startRun, upgrade: () => showUpgrades(), noAds() { noAds = true; },
  dev: { THREE, scene, camera, renderer, Actor, P, CLIPS, prop, sparks, dust, wisp, slash, FXA, FXD, heroLight, moon, torches, spawnDebris, updateDebris: dt => updateDebris(dt), clearFx() { for (const d of debris) scene.remove(d.o); debris = []; for (const f of fx) f.m && scene.remove(f.m); fx = []; FXA.p = []; FXD.p = []; }, updateFx: dt => updateFx(dt), particleScale },
};
