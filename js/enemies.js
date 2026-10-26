import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from './world.js';

/* ====================================================================
   The Verities. Falsity is the default enemy; every other type unlocks at
   a given wave (`from`) so new ones keep showing up as you survive.

   ai:  melee    - chase, wind up, lunge
        orbit    - circles you, then lunges from the side
        ranged   - keeps its distance and spits slow clouds
        healer   - hangs back and heals nearby falsity
        kamikaze - rushes you and detonates
        sleeper  - drowsy and slow until you wake it (shoot it / get close)
   ==================================================================== */
export const TYPES = {
  falsity:   { id: 'falsity',   name: 'FALSITY',   blurb: 'The standard lie.',                              from: 1,  weight: 10, ai: 'melee',    face: 'smile', color: 0x2d86ff, emis: 0x0b3fd6, halo: 0x4aa8ff, hp: 60,  speed: 3.2, speedGain: 0.28, speedCap: 6.6, damage: 12, scale: [0.85, 1.1],  reward: 20, score: 100 },
  lovity:    { id: 'lovity',    name: 'LOVITY',    blurb: 'Fast, fragile and very clingy.',                 from: 2,  weight: 7,  ai: 'melee',    face: 'smile', color: 0xff3fd0, emis: 0xc0108f, halo: 0xff7ae6, hp: 36,  speed: 6.2, speedGain: 0.15, speedCap: 8.2, damage: 8,  scale: [0.65, 0.78], reward: 18, score: 80,  windup: 0.22, lungeKick: 11, reach: 2.3 },
  curiosity: { id: 'curiosity', name: 'CURIOSITY', blurb: 'Circles you, then strikes from the side.',       from: 3,  weight: 6,  ai: 'orbit',    face: 'smile', color: 0x46ff2a, emis: 0x13a800, halo: 0x8dff72, hp: 55,  speed: 4.4, speedGain: 0.2,  speedCap: 7.0, damage: 14, scale: [0.8, 0.95],  reward: 26, score: 120, windup: 0.3,  lungeKick: 15 },
  cruelty:   { id: 'cruelty',   name: 'CRUELTY',   blurb: 'Hits very hard. Keep your distance.',            from: 4,  weight: 5,  ai: 'melee',    face: 'angry', color: 0xe8261a, emis: 0xa80c00, halo: 0xff6a4a, hp: 95,  speed: 4.3, speedGain: 0.2,  speedCap: 6.8, damage: 28, scale: [0.95, 1.1],  reward: 42, score: 200, windup: 0.32, lungeKick: 14 },
  helpity:   { id: 'helpity',   name: 'HELPITY',   blurb: 'Hangs back and heals the others. Kill it first.', from: 6,  weight: 4,  ai: 'healer',   face: 'smile', color: 0xc78cff, emis: 0x7a3cd6, halo: 0xe2c4ff, hp: 55,  speed: 3.6, speedGain: 0.1,  speedCap: 5.2, damage: 6,  scale: [0.8, 0.9],   reward: 38, score: 150, hoverY: 2.3 },
  buildity:  { id: 'buildity',  name: 'BUILDITY',  blurb: 'A slow wall of hit points.',                     from: 5,  weight: 4,  ai: 'melee',    face: 'smile', color: 0xff6a1a, emis: 0xc03a00, halo: 0xffa560, hp: 240, speed: 2.4, speedGain: 0.08, speedCap: 3.8, damage: 24, scale: [1.3, 1.45],  reward: 62, score: 250, windup: 0.5,  lungeKick: 12, kbResist: 3.2 },
  cloudity:  { id: 'cloudity',  name: 'CLOUDITY',  blurb: 'Spits slow clouds from a distance. Shoot them down.', from: 5, weight: 4, ai: 'ranged', shot: 'orb', cd: 2.2,  face: 'smile', color: 0xb8f7ff, emis: 0x4fb6d6, halo: 0xe2fdff, hp: 50,  speed: 3.6, speedGain: 0.1,  speedCap: 5.0, damage: 14, scale: [0.85, 0.95], reward: 40, score: 160, hoverY: 2.6 },
  sadity:    { id: 'sadity',    name: 'SADITY',    blurb: 'Weeps a fan of tears. Strafe between them.',      from: 3,  weight: 5,  ai: 'ranged',   shot: 'spread', cd: 2.8, face: 'sad', color: 0x5b7cff, emis: 0x1f35c4, halo: 0x9db0ff, hp: 48,  speed: 3.4, speedGain: 0.1, speedCap: 5.0, damage: 9,  scale: [0.8, 0.9],   reward: 34, score: 140, hoverY: 1.8 },
  heartity:  { id: 'heartity',  name: 'HEARTITY',  blurb: 'Fires slow homing hearts. Shoot them down!',      from: 6,  weight: 4,  ai: 'ranged',   shot: 'homing', cd: 3.4, face: 'smile', color: 0xff4f93, emis: 0xc01a5a, halo: 0xffa0c8, hp: 70,  speed: 3.8, speedGain: 0.1, speedCap: 5.2, damage: 16, scale: [0.9, 1.0],   reward: 48, score: 190, hoverY: 2.2 },
  squareity: { id: 'squareity', name: 'SQUAREITY', blurb: 'Fires rapid bursts. Keep moving.',                from: 9,  weight: 4,  ai: 'ranged',   shot: 'burst',  cd: 2.6, face: 'angry', color: 0xffc21c, emis: 0xb88300, halo: 0xffe38a, hp: 90,  speed: 4.2, speedGain: 0.1, speedCap: 5.8, damage: 9,  scale: [0.95, 1.05], reward: 56, score: 230, hoverY: 1.2 },
  boredity:  { id: 'boredity',  name: 'BOREDITY',  blurb: 'Dozes until woken, then rages. Let it sleep... or not.', from: 7, weight: 3, ai: 'sleeper', face: 'bored', color: 0xbfc3ca, emis: 0x555a66, halo: 0xdde0e6, hp: 140, speed: 6.6, speedGain: 0.1,  speedCap: 8.0, damage: 20, scale: [1.0, 1.15],  reward: 48, score: 200, windup: 0.3, lungeKick: 15 },
  mineity:   { id: 'mineity',   name: 'MINEITY',   blurb: 'Rushes you and detonates. Shoot it early.',      from: 8,  weight: 5,  ai: 'kamikaze', face: 'smile', color: 0xd726e0, emis: 0x8a0f96, halo: 0xf07af7, hp: 32,  speed: 6.4, speedGain: 0.15, speedCap: 8.4, damage: 34, scale: [0.7, 0.8],   reward: 30, score: 120 },
  evility:   { id: 'evility',   name: 'EVILITY',   blurb: 'The worst of them. Fast, strong, relentless.',   from: 10, weight: 4,  ai: 'melee',    face: 'angry', color: 0x8c0a10, emis: 0x5a0004, halo: 0xff2a2a, hp: 170, speed: 5.6, speedGain: 0.12, speedCap: 8.0, damage: 34, scale: [1.15, 1.25], reward: 85, score: 400, windup: 0.22, lungeKick: 17, kbResist: 1.6 },
};
export const TYPE_LIST = Object.values(TYPES);

let GEO = null;
function geo() {
  if (GEO) return GEO;
  const bar = new THREE.PlaneGeometry(1, 0.07); bar.translate(0.5, 0, 0);
  GEO = {
    body: new THREE.SphereGeometry(0.6, 32, 24),
    halo: new THREE.SphereGeometry(0.72, 24, 16),
    unit: new THREE.SphereGeometry(1, 14, 10),
    box: new THREE.BoxGeometry(1, 1, 1),
    bar,
  };
  return GEO;
}
const DARK = new THREE.MeshBasicMaterial({ color: 0x04122e });
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });
const BAR_BACK = new THREE.MeshBasicMaterial({ color: 0x0a1226, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, fog: false });

/** Place `mesh` on a sphere of radius r at (yaw, pitch), facing outward (+Z local). */
function onSphere(mesh, yaw, pitch, r) {
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  mesh.position.copy(d).multiplyScalar(r);
  mesh.lookAt(d.multiplyScalar(r * 2));
}

const _o = new THREE.Object3D(), _t = new THREE.Vector3(), _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const _c1 = new THREE.Color(), _green = new THREE.Color(0.2, 1, 0.45), _white = new THREE.Color(1, 1, 1);

export class Falsity {
  /** opts: { type, scale, hp, speed, damage, elite } - anything missing falls back to the type's defaults */
  constructor(game, pos, opts = {}) {
    const T = this.type = opts.type || TYPES.falsity;
    const scale = opts.scale ?? rnd(T.scale[0], T.scale[1]);
    this.game = game; this.scale = scale; this.elite = !!opts.elite;
    this.radius = 0.6 * scale;
    this.maxHp = this.hp = opts.hp ?? T.hp; this.speed = opts.speed ?? T.speed; this.damage = opts.damage ?? T.damage;
    this.reward = opts.reward ?? T.reward; this.score = opts.score ?? T.score;
    this.dead = false;
    this.seed = Math.random() * 100;
    this.age = 0;
    this.state = 'chase'; this.stateT = 0; this.cooldown = 1 + Math.random();
    this.hitFlash = 0; this.healFlash = 0; this.kb = new THREE.Vector3(); this.lungeHit = false;
    this.trailT = 0; this.stuckT = 0; this.sideDir = 0;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1; this.orbitT = rnd(1.5, 3);
    this.pulseT = rnd(1.2, 2.2);
    this.awake = T.ai !== 'sleeper';

    const g = geo();
    this.group = new THREE.Group();
    this.baseEmis = new THREE.Color(T.emis);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: T.color, roughness: 0.22, metalness: 0.05, emissive: T.emis, emissiveIntensity: 0.65 });
    this.body = new THREE.Mesh(g.body, this.bodyMat);
    this.body.castShadow = true;
    this.group.add(this.body);
    this.haloMat = new THREE.MeshBasicMaterial({ color: T.halo, transparent: true, opacity: 0.2, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.halo = new THREE.Mesh(g.halo, this.haloMat);
    this.group.add(this.halo);

    // face (built on the +Z side of the sphere)
    this.face = new THREE.Group(); this.body.add(this.face);
    const angry = T.face === 'angry', bored = T.face === 'bored';
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(g.unit, DARK);
      onSphere(eye, sx * 0.4, 0.2, 0.585);
      eye.scale.set(bored ? 0.1 : 0.075, bored ? 0.028 : (angry ? 0.1 : 0.13), 0.04); this.face.add(eye);
      if (!bored && !angry) {
        const sp = new THREE.Mesh(g.unit, WHITE);   // eye sparkle (child of the squashed eye ellipsoid)
        sp.position.set(0.3, 0.38, 0.85); sp.scale.set(0.26, 0.2, 0.2); eye.add(sp);
      }
      if (angry) {                                  // slanted brows
        const brow = new THREE.Mesh(g.box, DARK);
        onSphere(brow, sx * 0.4, 0.42, 0.59); brow.scale.set(0.16, 0.03, 0.03); brow.rotateZ(sx * 0.6); this.face.add(brow);
      }
    }
    const N = 15;
    this.smile = new THREE.Group(); this.face.add(this.smile);
    for (let i = 0; i < N; i++) {
      const u = (i / (N - 1)) * 2 - 1;
      const b = new THREE.Mesh(g.unit, DARK);
      const pitch = (angry || T.face === 'sad') ? -0.38 - 0.28 * u * u : (bored ? -0.46 : -0.5 + 0.32 * u * u);
      onSphere(b, u * (bored ? 0.34 : 0.62), pitch, 0.592);
      const r = 0.048 - 0.014 * Math.abs(u) ** 2;
      b.scale.set(r, r, r * 0.6); this.smile.add(b);
    }

    // health bar (child of the group, which always faces the player)
    this.barFront = new THREE.Mesh(g.bar, new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    this.barBack = new THREE.Mesh(g.bar, BAR_BACK);
    this.barBack.position.set(-0.45, 0.98, 0.02); this.barBack.scale.set(0.9, 1.3, 1);
    this.barFront.position.set(-0.45, 0.98, 0.03); this.barFront.scale.set(0.9, 1, 1);
    this.barBack.renderOrder = 20; this.barFront.renderOrder = 21;   // both transparent => sorted by renderOrder, so the fill draws ON TOP of the dark backing
    this.group.add(this.barBack, this.barFront);
    this.barBack.visible = this.barFront.visible = this.elite;

    this.group.scale.setScalar(scale);
    game.scene.add(this.group);

    this.phys = new CANNON.Body({
      mass: 1 * scale, shape: new CANNON.Sphere(this.radius), material: game.mats.slippery,
      collisionFilterGroup: GROUP.ENEMY, collisionFilterMask: GROUP.WORLD | GROUP.ENEMY | GROUP.PLAYER,
      linearDamping: 0.1, fixedRotation: true,
    });
    this.phys.position.set(pos.x, pos.y, pos.z);
    this.phys.updateMassProperties();
    game.world.addBody(this.phys);
    this.group.position.copy(pos);
    this.pos = this.group.position;
    this.spawnT = 0;
  }

  wake() {
    if (this.awake) return;
    this.awake = true; this.haloMat.color.set(0xff5a3a); this.baseEmis.set(0xb02a10);
    this.game.fx.impact(this.pos, _d.set(0, 1, 0), this.game.fx.cRed);
  }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.healFlash = 0.4; }

  /** Apply damage; returns true if this killed it. */
  damageBy(amount, dir) {
    this.hp -= amount;
    this.hitFlash = 0.13;
    this.kb.addScaledVector(dir, 5 / this.scale / (this.type.kbResist || 1));
    if (!this.awake) this.wake();
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  update(dt, player) {
    const T = this.type, ai = T.ai;
    this.age += dt; this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const p = this.phys.position;
    this.pos.set(p.x, p.y, p.z);

    // --- steering ---
    _t.set(player.x - p.x, 0, player.z - p.z);
    const distH = _t.length() || 0.001;
    _t.multiplyScalar(1 / distH);
    const dist3 = Math.hypot(distH, player.y - p.y);

    this.cooldown -= dt; this.stateT -= dt;
    let speedMul = 1, fwd = 1, side = null, wind = 0;
    const g = this.game;

    if (ai === 'sleeper' && !this.awake) {
      speedMul = 0.2;
      if (dist3 < 6) this.wake();
    }

    if (ai === 'melee' || ai === 'orbit' || ai === 'sleeper') {
      const windT = T.windup || 0.42, reach = T.reach || 2.8;
      if (ai === 'orbit') {
        this.orbitT -= dt; if (this.orbitT <= 0) { this.orbitDir *= -1; this.orbitT = rnd(1.5, 3); }
        side = distH > 4.2 ? this.orbitDir * 1.15 : this.orbitDir * 0.35;
      }
      if (this.state === 'chase') {
        if (this.awake && dist3 < reach + this.radius && this.cooldown <= 0) { this.state = 'windup'; this.stateT = windT; g.sfx.spawn(); }
      } else if (this.state === 'windup') {
        speedMul = 0.1; wind = Math.min(1, 1 - this.stateT / windT);
        if (this.stateT <= 0) { this.state = 'lunge'; this.stateT = 0.32; this.lungeHit = false; this.kb.addScaledVector(_t, T.lungeKick || 13); g.sfx.lunge(); }
      } else if (this.state === 'lunge') {
        speedMul = 0.5;
        if (!this.lungeHit && dist3 < this.radius + 1.0) { this.lungeHit = true; g.hurtPlayer(this.damage, this.pos); }
        if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.5; this.cooldown = 1.4 + Math.random() * 0.6; }
      } else if (this.state === 'recover') {
        speedMul = 0.35;
        if (this.stateT <= 0) this.state = 'chase';
      }
    } else if (ai === 'ranged' || ai === 'healer') {
      const lo = ai === 'ranged' ? 7 : 6, hi = ai === 'ranged' ? 11.5 : 9.5;
      if (distH < lo) { fwd = -1; side = this.orbitDir * 0.5; } else if (distH > hi) fwd = 1; else { fwd = 0; side = this.orbitDir * 0.8; }
      this.orbitT -= dt; if (this.orbitT <= 0) { this.orbitDir *= -1; this.orbitT = rnd(2, 4); }
      if (ai === 'ranged') {
        if (this.state === 'chase') {
          if (this.cooldown <= 0 && distH > 4 && distH < 18) { this.state = 'aim'; this.stateT = 0.6; }
        } else if (this.state === 'aim') {
          speedMul = 0.15; wind = Math.min(1, 1 - this.stateT / 0.6);
          if (this.stateT <= 0) { g.fireShot(this, player); this.state = 'recover'; this.stateT = 0.45; this.cooldown = (this.type.cd || 2.2) * (this.elite ? 1.5 : 1) * (0.9 + Math.random() * 0.4); }
        } else if (this.state === 'recover') {
          speedMul = 0.4; if (this.stateT <= 0) this.state = 'chase';
        }
      } else {
        this.pulseT -= dt; wind = Math.max(0, 1 - this.pulseT / 0.5) * (this.pulseT < 0.5 ? 1 : 0);
        if (this.pulseT <= 0) { this.pulseT = 2.6; g.healPulse(this); }
      }
    } else if (ai === 'kamikaze') {
      if (this.state === 'chase') {
        if (dist3 < 3.0 + this.radius) { this.state = 'fuse'; this.stateT = 0.5; g.sfx.fuse && g.sfx.fuse(); }
      } else if (this.state === 'fuse') {
        speedMul = 1.15; wind = Math.min(1, 1 - this.stateT / 0.5);
        if (this.stateT <= 0 && !this.dead) { g.detonate(this); return; }
      }
    }

    // if a pillar / crate is blocking the way, sidestep around it
    const hv = Math.hypot(this.phys.velocity.x, this.phys.velocity.z);
    if (this.state === 'chase' && fwd === 1 && distH > 3.5 && hv < this.speed * 0.3 * speedMul) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.35) { if (!this.sideDir) this.sideDir = Math.random() < 0.5 ? -1 : 1; } else if (this.stuckT === 0) this.sideDir = 0;
    // weave a little so the swarm doesn't line up
    let weave = this.sideDir ? this.sideDir * 1.3 : Math.sin(this.age * 1.4 + this.seed) * 0.55 * Math.min(1, distH / 8);
    if (side !== null && !this.sideDir) weave = side;
    const vx = (_t.x * this.speed * fwd + -_t.z * this.speed * weave) * speedMul;
    const vz = (_t.z * this.speed * fwd + _t.x * this.speed * weave) * speedMul;
    const baseY = Math.min(3.2, Math.max(1.1 * this.scale + 0.4, player.y - 0.35));
    const targetY = (T.hoverY ? Math.max(baseY, T.hoverY) : baseY) + Math.sin(this.age * 2.1 + this.seed) * 0.25;
    const vy = (targetY - p.y) * 2.6;

    this.kb.multiplyScalar(Math.exp(-5 * dt));
    this.phys.velocity.set(vx + this.kb.x, vy + this.kb.y, vz + this.kb.z);

    // --- visuals ---
    this.hitFlash = Math.max(0, this.hitFlash - dt); this.healFlash = Math.max(0, this.healFlash - dt);
    const f = this.hitFlash / 0.13;
    _c1.copy(this.baseEmis);
    if (this.healFlash > 0) _c1.lerp(_green, Math.min(1, this.healFlash / 0.2));
    if (this.state === 'fuse' && Math.sin(this.age * 45) > 0) _c1.lerp(_white, 0.85);
    _c1.r += f; _c1.g += f; _c1.b += f * 0.2;
    this.bodyMat.emissive.copy(_c1);
    this.bodyMat.emissiveIntensity = 0.65 + f * 1.6 + wind * 0.8 + (this.healFlash > 0 ? 0.6 : 0) + (ai === 'sleeper' && !this.awake ? -0.35 : 0);
    const squash = Math.sin(this.age * 6 + this.seed) * 0.045 * (ai === 'sleeper' && !this.awake ? 0.4 : 1);
    const sc = this.spawnT * (1 + wind * 0.28 + f * 0.12);
    this.group.scale.set(this.scale * sc * (1 - squash), this.scale * sc * (1 + squash), this.scale * sc * (1 - squash));
    if (wind > 0 && ai !== 'healer') this.group.position.x += (Math.random() - 0.5) * 0.05 * wind;
    this.smile.scale.set(1 + wind * 0.25, 1 + wind * 0.5, 1);
    this.haloMat.opacity = 0.18 + 0.08 * Math.sin(this.age * 4 + this.seed) + wind * 0.25 - (ai === 'sleeper' && !this.awake ? 0.12 : 0);

    // health bar
    const hf = Math.max(0, this.hp / this.maxHp);
    const show = this.elite || hf < 0.999;
    this.barBack.visible = this.barFront.visible = show;
    if (show) { this.barFront.scale.x = Math.max(0.001, 0.9 * hf); this.barFront.material.color.setHSL(0.02 + 0.3 * hf, 0.95, 0.55); }

    // face the player (smoothly)
    _o.position.copy(this.pos); _o.lookAt(player.x, player.y, player.z);
    this.group.quaternion.slerp(_o.quaternion, Math.min(1, dt * 9));

    // trail
    this.trailT -= dt;
    if (this.trailT <= 0) { this.trailT = 0.07; this.game.fx.trail(_d.copy(this.pos).addScaledVector(_t, -0.4 * this.scale), T.halo); }
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.game.world.removeBody(this.phys);
    this.bodyMat.dispose(); this.haloMat.dispose(); this.barFront.material.dispose();
  }
}
