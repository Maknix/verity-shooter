import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from './world.js';

/* Falsity: a floating blue smiley sphere that hunts the player. */

let GEO = null;
function geo() {
  if (GEO) return GEO;
  GEO = {
    body: new THREE.SphereGeometry(0.6, 32, 24),
    halo: new THREE.SphereGeometry(0.72, 24, 16),
    unit: new THREE.SphereGeometry(1, 14, 10),
  };
  return GEO;
}
const DARK = new THREE.MeshBasicMaterial({ color: 0x04122e });
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });

/** Place `mesh` on a sphere of radius r at (yaw, pitch), facing outward (+Z local). */
function onSphere(mesh, yaw, pitch, r) {
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  mesh.position.copy(d).multiplyScalar(r);
  mesh.lookAt(d.multiplyScalar(r * 2));
}

const _q = new THREE.Quaternion(), _o = new THREE.Object3D(), _t = new THREE.Vector3(), _d = new THREE.Vector3();

export class Falsity {
  constructor(game, pos, { scale = 1, hp = 60, speed = 3.4, damage = 12, elite = false } = {}) {
    this.game = game; this.scale = scale; this.elite = elite;
    this.radius = 0.6 * scale;
    this.maxHp = this.hp = hp; this.speed = speed; this.damage = damage;
    this.dead = false;
    this.seed = Math.random() * 100;
    this.age = 0;
    this.state = 'chase'; this.stateT = 0; this.cooldown = 1 + Math.random();
    this.hitFlash = 0; this.kb = new THREE.Vector3(); this.lungeHit = false;
    this.trailT = 0; this.stuckT = 0; this.sideDir = 0;

    const g = geo();
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: elite ? 0x1a5bff : 0x2d86ff, roughness: 0.22, metalness: 0.05, emissive: 0x0b3fd6, emissiveIntensity: 0.65 });
    this.body = new THREE.Mesh(g.body, this.bodyMat);
    this.body.castShadow = true;
    this.group.add(this.body);
    this.halo = new THREE.Mesh(g.halo, new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.2, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.halo);

    // face (built on the +Z side of the sphere)
    this.face = new THREE.Group(); this.body.add(this.face);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(g.unit, DARK);
      onSphere(eye, sx * 0.4, 0.2, 0.585); eye.scale.set(0.075, 0.13, 0.04); this.face.add(eye);
      const sp = new THREE.Mesh(g.unit, WHITE);   // eye sparkle (child of the squashed eye ellipsoid)
      sp.position.set(0.3, 0.38, 0.85); sp.scale.set(0.26, 0.2, 0.2); eye.add(sp);
    }
    const N = 15;
    this.smile = new THREE.Group(); this.face.add(this.smile);
    for (let i = 0; i < N; i++) {
      const u = (i / (N - 1)) * 2 - 1;
      const b = new THREE.Mesh(g.unit, DARK);
      onSphere(b, u * 0.62, -0.5 + 0.32 * u * u, 0.592);
      const r = 0.048 - 0.014 * Math.abs(u) ** 2;
      b.scale.set(r, r, r * 0.6); this.smile.add(b);
    }

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

  /** Apply damage; returns true if this killed it. */
  damageBy(amount, dir) {
    this.hp -= amount;
    this.hitFlash = 0.13;
    this.kb.addScaledVector(dir, 5 / this.scale);
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  update(dt, player) {
    this.age += dt; this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const p = this.phys.position;
    this.pos.set(p.x, p.y, p.z);

    // --- steering ---
    _t.set(player.x - p.x, 0, player.z - p.z);
    const distH = _t.length() || 0.001;
    _t.multiplyScalar(1 / distH);
    const dist3 = Math.hypot(distH, player.y - p.y);

    this.cooldown -= dt; this.stateT -= dt;
    let speedMul = 1;
    if (this.state === 'chase') {
      if (dist3 < 2.8 + this.radius && this.cooldown <= 0) { this.state = 'windup'; this.stateT = 0.42; this.game.sfx.spawn(); }
    } else if (this.state === 'windup') {
      speedMul = 0.1;
      if (this.stateT <= 0) { this.state = 'lunge'; this.stateT = 0.32; this.lungeHit = false; this.kb.addScaledVector(_t, 13); this.game.sfx.lunge(); }
    } else if (this.state === 'lunge') {
      speedMul = 0.5;
      if (!this.lungeHit && dist3 < this.radius + 1.0) { this.lungeHit = true; this.game.hurtPlayer(this.damage, this.pos); }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.5; this.cooldown = 1.4 + Math.random() * 0.6; }
    } else if (this.state === 'recover') {
      speedMul = 0.35;
      if (this.stateT <= 0) this.state = 'chase';
    }

    // if a pillar / crate is blocking the way, sidestep around it
    const hv = Math.hypot(this.phys.velocity.x, this.phys.velocity.z);
    if (this.state === 'chase' && distH > 3.5 && hv < this.speed * 0.3) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.35) { if (!this.sideDir) this.sideDir = Math.random() < 0.5 ? -1 : 1; } else if (this.stuckT === 0) this.sideDir = 0;
    // weave a little so the swarm doesn't line up
    const weave = this.sideDir ? this.sideDir * 1.3 : Math.sin(this.age * 1.4 + this.seed) * 0.55 * Math.min(1, distH / 8);
    const vx = (_t.x * this.speed + -_t.z * this.speed * weave) * speedMul;
    const vz = (_t.z * this.speed + _t.x * this.speed * weave) * speedMul;
    const targetY = Math.min(3.2, Math.max(1.1 * this.scale + 0.4, player.y - 0.35)) + Math.sin(this.age * 2.1 + this.seed) * 0.25;
    const vy = (targetY - p.y) * 2.6;

    this.kb.multiplyScalar(Math.exp(-5 * dt));
    this.phys.velocity.set(vx + this.kb.x, vy + this.kb.y, vz + this.kb.z);

    // --- visuals ---
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const f = this.hitFlash / 0.13;
    this.bodyMat.emissive.setRGB(0.04 + f, 0.25 + f, 0.84 + f * 0.2);
    this.bodyMat.emissiveIntensity = 0.65 + f * 1.6;
    const wind = this.state === 'windup' ? Math.min(1, 1 - this.stateT / 0.42) : 0;
    const squash = Math.sin(this.age * 6 + this.seed) * 0.045;
    const sc = this.spawnT * (1 + wind * 0.28 + f * 0.12);
    this.group.scale.set(this.scale * sc * (1 - squash), this.scale * sc * (1 + squash), this.scale * sc * (1 - squash));
    if (wind > 0) this.group.position.x += (Math.random() - 0.5) * 0.05 * wind;
    this.smile.scale.set(1 + wind * 0.25, 1 + wind * 0.5, 1);
    this.halo.material.opacity = 0.18 + 0.08 * Math.sin(this.age * 4 + this.seed) + wind * 0.25;

    // face the player (smoothly)
    _o.position.copy(this.pos); _o.lookAt(player.x, player.y, player.z);
    this.group.quaternion.slerp(_o.quaternion, Math.min(1, dt * 9));

    // trail
    this.trailT -= dt;
    if (this.trailT <= 0) { this.trailT = 0.07; this.game.fx.trail(_d.copy(this.pos).addScaledVector(_t, -0.4 * this.scale)); }
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.game.world.removeBody(this.phys);
    this.bodyMat.dispose(); this.halo.material.dispose();
  }
}
