import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhysics, buildWorld, GROUP, ARENA } from './world.js';
import { Weapon, TUNE } from './weapon.js';
import { Falsity, TYPES, TYPE_LIST } from './enemies.js';
import { Effects, Sfx } from './fx.js';

/* ================================================================
   VERITY SHOOTER - main game
   ================================================================ */
const $ = s => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/* ---------- renderer / scenes ---------- */
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const viewScene = new THREE.Scene();                         // weapon + arms are drawn in their own pass
const viewCam = new THREE.PerspectiveCamera(TUNE.viewFov, 1, 0.01, 10);
viewScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.1));
const vsun = new THREE.DirectionalLight(0xfff0dd, 2.4); vsun.position.set(2, 3, 1.5); viewScene.add(vsun);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
viewScene.environment = envTex;

/* ---------- physics + world ---------- */
const { world, mats } = createPhysics();
const level = buildWorld(scene, world, mats);
scene.traverse(o => { if (o.isMesh && o.material && o.material.metalness > 0.5) o.material.envMap = envTex; });

const fx = new Effects(scene);
fx.camera = camera;
const sfx = new Sfx();

/* ---------- player ---------- */
const EYE = 1.17;                                            // eye above body centre
const pb = new CANNON.Body({
  mass: 80, material: mats.slippery, fixedRotation: true, linearDamping: 0,
  collisionFilterGroup: GROUP.PLAYER, collisionFilterMask: GROUP.WORLD | GROUP.ENEMY,
});
pb.addShape(new CANNON.Sphere(0.45), new CANNON.Vec3(0, 0, 0));
pb.addShape(new CANNON.Sphere(0.4), new CANNON.Vec3(0, 0.8, 0));
pb.position.set(0, 0.46, 0); pb.updateMassProperties();
world.addBody(pb);

const P = { yaw: 0, pitch: 0, health: 100, grounded: false, wasGrounded: false, lastHurt: -99, maxHealth: 100, roll: 0, shake: 0, fallV: 0, slideB: 0, carry: 0, fovP: 0 };
/* slide: C / Left Ctrl while moving. Cancel it with Space (slide-jump), Shift (pop into sprint) or C again. */
const SL = { on: false, t: 0, dx: 0, dz: -1, spd: 0, cd: 0, buf: 0, cancelReq: null, fxT: 0 };
let creditPulse = 0;
let slowT = 0, slowF = 1, timeScale = 1, flashA = 0;      // kill hit-stop + screen flash
const camKick = { p: { x: 0, v: 0 }, y: { x: 0, v: 0 } };

/* enemies hover: cancel gravity for their bodies each physics sub-step */
const enemies = [];
world.addEventListener('preStep', () => { for (const e of enemies) e.phys.force.y += e.phys.mass * 22; });

const game = { scene, world, mats, fx, sfx, hurtPlayer, enemies, shootOrb, fireShot, detonate, healPulse };

/* ---------- weapon ---------- */
const weapon = new Weapon(viewScene, viewCam, {
  onReloadStart: () => { sfx.click(); $('#reloadtxt').classList.add('on'); },
  onMagOut: () => sfx.magOut(),
  onMagIn: () => sfx.magIn(),
  onBolt: () => sfx.slide(),
  onReloadEnd: () => { $('#reloadtxt').classList.remove('on'); },
});

/* ---------- state ---------- */
let state = 'loading';     // loading | menu | playing | paused | dead
let credits = 0, waveActive = false, emptyT = 0, nearStation = false;
const discovered = new Set(), introQueue = [], orbs = [];
let score = 0, best = 0, wave = 0, toSpawn = 0, spawnT = 0, breakT = 0, combo = 0, comboT = 0, gameTime = 0;
try { best = +localStorage.getItem('verity-best') || 0; } catch (e) { /* storage blocked */ }
let bloom = 0, rmb = false, mouseDown = false, jumpQueued = false, lookX = 0, lookY = 0, landed = 0, stepDist = 0, hitT = 0;
const keys = new Set();
const isAiming = () => rmb || keys.has('KeyE');             // right mouse OR E (hold) = aim down sights

/* ================================================================
   Input
   ================================================================ */
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { if (state === 'playing') jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyR' && state === 'playing') weapon.startReload();
  if (e.code === 'KeyF') { if (state === 'playing' && nearStation) openShop(); else if (state === 'shop') closeShop(); }
  if (e.code === 'Escape' && state === 'shop') closeShop();
  if (state === 'playing') {
    if (e.code === 'KeyC' || e.code === 'ControlLeft') { if (SL.on) SL.cancelReq = 'key'; else SL.buf = 0.18; e.preventDefault(); }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && SL.on) SL.cancelReq = 'sprint';
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; rmb = false; });
addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  if (e.button === 0) { mouseDown = true; if (weapon.mag === 0) weapon.startReload(); }
  if (e.button === 2) rmb = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (state !== 'playing' || document.pointerLockElement !== canvas) return;
  const mx = clamp(e.movementX || 0, -250, 250), my = clamp(e.movementY || 0, -250, 250);
  const sens = 0.0022 * (1 - 0.45 * weapon.aimB);
  P.yaw -= mx * sens; P.pitch = clamp(P.pitch - my * sens, -1.5, 1.5);
  lookX += mx; lookY += my;
});

const overlay = $('#overlay'), goBtn = $('#go'), msg = $('#msg');
overlay.addEventListener('click', () => {
  if (state === 'loading') return;
  sfx.init();
  if (state === 'dead') resetGame();
  canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { if (state !== 'dead') state = 'playing'; document.body.classList.add('playing'); }
  else { document.body.classList.remove('playing'); mouseDown = false; rmb = false; keys.clear(); if (state === 'playing') { state = 'paused'; goBtn.textContent = 'CLICK TO RESUME'; $('#overlay h2').textContent = 'PAUSED'; } }
});
document.addEventListener('pointerlockerror', () => { msg.textContent = 'Your browser refused pointer lock - click again.'; });

/* ================================================================
   Gameplay helpers
   ================================================================ */
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();
const raycaster = new THREE.Raycaster(); raycaster.near = 0.05; raycaster.far = 120;
const hitSegA = new CANNON.Vec3(), hitSegB = new CANNON.Vec3(), rayRes = new CANNON.RaycastResult();

function raySphere(o, d, c, r) {
  tmpC.subVectors(o, c); const b = tmpC.dot(d), cc = tmpC.dot(tmpC) - r * r, disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc), t = -b - s;
  return t > 0 ? t : (-b + s > 0 ? 0.0001 : -1);
}
function viewToWorld(pCam, out) {                    // viewmodel camera space -> world (accounts for different FOVs)
  const tv = Math.tan(THREE.MathUtils.degToRad(viewCam.fov / 2)), tm = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max(0.01, -pCam.z), nx = pCam.x / (d * tv * viewCam.aspect), ny = pCam.y / (d * tv);
  out.set(nx * d * tm * camera.aspect, ny * d * tm, -d);
  return camera.localToWorld(out);
}

/* ---- tracers ---- */
const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false });
const tracers = [];
function spawnTracer(from, to) {
  const m = new THREE.Mesh(tracerGeo, tracerMat); m.frustumCulled = false; scene.add(m);
  tracers.push({ m, from: from.clone(), dir: tmpA.subVectors(to, from).normalize().clone(), len: from.distanceTo(to), t: 0 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.t += dt;
    const head = t.t * 260, tail = Math.max(0, head - 7);
    if (tail >= t.len) { scene.remove(t.m); tracers.splice(i, 1); continue; }
    const h = Math.min(head, t.len), l = Math.max(0.01, h - tail);
    tmpA.copy(t.from).addScaledVector(t.dir, tail + l / 2);
    t.m.position.copy(tmpA); t.m.scale.set(0.006, l, 0.006);
    t.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.dir);
  }
}

/* ---- bullet decals ---- */
const decalTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(20,14,6,.9)'); r.addColorStop(0.5, 'rgba(40,30,14,.5)'); r.addColorStop(1, 'rgba(40,30,14,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const decals = []; let decalI = 0;
function addDecal(p, n) {
  let m = decals[decalI];
  if (!m) { m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMat); scene.add(m); decals[decalI] = m; }
  decalI = (decalI + 1) % 48;
  const s = rnd(0.12, 0.2); m.scale.set(s, s, 1);
  m.position.copy(p).addScaledVector(n, 0.012);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); m.rotateZ(Math.random() * 6.28);
}

/* ---- shell casings (cannon-es bodies) ---- */
const casingGeo = new THREE.BoxGeometry(0.014, 0.014, 0.045);
const casingMat = new THREE.MeshStandardMaterial({ color: 0xe0a73a, metalness: 0.9, roughness: 0.3, envMap: envTex });
const casings = []; let casingI = 0;
function ejectCasing() {
  weapon.anchorCam('eject', tmpA);
  viewToWorld(tmpA, tmpB);
  let c = casings[casingI];
  if (!c) {
    const mesh = new THREE.Mesh(casingGeo, casingMat); mesh.castShadow = true; scene.add(mesh);
    const body = new CANNON.Body({ mass: 0.02, shape: new CANNON.Box(new CANNON.Vec3(0.007, 0.007, 0.0225)), material: mats.bouncy, collisionFilterGroup: GROUP.DEBRIS, collisionFilterMask: GROUP.WORLD, linearDamping: 0.05 });
    world.addBody(body); c = casings[casingI] = { mesh, body };
  }
  casingI = (casingI + 1) % 24;
  const right = tmpC.set(1, 0, 0).applyQuaternion(camera.quaternion), up = tmpD.set(0, 1, 0).applyQuaternion(camera.quaternion);
  c.body.position.set(tmpB.x, tmpB.y, tmpB.z);
  c.body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  const v = pb.velocity;
  c.body.velocity.set(v.x + right.x * rnd(2, 3.4) + up.x * rnd(1.2, 2.2), v.y + right.y * rnd(2, 3.4) + up.y * rnd(1.4, 2.4) + 0.5, v.z + right.z * rnd(2, 3.4) + up.z * rnd(1.2, 2.2));
  c.body.angularVelocity.set(rnd(-30, 30), rnd(-30, 30), rnd(-30, 30));
  c.mesh.visible = true;
}

/* ---- shooting ---- */
function currentSpread(speed) {
  const base = 0.0035 * (1 - 0.6 * weapon.aimB);
  return (base + bloom * (1 - 0.5 * weapon.aimB) + clamp(speed / 9, 0, 1) * 0.008 * (1 - weapon.aimB) + (P.grounded ? 0 : 0.015)) * (1 - 0.12 * UPG.steady);
}
function shoot(speed) {
  weapon.fire();
  sfx.shot();
  camera.updateMatrixWorld();
  const spread = currentSpread(speed);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * spread;
  dir.addScaledVector(right, Math.cos(a) * m).addScaledVector(up, Math.sin(a) * m).normalize();

  // muzzle position & effects
  weapon.anchorCam('muzzle', tmpA);
  const muzzleW = viewToWorld(tmpA, new THREE.Vector3());
  fx.muzzle(muzzleW, dir);
  ejectCasing();

  // camera kick + weapon climb + accuracy bloom
  const aim = (1 - 0.4 * weapon.aimB) * weapon.recoilMul;
  camKick.p.v += rnd(0.5, 0.75) * aim; camKick.y.v += rnd(-0.35, 0.35) * aim;
  P.pitch = clamp(P.pitch + 0.0022 * aim, -1.5, 1.5);
  bloom = Math.min(0.03, bloom + 0.0045);

  // hit scan: enemies (analytic spheres) vs world (mesh raycast)
  let bestT = 120, hitEnemy = null;
  for (const e of enemies) {
    const t = raySphere(origin, dir, e.pos, e.radius * 1.05);
    if (t >= 0 && t < bestT) { bestT = t; hitEnemy = e; }
  }
  let hitOrb = null;
  for (const o of orbs) { const t = raySphere(origin, dir, o.m.position, 0.5 * o.r); if (t >= 0 && t < bestT) { bestT = t; hitOrb = o; hitEnemy = null; } }
  raycaster.set(origin, dir);
  const wh = raycaster.intersectObjects(level.rayTargets, false)[0];
  let end;
  if (wh && wh.distance < bestT) {
    hitEnemy = null; hitOrb = null; bestT = wh.distance;
    end = wh.point;
    const n = wh.face.normal.clone().transformDirection(wh.object.matrixWorld);
    fx.impact(end, n);
    const body = wh.object.userData.body;
    if (body) {                                         // dynamic crate: shove it
      body.applyImpulse(new CANNON.Vec3(dir.x * 5, dir.y * 5, dir.z * 5), new CANNON.Vec3(end.x - body.position.x, end.y - body.position.y, end.z - body.position.z));
    } else addDecal(end, n);
  } else if (hitEnemy) {
    end = origin.clone().addScaledVector(dir, bestT);
    const killed = hitEnemy.damageBy(20 * (1 + 0.2 * UPG.dmg), dir);
    fx.enemy(end, dir.clone().negate(), killed ? 10 : 8);
    if (killed) killEnemy(hitEnemy); else sfx.hit();
    hitmarker(killed);
  } else if (hitOrb) {
    end = origin.clone().addScaledVector(dir, bestT);
    popOrb(hitOrb, true); sfx.hit(); hitmarker(false);
  } else {
    end = origin.clone().addScaledVector(dir, 90);
  }
  spawnTracer(muzzleW, end);
}
function hitmarker(kill) {
  const h = $('#hitmarker'); h.classList.toggle('kill', !!kill); h.classList.add('on'); hitT = kill ? 0.22 : 0.09;
}

function killEnemy(e) {
  e.dead = true;
  const big = e.elite;
  combo = comboT > 0 ? combo + 1 : 1; comboT = 3;
  const mult = Math.min(5, 1 + Math.floor((combo - 1) / 2));
  const pts = e.score * mult;
  const cr = Math.round(e.reward * (1 + 0.15 * (mult - 1)));
  score += pts; credits += cr; creditPulse = 1;
  fx.kill(e.pos.clone(), { elite: big, combo, scale: e.scale, text: `+${pts}` + (mult > 1 ? ` x${mult}` : '') });
  sfx.kill(combo, big);
  // juice: brief hit-stop, FOV punch, screen flash, camera shake on big kills
  slowT = big ? 0.4 : 0.07; slowF = big ? 0.18 : 0.45;
  P.fovP += big ? 7 : 3; flashA = big ? 0.75 : 0.28; $('#killflash').classList.toggle('elite', !!big);
  if (big) P.shake = Math.max(P.shake, 0.6);
  e.dispose();
}

function hurtPlayer(dmg, from) {
  if (state !== 'playing') return;
  P.health = Math.max(0, P.health - dmg); P.lastHurt = gameTime; P.shake = 1;
  $('#vignette').style.opacity = 1;
  sfx.hurt();
  tmpA.set(pb.position.x - from.x, 0, pb.position.z - from.z).normalize();
  pb.velocity.x += tmpA.x * 5; pb.velocity.z += tmpA.z * 5;
  camKick.p.v += 0.8; camKick.y.v += rnd(-1, 1);
  if (P.health <= 0) die();
}
function die() {
  state = 'dead'; sfx.die();
  if (score > best) { best = score; try { localStorage.setItem('verity-best', best); } catch (e) { /* ignore */ } }
  document.exitPointerLock();
  $('#overlay h2').textContent = `FALSITY PREVAILED  -  SCORE ${score}  -  BEST ${best}  -  WAVE ${wave}`;
  goBtn.textContent = 'CLICK TO TRY AGAIN';
}

/* ---- waves ---- */
function showBanner(t, sub) {
  const b = $('#banner'); b.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); b.classList.add('on');
  clearTimeout(showBanner.t); showBanner.t = setTimeout(() => b.classList.remove('on'), 2200);
}
function startWave() {
  wave++; waveActive = true; toSpawn = Math.min(46, 6 + wave * 3); spawnT = 0.5;
  if (wave % 3 === 0) toSpawn += 1;
  introQueue.length = 0;
  if (wave > 1) for (const T of TYPE_LIST) if (T.from === wave) { introQueue.push(T, T); toSpawn += 2; }     // new types always show up in their first wave
  showBanner(`WAVE ${wave}`, introQueue.length ? 'SOMETHING NEW APPROACHES' : (wave % 4 === 0 ? 'A GREAT FALSITY APPROACHES' : 'EXPOSE THE LIES'));
  sfx.wave();
}
function waveCleared() {
  const bonus = 30 + 9 * wave;
  credits += bonus; creditPulse = 1;
  weapon.reserve = Math.min(maxReserve(), weapon.reserve + 14);
  showBanner('WAVE CLEARED', `+${bonus} TRUTH   +14 AMMO   -   VISIT THE SUPPLY STATION`);
}
function pickType() {
  const pool = TYPE_LIST.filter(t => t.from <= wave);
  const w = pool.map(t => t.id === 'falsity' ? Math.max(2.5, t.weight - wave * 0.55) : t.weight * Math.min(1.4, 0.6 + (wave - t.from) * 0.15));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
  return pool[0];
}
function pickElite() {
  const pool = ['falsity', 'cruelty', 'buildity', 'boredity', 'evility', 'cloudity', 'sadity', 'squareity', 'heartity'].map(id => TYPES[id]).filter(t => t.from <= wave);
  return wave === 3 ? TYPES.falsity : pool[(Math.random() * pool.length) | 0];
}
function spawnEnemy() {
  let x, z, tries = 0;
  do { x = rnd(-ARENA + 3, ARENA - 3); z = rnd(-ARENA + 3, ARENA - 3); tries++; } while ((Math.hypot(x - pb.position.x, z - pb.position.z) < 18 || level.noSpawn(x, z)) && tries < 40);
  const pos = new THREE.Vector3(x, 6.5, z);
  const elite = wave % 3 === 0 && toSpawn === 0;              // the last spawn of every 4th wave
  const T = elite ? pickElite() : (introQueue.length ? introQueue.splice((Math.random() * introQueue.length) | 0, 1)[0] : pickType());
  const wf = 1 + 0.08 * (wave - 1);                           // everything gets a bit tougher each wave
  const e = new Falsity(game, pos, {
    type: T, elite,
    scale: rnd(T.scale[0], T.scale[1]) * (elite ? 1.7 : 1),
    hp: Math.round(T.hp * wf * (elite ? 5 : 1)),
    speed: Math.min(T.speedCap * 1.12, (T.speed + wave * T.speedGain + rnd(0, 0.4)) * 1.1) * (elite ? 0.85 : 1),
    damage: Math.round(T.damage * 1.2 * (1 + 0.03 * wave) * (elite ? 2 : 1)),
    reward: T.reward * (elite ? 6 : 1), score: T.score * (elite ? 5 : 1),
  });
  enemies.push(e); fx.spawn(pos); sfx.spawn();
  if (!discovered.has(T.id)) { discovered.add(T.id); if (T.id !== 'falsity') showDiscover(T); }
}
function showDiscover(T) {
  const d = $('#discover');
  d.innerHTML = `<div class="sw" style="background:#${T.color.toString(16).padStart(6, '0')}"></div><div><small>NEW VERITY DISCOVERED</small><b>${T.name}</b><span>${T.blurb}</span></div>`;
  d.classList.add('on'); clearTimeout(showDiscover.t); showDiscover.t = setTimeout(() => d.classList.remove('on'), 5200);
  sfx.discover();
}

/* ---- enemy abilities (called from enemies.js) ---- */
function healPulse(h) {
  let n = 0;
  for (const o of enemies) {
    if (o === h || o.dead || o.hp >= o.maxHp) continue;
    if (o.pos.distanceTo(h.pos) < 7.5) { o.heal(22); fx.heal(o.pos); n++; }
  }
  fx.healPulse(h.pos, 7); if (n) sfx.heal();
}
const orbGeo = new THREE.SphereGeometry(0.26, 14, 10), orbHaloGeo = new THREE.SphereGeometry(0.5, 14, 10);
const pending = [];                                             // delayed shots (burst fire)
function spawnProj(from, dir, dmg, o = {}) {
  const col = new THREE.Color(o.color ?? 0xe8ffff), hcol = new THREE.Color(o.halo ?? 0x66e0ff);
  const m = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: col }));
  const halo = new THREE.Mesh(orbHaloGeo, new THREE.MeshBasicMaterial({ color: hcol, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.add(halo); m.position.copy(from); m.scale.setScalar(o.r || 1); scene.add(m);
  const v = dir.clone().normalize().multiplyScalar(o.speed || 12);
  orbs.push({ m, halo, v, dmg, life: o.life || 5, speed: o.speed || 12, homing: o.homing || 0, r: o.r || 1, col: hcol });
}
function shootOrb(from, to, dmg, o = {}) {
  spawnProj(from, new THREE.Vector3(to.x - from.x, to.y - 0.1 - from.y, to.z - from.z), dmg, o); sfx.orb();
}
const ptn = {
  orb:    { speed: 12 },
  spread: { speed: 10, color: 0xd6ecff, halo: 0x3d8bff, r: 0.8 },
  homing: { speed: 6.5, color: 0xffd0e8, halo: 0xff3f9a, r: 1.25, homing: 1.7, life: 7 },
  burst:  { speed: 20, color: 0xfff2b0, halo: 0xffb81c, r: 0.7 },
  nova:   { speed: 8.5, color: 0xffffff, halo: 0xff5a3a, r: 1.0 },
};
function fireShot(e, player) {                                  // called by ranged enemies
  const kind = e.elite ? 'nova' : (e.type.shot || 'orb');
  const base = ptn[kind], sp = (base.speed || 12) * (1 + 0.012 * wave);
  const o = { ...base, speed: sp };
  const from = e.pos;
  if (kind === 'spread') {
    const n = 3 + (wave >= 10 ? 2 : 0);
    const ang = Math.atan2(player.x - from.x, player.z - from.z);
    for (let k = 0; k < n; k++) { const a = ang + (k - (n - 1) / 2) * 0.17; shootOrb(from, new THREE.Vector3(from.x + Math.sin(a) * 10, player.y, from.z + Math.cos(a) * 10), e.damage, o); }
  } else if (kind === 'burst') {
    for (let k = 0; k < 4; k++) pending.push({ t: k * 0.11, e, o });
  } else if (kind === 'nova') {
    const n = 14, r0 = Math.random() * 6.28;
    for (let k = 0; k < n; k++) { const a = r0 + k / n * 6.28; spawnProj(from, new THREE.Vector3(Math.sin(a), (k % 2 ? 0.05 : -0.02), Math.cos(a)), e.damage, o); }
    sfx.orb(); sfx.boom && sfx.boom();
  } else shootOrb(from, player, e.damage, o);
}
function popOrb(o, shot) {
  const i = orbs.indexOf(o); if (i >= 0) orbs.splice(i, 1);
  scene.remove(o.m); o.m.material.dispose(); o.halo.material.dispose();
  fx.impact(o.m.position, tmpD.set(0, 1, 0), fx.cBlueHi);
  if (shot) fx.glow.emit({ p: o.m.position, v: tmpC.set(0, 0, 0), life: 0.2, s0: 0.2, s1: 1.0, a0: 0.8, c0: fx.cHot, c1: fx.cBlueHi });
}
function updateOrbs(dt) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]; p.t -= dt;
    if (p.t <= 0) { pending.splice(i, 1); if (!p.e.dead) shootOrb(p.e.pos, pb.position, p.e.damage, p.o); }
  }
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i]; o.life -= dt;
    tmpA.copy(o.m.position);
    if (o.homing) {
      tmpB.set(pb.position.x - o.m.position.x, pb.position.y + 0.3 - o.m.position.y, pb.position.z - o.m.position.z).normalize().multiplyScalar(o.speed);
      o.v.lerp(tmpB, Math.min(1, o.homing * dt)); o.v.setLength(o.speed);
    }
    o.m.position.addScaledVector(o.v, dt);
    o.halo.scale.setScalar(1 + 0.15 * Math.sin(gameTime * 20 + i));
    fx.glow.emit({ p: o.m.position, v: tmpC.set(0, 0, 0), life: 0.3, s0: 0.2 * o.r, s1: 0, a0: 0.5, c0: fx.cHot, c1: o.col });
    const hitP = Math.hypot(o.m.position.x - pb.position.x, (o.m.position.y - (pb.position.y + 0.55)) * 0.8, o.m.position.z - pb.position.z) < 0.6 + 0.25 * o.r;
    let hitW = false;
    if (!hitP) {
      tmpB.subVectors(o.m.position, tmpA); const len = tmpB.length();
      if (len > 0) { raycaster.set(tmpA, tmpB.multiplyScalar(1 / len)); const savedFar = raycaster.far; raycaster.far = len + 0.3; hitW = raycaster.intersectObjects(level.rayTargets, false).length > 0; raycaster.far = savedFar; }
    }
    if (hitP) { hurtPlayer(o.dmg, o.m.position); popOrb(o, false); }
    else if (hitW || o.life <= 0) popOrb(o, false);
  }
}
function detonate(e) {                                         // Mineity blows up
  if (e.dead && e.exploded) return;
  e.dead = true; e.exploded = true;
  const R = 3.4;
  fx.explosion(e.pos.clone(), R); sfx.boom();
  const d = Math.hypot(e.pos.x - pb.position.x, e.pos.y - (pb.position.y + 0.4), e.pos.z - pb.position.z);
  if (d < R) hurtPlayer(Math.round(e.damage * (1 - 0.5 * d / R)), e.pos);
  if (d < R * 2.2) P.shake = Math.max(P.shake, 0.5);
  slowT = 0.08; slowF = 0.4; flashA = Math.max(flashA, 0.25);
  e.dispose();
}

function resetGame() {
  for (const e of enemies) if (!e.dead) e.dispose();
  enemies.length = 0;
  for (const o of [...orbs]) popOrb(o, false);
  pending.length = 0;
  Object.keys(UPG).forEach(k => UPG[k] = 0); applyUpgrades();
  credits = 0; waveActive = false; discovered.clear(); introQueue.length = 0; nearStation = false;
  score = 0; wave = 0; combo = 0; comboT = 0; toSpawn = 0; breakT = 1.2; bloom = 0; gameTime = 0;
  P.health = P.maxHealth; P.yaw = 0; P.pitch = 0; P.lastHurt = -99; SL.on = false; SL.buf = 0; SL.cd = 0; P.slideB = 0; P.carry = 0; slowT = 0; timeScale = 1;
  pb.position.set(0, 0.46, 0); pb.velocity.set(0, 0, 0);
  weapon.mag = TUNE.magSize; weapon.reserve = TUNE.reserveStart; weapon.reloading = false; $('#reloadtxt').classList.remove('on');
  state = 'paused';
}

/* ================================================================
   Economy, upgrades and the supply station
   ================================================================ */
const BASE = { fireRate: TUNE.fireRate, magSize: TUNE.magSize, reloadTime: TUNE.reloadTime, reserveMax: 180, maxHealth: 100 };
const UPG = { dmg: 0, rate: 0, mag: 0, reload: 0, steady: 0, reserve: 0, armor: 0 };
const UPGRADES = [
  { id: 'dmg',     name: 'FIREPOWER',         desc: '+20% damage per bullet',      max: 6, cost: 140, grow: 1.65, now: () => `${Math.round(20 * (1 + 0.2 * UPG.dmg))} dmg` },
  { id: 'rate',    name: 'RATE OF FIRE',      desc: '+9% rounds per second',       max: 5, cost: 120, grow: 1.6,  now: () => `${Math.round(TUNE.fireRate * 60)} rpm` },
  { id: 'mag',     name: 'EXTENDED MAGAZINE', desc: '+8 rounds per magazine',      max: 5, cost: 100, grow: 1.55, now: () => `${TUNE.magSize} rounds` },
  { id: 'reload',  name: 'QUICK HANDS',       desc: '-12% reload time',            max: 5, cost: 90,  grow: 1.55, now: () => `${TUNE.reloadTime.toFixed(2)} s` },
  { id: 'steady',  name: 'STEADY AIM',        desc: '-12% recoil and spread',      max: 5, cost: 110, grow: 1.55, now: () => `${Math.round((1 - Math.pow(0.88, UPG.steady)) * 100)}% less` },
  { id: 'reserve', name: 'AMMO POUCH',        desc: '+60 maximum spare ammo',      max: 5, cost: 80,  grow: 1.5,  now: () => `${maxReserve()} max` },
  { id: 'armor',   name: 'INTEGRITY PLATING', desc: '+25 maximum integrity',       max: 5, cost: 130, grow: 1.6,  now: () => `${P.maxHealth} max` },
];
const maxReserve = () => BASE.reserveMax + 60 * UPG.reserve;
const AMMO_PRICE = 1;                                           // truth per round
const upCost = u => Math.round(u.cost * Math.pow(u.grow, UPG[u.id]) / 10) * 10;
function applyUpgrades() {
  TUNE.fireRate = BASE.fireRate * (1 + 0.09 * UPG.rate);
  TUNE.magSize = BASE.magSize + 8 * UPG.mag;
  TUNE.reloadTime = BASE.reloadTime * Math.pow(0.88, UPG.reload);
  weapon.recoilMul = Math.pow(0.88, UPG.steady);
  const old = P.maxHealth; P.maxHealth = BASE.maxHealth + 25 * UPG.armor;
  if (P.maxHealth > old) P.health += P.maxHealth - old;
  P.health = Math.min(P.health, P.maxHealth);
}
function buy(id) {
  const ok = () => { sfx.buy(); renderShop(); };
  const no = () => { sfx.deny(); const el = $('#shop'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
  if (id === 'ammo30') {
    const n = Math.min(30, maxReserve() - weapon.reserve), c = n * AMMO_PRICE;
    if (n <= 0 || credits < c) return no(); credits -= c; weapon.reserve += n; return ok();
  }
  if (id === 'ammofull') {
    const n = maxReserve() - weapon.reserve, c = n * AMMO_PRICE;
    if (n <= 0 || credits < c) return no(); credits -= c; weapon.reserve += n; return ok();
  }
  if (id === 'repair') {
    const c = Math.ceil(P.maxHealth - P.health);
    if (c <= 0 || credits < c) return no(); credits -= c; P.health = P.maxHealth; return ok();
  }
  if (id === 'rations') {
    if (weapon.mag + weapon.reserve > 0) return no(); weapon.reserve = 20; return ok();
  }
  const u = UPGRADES.find(x => x.id === id);
  if (!u || UPG[id] >= u.max) return no();
  const c = upCost(u); if (credits < c) return no();
  credits -= c; UPG[id]++; applyUpgrades();
  if (id === 'mag' && !weapon.reloading) weapon.mag = Math.min(TUNE.magSize, weapon.mag + 8);
  ok();
}
function renderShop() {
  $('#shopCr').textContent = credits.toLocaleString();
  const row = (id, name, desc, price, enabled, tag) => `<button class="item ${enabled ? '' : 'off'}" data-buy="${id}"><div><b>${name}</b><span>${desc}</span></div><em>${tag || (price + ' ◆')}</em></button>`;
  const missing = maxReserve() - weapon.reserve, hpMissing = Math.ceil(P.maxHealth - P.health);
  let sup = row('ammo30', 'AMMO +30', 'Thirty spare rounds', Math.min(30, missing) * AMMO_PRICE, missing > 0 && credits >= Math.min(30, missing) * AMMO_PRICE, missing <= 0 ? 'FULL' : '');
  sup += row('ammofull', 'REFILL AMMO', `Top up to ${maxReserve()} spare rounds`, missing * AMMO_PRICE, missing > 0 && credits >= missing * AMMO_PRICE, missing <= 0 ? 'FULL' : '');
  sup += row('repair', 'REPAIR', 'Restore all integrity', hpMissing, hpMissing > 0 && credits >= hpMissing, hpMissing <= 0 ? 'FULL' : '');
  if (weapon.mag + weapon.reserve === 0 && credits < 30) sup += row('rations', 'EMERGENCY RATIONS', 'Free: 20 rounds (you are out of everything)', 0, true, 'FREE');
  $('#shopSupplies').innerHTML = sup;
  $('#shopStats').innerHTML = [
    ['DAMAGE', `${Math.round(20 * (1 + 0.2 * UPG.dmg))}`], ['FIRE RATE', `${Math.round(TUNE.fireRate * 60)} rpm`], ['MAGAZINE', `${TUNE.magSize}`],
    ['RELOAD', `${TUNE.reloadTime.toFixed(2)} s`], ['SPARE AMMO', `${weapon.reserve} / ${maxReserve()}`], ['INTEGRITY', `${Math.ceil(P.health)} / ${P.maxHealth}`],
  ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  $('#shopUpgrades').innerHTML = UPGRADES.map(u => {
    const lv = UPG[u.id], maxed = lv >= u.max, c = maxed ? 0 : upCost(u);
    const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
    return `<button class="up ${maxed ? 'max' : (credits >= c ? '' : 'off')}" data-buy="${u.id}"><div class="t"><b>${u.name}</b><span>${u.desc}</span></div><div class="pips">${pips}</div><div class="now">${u.now()}</div><em>${maxed ? 'MAX' : c + ' ◆'}</em></button>`;
  }).join('');
}
function openShop() {
  if (state !== 'playing') return;
  state = 'shop'; keys.clear(); mouseDown = false; rmb = false;
  document.exitPointerLock();
  document.body.classList.add('shopping'); $('#shop').classList.add('on');
  renderShop(); sfx.shop();
}
function closeShop() {
  if (state !== 'shop') return;
  document.body.classList.remove('shopping'); $('#shop').classList.remove('on');
  state = 'paused'; goBtn.textContent = 'CLICK TO RESUME'; $('#overlay h2').textContent = 'PAUSED';
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* needs a click */ }
}
$('#shop').addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b) buy(b.dataset.buy); });
$('#shopClose').addEventListener('click', closeShop);

/* ---- slide helpers ---- */
function startSlide(v) {
  const s = Math.hypot(v.x, v.z) || 1;
  SL.on = true; SL.t = 0; SL.dx = v.x / s; SL.dz = v.z / s; SL.fxT = 0;
  SL.spd = clamp(Math.max(s, 6) * 1.35 + 1.5, 9, 13);          // burst of speed on entry
  sfx.slideStart(); camKick.p.v += 0.3; P.fovP += 2.5;
  tmpA.set(SL.dx, 0, SL.dz); fx.slideCancel(tmpB.set(pb.position.x, pb.position.y - 0.4, pb.position.z), tmpA);
}
/** kind: 'end' (ran out of speed) | 'jump' | 'sprint' | 'key' | 'air'. Everything except 'end' is a slide cancel and keeps momentum. */
function endSlide(kind) {
  if (!SL.on) return;
  SL.on = false;
  const v = pb.velocity;
  if (kind === 'end') { SL.cd = 0.25; return; }
  SL.cd = 0.08;                                                  // allows chaining slide -> cancel -> slide
  tmpA.set(SL.dx, 0, SL.dz);
  if (kind === 'jump') {
    const sp = Math.min(13.5, SL.spd * 1.15 + 1.2);              // slide-hop: a little extra speed
    v.x = SL.dx * sp; v.z = SL.dz * sp; v.y = 8.6; P.grounded = false; P.carry = sp; P.fovP += 3.5;
    camKick.p.v -= 0.5; sfx.step(2);
  } else if (kind === 'sprint') { P.carry = Math.min(12, SL.spd + 1); P.fovP += 2; camKick.p.v -= 0.25; }
  else if (kind === 'key') { P.carry = SL.spd * 0.9; camKick.p.v -= 0.25; }
  else if (kind === 'air') { P.carry = SL.spd; }
  if (kind !== 'air') { fx.slideCancel(tmpB.set(pb.position.x, pb.position.y - 0.4, pb.position.z), tmpA); sfx.slideCancel(); }
}

/* ================================================================
   Main update
   ================================================================ */
const fwdV = new THREE.Vector3(), rightV = new THREE.Vector3(), wishV = new THREE.Vector3();
const hud = { credits: -1, health: -1, ammo: '', score: -1, wave: '', combo: '' };
const floorRes = new CANNON.RaycastResult();
const eyeV = new THREE.Vector3();

function update(dt) {
  gameTime += dt;

  /* --- movement input --- */
  const ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const iz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const il = Math.hypot(ix, iz) || 1;
  fwdV.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); rightV.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  wishV.set(0, 0, 0).addScaledVector(fwdV, iz / il).addScaledVector(rightV, ix / il);

  const aiming = isAiming();
  const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && iz > 0.5 && P.grounded && !mouseDown && !aiming && !SL.on;
  const v = pb.velocity;
  const feetY = pb.position.y - 0.45;

  /* --- slide (start / steer / friction / cancel) --- */
  SL.cd = Math.max(0, SL.cd - dt);
  if (SL.buf > 0) {
    SL.buf -= dt;
    if (P.grounded && SL.cd <= 0 && Math.hypot(v.x, v.z) > 4.2) { SL.buf = 0; startSlide(v); }
  }
  if (SL.on) {
    SL.t += dt;
    const cancel = SL.cancelReq; SL.cancelReq = null;
    if (jumpQueued && P.grounded) { jumpQueued = false; endSlide('jump'); }
    else if (cancel) endSlide(cancel);
    else if (!P.grounded) endSlide('air');
    else {
      if (ix || iz) {                                              // gentle steering while sliding
        const k = 1 - Math.exp(-1.8 * dt);
        SL.dx += (wishV.x - SL.dx) * k; SL.dz += (wishV.z - SL.dz) * k;
        const l = Math.hypot(SL.dx, SL.dz) || 1; SL.dx /= l; SL.dz /= l;
      }
      SL.spd = Math.max(0, SL.spd - (2.2 + SL.spd * 0.55) * dt);   // friction: ~13 m/s -> 4 m/s in ~1.2 s
      v.x = SL.dx * SL.spd; v.z = SL.dz * SL.spd;
      SL.fxT -= dt;
      if (SL.fxT <= 0) { SL.fxT = 0.06; tmpA.set(SL.dx, 0, SL.dz); fx.slide(tmpB.set(pb.position.x, feetY + 0.04, pb.position.z), tmpA, SL.spd / 12); sfx.scrape(SL.spd / 12); }
      if (SL.spd < 4.2 || SL.t > 1.6) endSlide('end');
    }
  }
  const sliding = SL.on;

  const speedT = Math.max(sprint ? 9.4 : (weapon.aimB > 0.5 ? 3.4 : 5.8), P.carry);
  P.carry = P.grounded ? damp(P.carry, 0, 4, dt) : Math.max(0, P.carry - 1.0 * dt);
  if (!sliding && (P.grounded || (ix || iz))) {
    const k = 1 - Math.exp(-(P.grounded ? 14 : 3.2) * dt);
    v.x += (wishV.x * speedT - v.x) * k; v.z += (wishV.z * speedT - v.z) * k;
  }
  if (jumpQueued && P.grounded) { v.y = 8.3; P.grounded = false; sfx.step(2); }
  jumpQueued = false;

  /* --- shooting --- */
  const speed = Math.hypot(v.x, v.z);
  if (mouseDown && weapon.canFire) shoot(speed);
  else if (mouseDown && weapon.mag === 0 && !weapon.reloading) { if (!weapon.startReload() && emptyT <= 0) { sfx.empty(); emptyT = 0.3; } }
  emptyT = Math.max(0, emptyT - dt);
  bloom = Math.max(0, bloom - dt * 0.07);

  /* --- waves --- */
  comboT = Math.max(0, comboT - dt);
  if (toSpawn > 0) {
    spawnT -= dt;
    if (spawnT <= 0 && enemies.length < 14 + wave * 1.5) { toSpawn--; spawnEnemy(); spawnT = Math.max(0.25, 1.1 - wave * 0.06); }
  } else if (enemies.length === 0) {
    if (waveActive) { waveActive = false; waveCleared(); breakT = 8; }          // intermission: go shopping
    breakT -= dt; if (breakT <= 0) { startWave(); breakT = 2; }
  }

  /* --- enemies think (set velocities) --- */
  const eye = eyeV.set(pb.position.x, pb.position.y + 0.3, pb.position.z);
  for (const e of enemies) if (!e.dead) e.update(dt, eye);

  /* --- physics --- */
  world.step(1 / 60, dt, 4);

  /* --- ground check (ray from the feet) --- */
  hitSegA.set(pb.position.x, pb.position.y, pb.position.z); hitSegB.set(pb.position.x, pb.position.y - 0.62, pb.position.z);
  floorRes.reset();
  P.wasGrounded = P.grounded;
  P.grounded = world.raycastClosest(hitSegA, hitSegB, { collisionFilterMask: GROUP.WORLD, skipBackfaces: true }, floorRes) && v.y < 1.5;
  if (!P.wasGrounded && P.grounded) { landed = Math.max(0, -P.fallV); if (landed > 3) sfx.land(); } else landed = 0;
  P.fallV = v.y;

  level.sync();
  updateOrbs(dt);
  nearStation = Math.hypot(pb.position.x - level.station.pos.x, pb.position.z - level.station.pos.z) < level.station.radius;
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  for (const c of casings) if (c) { c.mesh.position.copy(c.body.position); c.mesh.quaternion.copy(c.body.quaternion); }

  /* --- footsteps --- */
  if (P.grounded && speed > 1 && !SL.on) { stepDist += speed * dt; const stride = sprint ? 3.0 : 2.1; if (stepDist > stride) { stepDist = 0; sfx.step(sprint ? 1.6 : 1); } }

  /* --- regen --- */
  if (gameTime - P.lastHurt > 7 && P.health < P.maxHealth) P.health = Math.min(P.maxHealth, P.health + 4 * dt);

  /* --- weapon animation --- */
  weapon.update(dt, { speed: SL.on ? 0 : speed, grounded: P.grounded, sprint, aiming, vy: v.y, lookX, lookY, landed, slide: P.slideB });
  lookX = lookY = 0;
}

function updateCamera(dt) {
  const v = pb.velocity;
  // camera recoil springs
  for (const k of [camKick.p, camKick.y]) {
    const kk = 330, cc = 30, n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) { k.v += (-kk * k.x - cc * k.v) * h; k.x += k.v * h; }
  }
  P.shake = Math.max(0, P.shake - dt * 3);
  P.slideB = damp(P.slideB, SL.on ? 1 : 0, SL.on ? 14 : 11, dt);
  P.fovP = damp(P.fovP, 0, 8, dt);
  const w = weapon.walkB, sp = weapon.sprintB, ph = weapon.bobPhase;
  const bobY = (Math.sin(ph * 2) * 0.016 * w + Math.sin(ph * 2) * 0.03 * sp) * (1 - 0.7 * weapon.aimB);
  const bobX = Math.cos(ph) * (0.008 * w + 0.016 * sp);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  P.roll = damp(P.roll, -strafe * 0.014 - bobX * 0.4 - P.slideB * 0.075, 8, dt);   // lean into the slide
  const sh = P.shake * P.shake;
  camera.position.set(pb.position.x, pb.position.y + EYE - 0.62 * P.slideB + bobY - weapon.land.x * 0.02, pb.position.z);
  camera.rotation.set(P.pitch + camKick.p.x + (Math.random() - 0.5) * 0.02 * sh, P.yaw + camKick.y.x + bobX * 0.5 + (Math.random() - 0.5) * 0.02 * sh, P.roll + sh * Math.sin(gameTime * 40) * 0.03);
  const fov = 70 + 6 * sp + 7 * P.slideB * (1 - weapon.aimB) - 18 * weapon.aimB + P.fovP;
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

function updateHud(dt) {
  const hp = Math.ceil(P.health);
  if (hp !== hud.health) {
    hud.health = hp; const f = $('#health .fill'); f.style.width = (hp / P.maxHealth * 100) + '%'; f.classList.toggle('low', hp <= P.maxHealth * 0.3);
    $('#lowhp').style.boxShadow = hp <= P.maxHealth * 0.3 ? 'inset 0 0 160px 40px rgba(255,0,40,.45)' : 'inset 0 0 160px 40px rgba(255,0,40,0)';
  }
  const ak = weapon.mag + '/' + weapon.reserve;
  if (ak !== hud.ammo) { hud.ammo = ak; $('#ammo .n').innerHTML = `${weapon.mag}<small> / ${weapon.reserve}</small>`; $('#ammo').classList.toggle('low', weapon.mag <= Math.ceil(TUNE.magSize * 0.27) || weapon.reserve === 0); }
  if (credits !== hud.credits) { hud.credits = credits; $('#credits .n').textContent = credits.toLocaleString(); }
  creditPulse = Math.max(0, creditPulse - dt * 3); $('#credits').style.transform = `scale(${1 + 0.25 * creditPulse})`;
  const noAmmo = weapon.mag === 0 && weapon.reserve === 0 && !weapon.reloading, rt = $('#reloadtxt');
  rt.textContent = noAmmo ? 'OUT OF AMMO  -  VISIT THE SUPPLY STATION' : 'RELOADING'; rt.classList.toggle('on', weapon.reloading || noAmmo);
  // supply station compass + prompt
  const sp = level.station.pos, sdx = sp.x - pb.position.x, sdz = sp.z - pb.position.z;
  const ang = Math.atan2(sdx * Math.cos(P.yaw) - sdz * Math.sin(P.yaw), -sdx * Math.sin(P.yaw) - sdz * Math.cos(P.yaw));
  $('#stArrow').style.transform = `rotate(${ang}rad)`; $('#stTxt').textContent = `SUPPLY STATION  ${Math.round(Math.hypot(sdx, sdz))}m`;
  $('#stationhud').classList.toggle('near', nearStation); $('#prompt').classList.toggle('on', nearStation && state === 'playing');
  if (score !== hud.score) { hud.score = score; $('#score .n').textContent = score.toLocaleString(); }
  const left = toSpawn + enemies.length;
  const w = `WAVE ${wave}|` + (left === 0 && wave > 0 && !waveActive ? `NEXT WAVE IN ${Math.max(0, Math.ceil(breakT))}s` : `FALSITY LEFT: ${left}`);
  if (w !== hud.wave) { hud.wave = w; const [a, b] = w.split('|'); $('#wave .n').textContent = a; $('#wave .s').textContent = b; }
  const c = comboT > 0 && combo > 1 ? `${combo} KILL STREAK  x${Math.min(5, 1 + Math.floor((combo - 1) / 2))}` : '';
  if (c !== hud.combo) { hud.combo = c; $('#score .c').textContent = c; }
  // dynamic crosshair
  const px = renderer.domElement.height / renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  document.documentElement.style.setProperty('--gap', (5 + currentSpread(Math.hypot(pb.velocity.x, pb.velocity.z)) * px).toFixed(1) + 'px');
  $('#crosshair').style.opacity = String(Math.max(0, 1 - weapon.aimB * 1.25));   // fully hidden while aiming down sights
  flashA = Math.max(0, flashA - dt * 3.2); $('#killflash').style.opacity = flashA.toFixed(3);
  const vg = $('#vignette'); const o = parseFloat(vg.style.opacity || 0); if (o > 0) vg.style.opacity = Math.max(0, o - dt * 1.6);
  if (hitT > 0) { hitT -= dt; if (hitT <= 0) $('#hitmarker').classList.remove('on'); }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = viewCam.aspect = w / h; camera.updateProjectionMatrix(); viewCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ================================================================
   Loop
   ================================================================ */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const rdt = Math.min(clock.getDelta(), 0.05);
  // kill hit-stop: time dips, then eases back to normal speed
  if (slowT > 0) { slowT -= rdt; timeScale = slowF; } else timeScale = damp(timeScale, 1, 16, rdt);
  const dt = rdt * timeScale;
  if (state === 'playing') update(dt);
  else if (state !== 'loading') { weapon.update(dt, { speed: 0, grounded: true, sprint: false, aiming: false, vy: 0, lookX: 0, lookY: 0, landed: 0 }); }
  if (state !== 'loading') { updateCamera(dt); updateHud(rdt); }
  updateTracers(state === 'playing' ? dt : 0);
  fx.setScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  fx.update(state === 'playing' ? dt : 0);
  level.station.update(performance.now() / 1000);
  if (state === 'menu' || state === 'paused' || state === 'shop') level.sync();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewScene, viewCam);
}

/* ---------- boot ---------- */
camera.position.set(0, 1.63, 0);
(async () => {
  try {
    await weapon.load('assets/verity-a.glb');
    state = 'menu'; goBtn.textContent = 'CLICK TO PLAY'; $('#wave .n').textContent = 'WAVE 1';
    resetGame(); state = 'menu';
    if (best) msg.textContent = `Best score: ${best.toLocaleString()}`;
  } catch (err) {
    console.error(err);
    goBtn.textContent = 'COULD NOT LOAD verity-a.glb';
    msg.className = 'msg err';
    msg.textContent = 'The weapon model failed to load. Serve this folder over http (run run.bat / run.sh) instead of opening index.html directly.';
  }
})();
frame();
window.__verity = { scene, camera, viewCam, weapon, enemies, P, TUNE, TYPES, UPG, game: { get credits() { return credits; }, set credits(v) { credits = v; }, get wave() { return wave; }, set wave(v) { wave = v - 1; toSpawn = 0; breakT = 0; waveActive = false; for (const e of enemies) if (!e.dead) { e.dead = true; e.dispose(); } }, spawn(id, n = 1) { for (let i = 0; i < n; i++) { const T = TYPES[id]; const e = new Falsity(game, new THREE.Vector3(pb.position.x + rnd(-4, 4), 3, pb.position.z - 8 + rnd(-3, 3)), { type: T }); enemies.push(e); } }, openShop }, setViewFov: f => { viewCam.fov = f; viewCam.updateProjectionMatrix(); } };   // handy for tuning in the console
