import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhysics, buildWorld, GROUP, ARENA } from './world.js';
import { Weapon, TUNE } from './weapon.js';
import { Falsity } from './enemies.js';
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
const viewCam = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
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

const P = { yaw: 0, pitch: 0, health: 100, grounded: false, wasGrounded: false, lastHurt: -99, roll: 0, shake: 0, fallV: 0 };
const camKick = { p: { x: 0, v: 0 }, y: { x: 0, v: 0 } };

/* enemies hover: cancel gravity for their bodies each physics sub-step */
const enemies = [];
world.addEventListener('preStep', () => { for (const e of enemies) e.phys.force.y += e.phys.mass * 22; });

const game = { scene, world, mats, fx, sfx, hurtPlayer };

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
let score = 0, best = 0, wave = 0, toSpawn = 0, spawnT = 0, breakT = 0, combo = 0, comboT = 0, gameTime = 0;
try { best = +localStorage.getItem('verity-best') || 0; } catch (e) { /* storage blocked */ }
let bloom = 0, aiming = false, mouseDown = false, jumpQueued = false, lookX = 0, lookY = 0, landed = 0, stepDist = 0, hitT = 0;
const keys = new Set();

/* ================================================================
   Input
   ================================================================ */
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { if (state === 'playing') jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyR' && state === 'playing') weapon.startReload();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; aiming = false; });
addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  if (e.button === 0) { mouseDown = true; if (weapon.mag === 0) weapon.startReload(); }
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) aiming = false; });
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
  else { document.body.classList.remove('playing'); mouseDown = false; aiming = false; if (state === 'playing') { state = 'paused'; goBtn.textContent = 'CLICK TO RESUME'; $('#overlay h2').textContent = 'PAUSED'; } }
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
  return base + bloom * (1 - 0.5 * weapon.aimB) + clamp(speed / 9, 0, 1) * 0.008 * (1 - weapon.aimB) + (P.grounded ? 0 : 0.015);
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
  const aim = 1 - 0.4 * weapon.aimB;
  camKick.p.v += rnd(0.5, 0.75) * aim; camKick.y.v += rnd(-0.35, 0.35) * aim;
  P.pitch = clamp(P.pitch + 0.0022 * aim, -1.5, 1.5);
  bloom = Math.min(0.03, bloom + 0.0045);

  // hit scan: enemies (analytic spheres) vs world (mesh raycast)
  let bestT = 120, hitEnemy = null;
  for (const e of enemies) {
    const t = raySphere(origin, dir, e.pos, e.radius * 1.05);
    if (t >= 0 && t < bestT) { bestT = t; hitEnemy = e; }
  }
  raycaster.set(origin, dir);
  const wh = raycaster.intersectObjects(level.rayTargets, false)[0];
  let end;
  if (wh && wh.distance < bestT) {
    hitEnemy = null; bestT = wh.distance;
    end = wh.point;
    const n = wh.face.normal.clone().transformDirection(wh.object.matrixWorld);
    fx.impact(end, n);
    const body = wh.object.userData.body;
    if (body) {                                         // dynamic crate: shove it
      body.applyImpulse(new CANNON.Vec3(dir.x * 5, dir.y * 5, dir.z * 5), new CANNON.Vec3(end.x - body.position.x, end.y - body.position.y, end.z - body.position.z));
    } else addDecal(end, n);
  } else if (hitEnemy) {
    end = origin.clone().addScaledVector(dir, bestT);
    const killed = hitEnemy.damageBy(20, dir);
    fx.enemy(end, dir.clone().negate(), killed ? 10 : 8);
    if (killed) killEnemy(hitEnemy); else sfx.hit();
    hitmarker(killed);
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
  fx.enemy(e.pos.clone(), new THREE.Vector3(0, 1, 0), big ? 40 : 22, true);
  sfx.kill();
  if (!big) fx.glow.emit({ p: e.pos, v: new THREE.Vector3(), life: 0.2, s0: 0.4, s1: 1.8, a0: 0.6, c0: fx.cBlueHi, c1: fx.cBlue });
  combo = comboT > 0 ? combo + 1 : 1; comboT = 3;
  const mult = Math.min(5, 1 + Math.floor((combo - 1) / 2));
  score += (big ? 500 : 100) * mult;
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
  wave++; toSpawn = Math.min(34, 4 + wave * 2); spawnT = 0.5;
  if (wave % 4 === 0) toSpawn += 1;
  showBanner(`WAVE ${wave}`, wave % 4 === 0 ? 'A GREAT FALSITY APPROACHES' : 'EXPOSE THE LIES');
  sfx.wave();
}
function spawnEnemy() {
  let x, z, tries = 0;
  do { x = rnd(-ARENA + 3, ARENA - 3); z = rnd(-ARENA + 3, ARENA - 3); tries++; } while (Math.hypot(x - pb.position.x, z - pb.position.z) < 14 && tries < 20);
  const pos = new THREE.Vector3(x, 6.5, z);
  const elite = wave % 4 === 0 && toSpawn === 1;
  const e = new Falsity(game, pos, elite
    ? { scale: 1.8, hp: 320, speed: 2.8 + wave * 0.1, damage: 28, elite: true }
    : { scale: rnd(0.85, 1.1), hp: 60, speed: Math.min(6.6, 3.2 + wave * 0.28 + rnd(0, 0.6)), damage: 12 });
  enemies.push(e); fx.spawn(pos); sfx.spawn();
}

function resetGame() {
  for (const e of enemies) if (!e.dead) e.dispose();
  enemies.length = 0;
  score = 0; wave = 0; combo = 0; comboT = 0; toSpawn = 0; breakT = 1.2; bloom = 0; gameTime = 0;
  P.health = 100; P.yaw = 0; P.pitch = 0; P.lastHurt = -99;
  pb.position.set(0, 0.46, 0); pb.velocity.set(0, 0, 0);
  weapon.mag = TUNE.magSize; weapon.reloading = false; $('#reloadtxt').classList.remove('on');
  state = 'paused';
}

/* ================================================================
   Main update
   ================================================================ */
const fwdV = new THREE.Vector3(), rightV = new THREE.Vector3(), wishV = new THREE.Vector3();
const hud = { health: -1, ammo: -1, score: -1, wave: '', combo: '' };
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

  const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && iz > 0.5 && P.grounded && !mouseDown && !aiming;
  const speedT = sprint ? 9.4 : (weapon.aimB > 0.5 ? 3.4 : 5.8);
  const v = pb.velocity;
  if (P.grounded || (ix || iz)) {
    const k = 1 - Math.exp(-(P.grounded ? 14 : 3.2) * dt);
    v.x += (wishV.x * speedT - v.x) * k; v.z += (wishV.z * speedT - v.z) * k;
  }
  if (jumpQueued && P.grounded) { v.y = 8.3; P.grounded = false; sfx.step(2); }
  jumpQueued = false;

  /* --- shooting --- */
  const speed = Math.hypot(v.x, v.z);
  if (mouseDown && weapon.canFire) shoot(speed);
  else if (mouseDown && weapon.mag === 0 && !weapon.reloading) weapon.startReload();
  bloom = Math.max(0, bloom - dt * 0.07);

  /* --- waves --- */
  comboT = Math.max(0, comboT - dt);
  if (toSpawn > 0) {
    spawnT -= dt;
    if (spawnT <= 0 && enemies.length < 10 + wave) { toSpawn--; spawnEnemy(); spawnT = Math.max(0.35, 1.5 - wave * 0.07); }
  } else if (enemies.length === 0) {
    breakT -= dt; if (breakT <= 0) { startWave(); breakT = 3; }
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
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  for (const c of casings) if (c) { c.mesh.position.copy(c.body.position); c.mesh.quaternion.copy(c.body.quaternion); }

  /* --- footsteps --- */
  if (P.grounded && speed > 1) { stepDist += speed * dt; const stride = sprint ? 3.0 : 2.1; if (stepDist > stride) { stepDist = 0; sfx.step(sprint ? 1.6 : 1); } }

  /* --- regen --- */
  if (gameTime - P.lastHurt > 5 && P.health < 100) P.health = Math.min(100, P.health + 7 * dt);

  /* --- weapon animation --- */
  weapon.update(dt, { speed, grounded: P.grounded, sprint, aiming, vy: v.y, lookX, lookY, landed });
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
  const w = weapon.walkB, sp = weapon.sprintB, ph = weapon.bobPhase;
  const bobY = (Math.sin(ph * 2) * 0.016 * w + Math.sin(ph * 2) * 0.03 * sp) * (1 - 0.7 * weapon.aimB);
  const bobX = Math.cos(ph) * (0.008 * w + 0.016 * sp);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  P.roll = damp(P.roll, -strafe * 0.014 - bobX * 0.4, 8, dt);
  const sh = P.shake * P.shake;
  camera.position.set(pb.position.x, pb.position.y + EYE + bobY - weapon.land.x * 0.02, pb.position.z);
  camera.rotation.set(P.pitch + camKick.p.x + (Math.random() - 0.5) * 0.02 * sh, P.yaw + camKick.y.x + bobX * 0.5 + (Math.random() - 0.5) * 0.02 * sh, P.roll + sh * Math.sin(gameTime * 40) * 0.03);
  const fov = 70 + 6 * sp - 18 * weapon.aimB + clamp(v.y * -0.15, -1, 2) * 0;
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

function updateHud(dt) {
  const hp = Math.ceil(P.health);
  if (hp !== hud.health) {
    hud.health = hp; const f = $('#health .fill'); f.style.width = hp + '%'; f.classList.toggle('low', hp <= 30);
    $('#lowhp').style.boxShadow = hp <= 30 ? 'inset 0 0 160px 40px rgba(255,0,40,.45)' : 'inset 0 0 160px 40px rgba(255,0,40,0)';
  }
  if (weapon.mag !== hud.ammo) { hud.ammo = weapon.mag; $('#ammo .n').innerHTML = `${weapon.mag}<small> / ∞</small>`; $('#ammo').classList.toggle('low', weapon.mag <= 8); }
  if (score !== hud.score) { hud.score = score; $('#score .n').textContent = score.toLocaleString(); }
  const w = `WAVE ${wave}|FALSITY LEFT: ${toSpawn + enemies.length}`;
  if (w !== hud.wave) { hud.wave = w; const [a, b] = w.split('|'); $('#wave .n').textContent = a; $('#wave .s').textContent = b; }
  const c = comboT > 0 && combo > 1 ? `${combo} KILL STREAK  x${Math.min(5, 1 + Math.floor((combo - 1) / 2))}` : '';
  if (c !== hud.combo) { hud.combo = c; $('#score .c').textContent = c; }
  // dynamic crosshair
  const px = renderer.domElement.height / renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  document.documentElement.style.setProperty('--gap', (5 + currentSpread(Math.hypot(pb.velocity.x, pb.velocity.z)) * px).toFixed(1) + 'px');
  $('#crosshair').style.opacity = String(1 - 0.75 * weapon.aimB);
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
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'playing') update(dt);
  else if (state !== 'loading') { weapon.update(dt, { speed: 0, grounded: true, sprint: false, aiming: false, vy: 0, lookX: 0, lookY: 0, landed: 0 }); }
  if (state !== 'loading') { updateCamera(dt); updateHud(dt); }
  updateTracers(state === 'playing' ? dt : 0);
  fx.setScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  fx.update(state === 'playing' ? dt : 0);
  if (state === 'menu' || state === 'paused') level.sync();
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
window.__verity = { scene, camera, weapon, enemies, P, TUNE };   // handy for tuning in the console
