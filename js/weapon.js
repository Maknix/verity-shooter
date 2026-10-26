import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ====================================================================
   First-person viewmodel: Verity-A rifle (your .glb) + procedural arms.
   Everything that moves is driven by code - no baked animation clips:
   idle breathing, walk bob, sprint pose, look sway, landing, ADS,
   spring-based recoil, bolt cycling and a keyframed reload.
   ==================================================================== */

export const TUNE = {
  scale: 0.55,                                  // model scale (the .glb is ~0.95 units long)
  hip: new THREE.Vector3(0.19, -0.2, -0.42),    // grip position in camera space (hip fire)
  adsTopOffset: -0.03,                          // where the gun's top edge sits while aiming
  adsZ: -0.36,
  sprintPos: new THREE.Vector3(0.02, -0.12, 0.03),
  sprintRot: new THREE.Euler(-0.3, 0.75, 0.14),
  fireRate: 11,                                 // rounds / second
  magSize: 30,
  reloadTime: 2.1,
  glove: 0x2b2e35, sleeve: 0x3c4a60, cuff: 0xffb81c,
};

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const Y = new THREE.Vector3(0, 1, 0);

/** damped spring for one scalar */
class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt) {
    // sub-step for stability at low fps
    const n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.k * this.x - this.c * this.v) * h; this.x += this.v * h; }
  }
}

function starTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,230,1)'); r.addColorStop(0.25, 'rgba(255,200,90,.85)'); r.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    const l = g.createLinearGradient(0, 0, 62, 0); l.addColorStop(0, 'rgba(255,240,180,.95)'); l.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = l; g.beginPath(); g.moveTo(0, -4); g.lineTo(62, 0); g.lineTo(0, 4); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Weapon {
  constructor(viewScene, viewCam, callbacks = {}) {
    this.cb = callbacks;
    this.viewScene = viewScene; this.viewCam = viewCam;
    viewScene.add(viewCam);                 // viewCam stays at the origin, identity
    this.rig = new THREE.Group();           // everything animated lives under the rig
    viewCam.add(this.rig);
    this.gun = new THREE.Group();           // grip-centred pivot (roll during reload etc.)
    this.rig.add(this.gun);
    this.armGroup = new THREE.Group(); this.rig.add(this.armGroup);

    // gameplay state
    this.mag = TUNE.magSize; this.cooldown = 0; this.reloading = false; this.reloadT = 0;
    this.shots = 0; this.loaded = false;

    // animation state
    this.time = 0; this.bobPhase = 0;
    this.walkB = 0; this.sprintB = 0; this.aimB = 0; this.airB = 0;
    this.swayX = 0; this.swayY = 0;
    this.rec = { z: new Spring(190, 17), y: new Spring(190, 17), rx: new Spring(170, 15), ry: new Spring(170, 15), rz: new Spring(170, 15) };
    this.bolt = new Spring(900, 42);
    this.land = new Spring(120, 12);
    this.flashT = 0;
    this.adsPos = new THREE.Vector3(0, -0.2, -0.36);
    this.magBase = new THREE.Vector3(); this.leftBase = new THREE.Vector3(); this.leftToMag = new THREE.Vector3();
    this.reloadEvents = { out: false, in: false, bolt: false };

    this.rig.position.copy(TUNE.hip);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 2.5, 2);
    viewScene.add(this.flashLight);
  }

  /* ---------------------------------------------------------------- */
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene; this.model = model;
    const S = TUNE.scale;
    model.rotation.y = Math.PI / 2;         // model's +X (barrel) -> camera -Z (forward)
    model.scale.setScalar(S);
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; if (o.material) o.material.envMapIntensity = 1.35; } });
    this.gun.add(model);

    // measure everything while rig/gun are at identity so Box3 == rig space
    this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
    const upd = () => { this.viewScene.updateMatrixWorld(true); };
    upd();
    const named = n => model.getObjectByName(n);
    const box = n => { const o = named(n); if (!o) return null; return new THREE.Box3().setFromObject(o); };
    const first = (...ns) => { for (const n of ns) { const b = box(n); if (b && !b.isEmpty()) return b; } return null; };
    const whole = new THREE.Box3().setFromObject(model);

    // put the origin of the gun group at the pistol grip
    const gripB0 = first('pistol_grip') || whole;
    const gripPt = gripB0.getCenter(new THREE.Vector3());
    model.position.sub(gripPt); upd();

    const wholeB = new THREE.Box3().setFromObject(model);
    const gripB = first('pistol_grip') || new THREE.Box3(new THREE.Vector3(-0.01, -0.06, -0.03), new THREE.Vector3(0.01, 0.06, 0.03));
    const handB = first('lower_handguard', 'upper_handguard') || new THREE.Box3(new THREE.Vector3(-0.015, 0.02, -0.19), new THREE.Vector3(0.015, 0.05, -0.06));
    const magB = first('magazine') || new THREE.Box3(new THREE.Vector3(-0.012, -0.1, -0.05), new THREE.Vector3(0.012, 0.0, -0.01));
    const muzzB = first('muzzle_crown', 'muzzle_bore', 'barrel') || wholeB;
    const ejB = first('ejection_port');

    // anchors (gun space)
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, muzzB.getCenter(new THREE.Vector3()).y, wholeB.min.z - 0.005);
    if (muzzB !== wholeB) { const c = muzzB.getCenter(new THREE.Vector3()); this.muzzle.position.set(c.x, c.y, muzzB.min.z - 0.004); }
    this.gun.add(this.muzzle);
    this.eject = new THREE.Object3D();
    if (ejB) this.eject.position.copy(ejB.getCenter(new THREE.Vector3())); else this.eject.position.set(0.012, 0.04, -0.03);
    this.gun.add(this.eject);

    // movable sub-assemblies
    const parent = named('Verity_A') || model;
    this.magGroup = new THREE.Group(); parent.add(this.magGroup);
    model.traverse(o => { if (o.name && /^magazine/.test(o.name) && o.name !== 'magazine_catch') this._mags = (this._mags || []).concat(o); });
    (this._mags || []).forEach(o => this.magGroup.attach(o));
    this.boltGroup = new THREE.Group(); parent.add(this.boltGroup);
    ['bolt_carrier', 'charging_handle_stem', 'charging_handle_knob'].forEach(n => { const o = named(n); if (o) this.boltGroup.attach(o); });

    this._buildHands(gripB, handB, magB);

    // muzzle flash (lives in the view scene so it never clips into walls)
    const tex = starTexture();
    this.flash = new THREE.Group(); this.flash.visible = false; this.muzzle.add(this.flash);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashSprite.scale.set(0.2, 0.2, 1); this.flash.add(this.flashSprite);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc860, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2; cone.position.z = -0.08; this.flash.add(cone);
    this.flashCone = cone;

    // ADS pose: gun centred, its top edge just under the crosshair
    const cx = (wholeB.min.x + wholeB.max.x) / 2;
    this.adsPos.set(-cx, TUNE.adsTopOffset - wholeB.max.y, TUNE.adsZ);

    // reload geometry
    const mc = magB.getCenter(new THREE.Vector3());
    this.leftToMag.set(mc.x - this.leftBase.x, (magB.min.y - 0.012) - this.leftBase.y, mc.z - this.leftBase.z);

    this.rig.position.copy(TUNE.hip);
    this.loaded = true;
  }

  /* -------------------------- hands & arms ------------------------- */
  _limb(parent, a, b, r, mat) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.0001, len - 2 * r), 4, 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Y, dir.normalize());
    parent.add(m); return m;
  }
  _buildHands(gripB, handB, magB) {
    const glove = new THREE.MeshStandardMaterial({ color: TUNE.glove, roughness: 0.78, metalness: 0.05 });
    const knuckle = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 });
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    /* ---- right hand: wraps the pistol grip ---- */
    const gc = gripB.getCenter(new THREE.Vector3()), gs = gripB.getSize(new THREE.Vector3());
    this.rh = new THREE.Group(); this.gun.add(this.rh);
    const px = gc.x + gs.x / 2 + 0.013;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.026, gs.y * 0.72, gs.z * 0.95), glove);
    palm.position.set(px, gc.y + gs.y * 0.05, gc.z + 0.004); this.rh.add(palm);
    const fz0 = gc.z - gs.z / 2 - 0.009, fl = gc.x - gs.x / 2 - 0.009;
    for (let i = 0; i < 4; i++) {
      const y = gc.y + gs.y * 0.3 - i * 0.0185;
      const a = V(px, y, gc.z - gs.z * 0.15), b = V(px, y, fz0), c = V(fl, y, fz0 + (i === 0 ? -0.004 : 0));
      this._limb(this.rh, a, b, 0.0085, glove); this._limb(this.rh, b, c, 0.0082, glove);
      const j = new THREE.Mesh(new THREE.SphereGeometry(0.0088, 10, 8), glove); j.position.copy(b); this.rh.add(j);
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.0084, 10, 8), knuckle); k.position.copy(c); this.rh.add(k);
    }
    // thumb along the left side of the grip
    const t0 = V(px - 0.004, gc.y + gs.y * 0.3, gc.z + gs.z * 0.42), t1 = V(fl - 0.004, gc.y + gs.y * 0.34, gc.z + gs.z * 0.38), t2 = V(fl - 0.004, gc.y + gs.y * 0.42, gc.z - 0.012);
    this._limb(this.rh, t0, t1, 0.0095, glove); this._limb(this.rh, t1, t2, 0.009, glove);
    this.rWrist = new THREE.Object3D(); this.rWrist.position.set(px + 0.004, gc.y - gs.y * 0.33, gc.z + gs.z * 0.6); this.rh.add(this.rWrist);
    const rWristBall = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), glove); rWristBall.position.copy(this.rWrist.position); this.rh.add(rWristBall);

    /* ---- left hand: cups the handguard from below ---- */
    const hc = handB.getCenter(new THREE.Vector3()), hs = handB.getSize(new THREE.Vector3());
    this.lh = new THREE.Group(); this.gun.add(this.lh);
    const yb = hc.y - hs.y / 2 - 0.011;
    const lpalm = new THREE.Mesh(new THREE.BoxGeometry(hs.x + 0.022, 0.016, Math.min(0.085, hs.z * 0.75)), glove);
    lpalm.position.set(hc.x, yb, hc.z + 0.006); this.lh.add(lpalm);
    for (let i = 0; i < 4; i++) {
      const z = hc.z - 0.026 + i * 0.0185;
      const a = V(hc.x - hs.x / 2, yb, z), b = V(hc.x + hs.x / 2 + 0.011, yb, z), c = V(hc.x + hs.x / 2 + 0.012, hc.y + hs.y * 0.15, z);
      this._limb(this.lh, a, b, 0.0085, glove); this._limb(this.lh, b, c, 0.008, glove);
      const j = new THREE.Mesh(new THREE.SphereGeometry(0.0088, 10, 8), glove); j.position.copy(b); this.lh.add(j);
    }
    this._limb(this.lh, V(hc.x - hs.x / 2, yb, hc.z + 0.035), V(hc.x - hs.x / 2 - 0.014, hc.y + hs.y * 0.3, hc.z + 0.004), 0.0095, glove);
    this.lWrist = new THREE.Object3D(); this.lWrist.position.set(hc.x - hs.x / 2 - 0.022, yb - 0.006, hc.z + 0.058); this.lh.add(this.lWrist);
    const lWristBall = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), glove); lWristBall.position.copy(this.lWrist.position); this.lh.add(lWristBall);
    this.leftBase.set(hc.x, yb, hc.z);

    /* ---- sleeves (2-bone IK each frame) ---- */
    const sleeve = new THREE.MeshStandardMaterial({ color: TUNE.sleeve, roughness: 0.85 });
    const cuff = new THREE.MeshStandardMaterial({ color: TUNE.cuff, roughness: 0.5, metalness: 0.1 });
    const cyl = new THREE.CylinderGeometry(0.82, 1, 1, 14);
    const mkArm = (shoulderCam, hint, L1, L2) => {
      const up = new THREE.Mesh(cyl, sleeve), fo = new THREE.Mesh(cyl, sleeve);
      const cf = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), cuff);
      const el = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), sleeve);
      [up, fo, cf, el].forEach(m => { m.frustumCulled = false; this.armGroup.add(m); });
      return { up, fo, cf, el, shoulderCam, hint: hint.normalize(), L1, L2 };
    };
    // shoulders are given in camera space; converted to rig space every frame
    this.arms = [
      mkArm(V(0.26, -0.45, 0.12), V(0.55, -0.85, 0.35), 0.31, 0.31),
      mkArm(V(-0.28, -0.45, 0.12), V(-0.55, -0.85, 0.35), 0.40, 0.40),
    ];
    this.arms[0].wrist = this.rWrist; this.arms[1].wrist = this.lWrist;
  }

  _placeSeg(mesh, from, to, r0) {
    const d = new THREE.Vector3().subVectors(to, from); const len = d.length() || 0.0001;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / len));
    mesh.scale.set(r0, len, r0);
  }
  _solveArms() {
    this.rig.updateMatrixWorld(true);
    const W = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Vector3(), dir = new THREE.Vector3(), p = new THREE.Vector3();
    for (const a of this.arms) {
      a.wrist.getWorldPosition(W); this.rig.worldToLocal(W);
      S.copy(a.shoulderCam); this.rig.worldToLocal(S);       // viewCam is identity => camera space == world space
      const reach = a.L1 + a.L2;
      dir.subVectors(W, S); let d = dir.length();
      if (d > reach * 0.985) { S.copy(W).addScaledVector(dir.normalize(), -reach * 0.985); d = reach * 0.985; dir.subVectors(W, S); }
      dir.multiplyScalar(1 / d);
      const x = (d * d + a.L1 * a.L1 - a.L2 * a.L2) / (2 * d);
      const h = Math.sqrt(Math.max(0, a.L1 * a.L1 - x * x));
      p.copy(a.hint).addScaledVector(dir, -a.hint.dot(dir)).normalize();
      E.copy(S).addScaledVector(dir, x).addScaledVector(p, h);
      this._placeSeg(a.up, S, E, 0.047);
      this._placeSeg(a.fo, E, W, 0.04);
      a.el.position.copy(E); a.el.scale.setScalar(0.044);
      // yellow cuff just above the wrist
      const fdir = new THREE.Vector3().subVectors(W, E).normalize();
      a.cf.position.copy(W).addScaledVector(fdir, -0.07); a.cf.quaternion.setFromUnitVectors(Y, fdir); a.cf.scale.set(0.047, 0.03, 0.047);
    }
  }

  /* --------------------------- gameplay API ------------------------ */
  get canFire() { return this.loaded && !this.reloading && this.cooldown <= 0 && this.mag > 0; }

  /** Call when a shot actually leaves the barrel. */
  fire() {
    this.mag--; this.cooldown = 1 / TUNE.fireRate; this.shots++;
    const aim = 1 - 0.45 * this.aimB;
    this.rec.z.v += rnd(0.55, 0.8) * aim;
    this.rec.y.v += rnd(0.05, 0.2) * aim;
    this.rec.rx.v += rnd(1.0, 1.5) * aim;
    this.rec.ry.v += rnd(-0.45, 0.45) * aim;
    this.rec.rz.v += rnd(-0.8, 0.8) * aim;
    this.bolt.v += -2.4;
    this.flashT = 0.055;
    if (this.flash) {
      this.flash.visible = true;
      this.flashSprite.material.rotation = Math.random() * 6.28;
      const s = rnd(0.16, 0.26); this.flashSprite.scale.set(s, s, 1);
      this.flashCone.scale.set(rnd(0.7, 1.2), rnd(0.8, 1.3), rnd(0.7, 1.2));
    }
  }
  startReload() {
    if (!this.loaded || this.reloading || this.mag >= TUNE.magSize) return false;
    this.reloading = true; this.reloadT = 0; this.reloadEvents = { out: false, in: false, bolt: false };
    this.cb.onReloadStart && this.cb.onReloadStart();
    return true;
  }
  /** position of an anchor in *camera space* */
  anchorCam(which, out) { (which === 'eject' ? this.eject : this.muzzle).getWorldPosition(out); return out; }

  /* ---------------------------- animation -------------------------- */
  update(dt, s) {
    if (!this.loaded) return;
    this.time += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    const speed = s.speed;                                  // horizontal m/s
    const moving = s.grounded && speed > 0.6;

    this.walkB = damp(this.walkB, moving && !s.sprint ? clamp(speed / 5.5, 0, 1) : 0, 10, dt);
    this.sprintB = damp(this.sprintB, s.sprint ? 1 : 0, 9, dt);
    this.aimB = damp(this.aimB, (s.aiming && !s.sprint && !this.reloading) ? 1 : 0, 15, dt);
    this.airB = damp(this.airB, s.grounded ? 0 : 1, 7, dt);
    if (moving) this.bobPhase += dt * speed * (s.sprint ? 1.5 : 1.65);

    const w = this.walkB, sp = this.sprintB, aim = this.aimB, ph = this.bobPhase, T = this.time;
    const calm = 1 - 0.75 * aim;

    // --- procedural locomotion ---
    let px = (Math.sin(ph) * 0.011 * w + Math.sin(ph) * 0.028 * sp) * calm;
    let py = (Math.sin(ph * 2) * 0.0065 * w + Math.sin(ph * 2 + 0.6) * 0.022 * sp) * calm;
    let pz = (Math.cos(ph * 2) * 0.005 * w + Math.cos(ph * 2) * 0.014 * sp) * calm;
    let rx = (Math.sin(ph * 2 + 0.4) * 0.011 * w + Math.sin(ph * 2) * 0.045 * sp) * calm;
    let ry = (Math.cos(ph) * 0.012 * w + Math.cos(ph) * 0.06 * sp) * calm;
    let rz = (Math.sin(ph) * 0.022 * w + Math.sin(ph) * 0.07 * sp) * calm;

    // --- idle breathing (stronger when still) ---
    const still = 1 - Math.max(w, sp);
    py += Math.sin(T * 1.45) * 0.0022 * (0.4 + still) * calm;
    rx += Math.sin(T * 1.45 + 0.7) * 0.0045 * (0.4 + still) * calm;
    px += Math.sin(T * 0.72) * 0.0016 * still * calm;
    rz += Math.sin(T * 0.9) * 0.004 * still * calm;

    // --- look sway (weapon lags behind the camera) ---
    const idt = 1 / Math.max(dt, 0.004);               // mouse px / second, so sway is frame-rate independent
    this.swayX = damp(this.swayX, clamp(-s.lookX * idt * 0.0000117, -0.05, 0.05), 11, dt);
    this.swayY = damp(this.swayY, clamp(-s.lookY * idt * 0.0000117, -0.04, 0.04), 11, dt);
    ry += this.swayX * 0.9; px += this.swayX * 0.35;
    rx += this.swayY * 0.9; py += this.swayY * 0.35;

    // --- jump / fall / landing ---
    if (s.landed) this.land.v -= clamp(s.landed, 0, 14) * 0.5;
    this.land.step(dt);
    py += clamp(-s.vy * 0.0035, -0.03, 0.03) * this.airB + this.land.x * 0.02;
    rx += clamp(s.vy * 0.004, -0.05, 0.05) * this.airB;

    // --- recoil (springs) ---
    for (const k in this.rec) this.rec[k].step(dt);
    this.bolt.step(dt);
    pz += this.rec.z.x; py += this.rec.y.x; rx += this.rec.rx.x; ry += this.rec.ry.x; rz += this.rec.rz.x;

    // --- sprint pose / ADS blend ---
    const hip = TUNE.hip, ads = this.adsPos, sprintP = TUNE.sprintPos, sprintR = TUNE.sprintRot;
    const baseX = THREE.MathUtils.lerp(hip.x, ads.x, aim) + sprintP.x * sp;
    const baseY = THREE.MathUtils.lerp(hip.y, ads.y, aim) + sprintP.y * sp;
    const baseZ = THREE.MathUtils.lerp(hip.z, ads.z, aim) + sprintP.z * sp;
    this.rig.position.set(baseX + px, baseY + py, baseZ + pz);
    this.rig.rotation.set(rx + sprintR.x * sp, ry + sprintR.y * sp, rz + sprintR.z * sp);

    // --- reload ---
    let tilt = 0, magOff = 0, magVisible = true;
    const lOff = new THREE.Vector3();
    if (this.reloading) {
      this.reloadT += dt / TUNE.reloadTime;
      const t = this.reloadT;
      tilt = sstep(0, 0.16, t) - sstep(0.86, 1, t);
      const K = [[0, 0, 0, 0], [0.16, 0, 0, 0], [0.3, 1, 0, 0], [0.42, 1, -0.008, 0], [0.54, 1, -0.2, 0.05], [0.68, 1, -0.2, 0.05], [0.8, 1, -0.07, 0], [0.86, 1, 0, 0], [1, 0, 0, 0]];
      // piecewise smooth interpolation of (toMag weight, y-offset, z-offset)
      let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
      const a = K[i], b = K[i + 1], u = sstep(a[0], b[0], clamp(t, 0, 1));
      const wMag = a[1] + (b[1] - a[1]) * u, yo = a[2] + (b[2] - a[2]) * u, zo = a[3] + (b[3] - a[3]) * u;
      lOff.copy(this.leftToMag).multiplyScalar(wMag); lOff.y += yo; lOff.z += zo;
      // magazine rides with the hand while it's being pulled / inserted, and is hidden while the hand fetches a fresh one
      if (t > 0.42 && t < 0.54) magOff = yo - (-0.008);
      else if (t >= 0.54 && t < 0.68) magVisible = false;
      else if (t >= 0.68 && t < 0.86) magOff = yo;
      if (t > 0.45 && !this.reloadEvents.out) { this.reloadEvents.out = true; this.cb.onMagOut && this.cb.onMagOut(); }
      if (t > 0.84 && !this.reloadEvents.in) { this.reloadEvents.in = true; this.cb.onMagIn && this.cb.onMagIn(); }
      if (t > 0.93 && !this.reloadEvents.bolt) { this.reloadEvents.bolt = true; this.bolt.v += -3.2; this.cb.onBolt && this.cb.onBolt(); }
      if (t >= 1) { this.reloading = false; this.mag = TUNE.magSize; this.cb.onReloadEnd && this.cb.onReloadEnd(); }
    }
    this.gun.rotation.set(tilt * 0.22, -tilt * 0.12, tilt * 0.42);
    this.gun.position.set(0, -tilt * 0.015, tilt * 0.02);
    this.lh.position.copy(lOff);
    if (this.magGroup) { this.magGroup.visible = magVisible; this.magGroup.position.set(0, magOff / TUNE.scale, 0); }
    if (this.boltGroup) this.boltGroup.position.x = clamp(this.bolt.x, -0.07, 0.008); // model-space +X is the barrel; negative = rearward

    // --- muzzle flash decay ---
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = clamp(this.flashT / 0.055, 0, 1) * 2.2;
      this.muzzle.getWorldPosition(this.flashLight.position);
      if (this.flashT <= 0 && this.flash) this.flash.visible = false;
    } else this.flashLight.intensity = 0;

    this._solveArms();
  }
}
