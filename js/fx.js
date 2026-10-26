import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  GPU point-sprite particle system (soft round sprites, ring buffer) */
/* ------------------------------------------------------------------ */
const VERT = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor; uniform float uScale;
void main(){
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying float vAlpha; varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.02, d);
  gl_FragColor = vec4(vColor, vAlpha * a);
}`;

export class ParticleSystem {
  constructor(scene, { max = 1000, additive = true } = {}) {
    this.max = max; this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.uniforms = { uScale: { value: 800 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = g;
  }
  setScale(s) { this.uniforms.uScale.value = s; }

  /** o: {p:Vector3, v:Vector3, life, s0, s1, a0, c0:Color, c1:Color, grav, drag} */
  emit(o) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = o.p.x; this.pos[i3 + 1] = o.p.y; this.pos[i3 + 2] = o.p.z;
    this.vel[i3] = o.v.x; this.vel[i3 + 1] = o.v.y; this.vel[i3 + 2] = o.v.z;
    this.life[i] = this.maxLife[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1 ?? o.s0;
    this.a0[i] = o.a0 ?? 1;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0;
    const c0 = o.c0, c1 = o.c1 ?? o.c0;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      const i3 = i * 3;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * (1 - t * 0.2);
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/*  Effects: ready-made bursts built on two particle systems           */
/* ------------------------------------------------------------------ */
const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _p = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene; this.camera = null;                 // main.js assigns the camera (used to billboard rings)
    this.glow = new ParticleSystem(scene, { max: 4500, additive: true });
    this.smoke = new ParticleSystem(scene, { max: 900, additive: false });
    this._initKillFx(scene);
    this.cGold = new THREE.Color(1.0, 0.72, 0.2);
    this.cHot = new THREE.Color(1.0, 0.95, 0.7);
    this.cRed = new THREE.Color(0.9, 0.2, 0.05);
    this.cBlue = new THREE.Color(0.2, 0.55, 1.0);
    this.cBlueHi = new THREE.Color(0.7, 0.9, 1.0);
    this.cSmoke = new THREE.Color(0.55, 0.55, 0.58);
    this.cSmoke2 = new THREE.Color(0.85, 0.85, 0.88);
    this.cDust = new THREE.Color(0.75, 0.7, 0.6);
  }
  setScale(s) { this.glow.setScale(s); this.smoke.setScale(s); }
  update(dt) { this.glow.update(dt); this.smoke.update(dt); this._updateKillFx(dt); }

  /* ================================================================
     FALSITY KILL EFFECT
     white-hot flash -> shockwave rings + dome -> glowing blue/gold shards
     with comet trails -> bouncing crystal debris -> a frowning ghost of the
     smiley floats away -> floating score text. Streaks turn the sparks gold.
     ================================================================ */
  _initKillFx(scene) {
    this.sparks = []; this.debris = []; this.waves = []; this.ghosts = []; this.texts = new Map();
    this.floorY = 0;
    // pooled light so no shader recompiles happen mid-game
    this.killLight = new THREE.PointLight(0x5aa8ff, 0, 14, 2); this.killLight.position.set(0, -50, 0); scene.add(this.killLight);
    this.killLightT = 0; this.killLightMax = 0;
    this.shardGeos = [new THREE.TetrahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0)];
    this.shardMats = [
      new THREE.MeshStandardMaterial({ color: 0x2d86ff, emissive: 0x1a6bff, emissiveIntensity: 1.8, roughness: 0.18, metalness: 0.2, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x9fd2ff, emissive: 0x58b0ff, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.3, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xffa11c, emissiveIntensity: 2.0, roughness: 0.2, metalness: 0.4, flatShading: true }),
    ];
    this.ringGeo = new THREE.RingGeometry(0.88, 1, 64);
    this.domeGeo = new THREE.SphereGeometry(1, 28, 18);
    // sad ghost face
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 10, 64, 64, 62); rg.addColorStop(0, 'rgba(190,225,255,.95)'); rg.addColorStop(1, 'rgba(60,140,255,.0)');
    g.fillStyle = rg; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.strokeStyle = '#06204f'; g.fillStyle = '#06204f'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.ellipse(44, 54, 6, 11, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(84, 54, 6, 11, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(64, 98, 22, Math.PI * 1.15, Math.PI * 1.85); g.stroke();                       // frown
    this.ghostTex = new THREE.CanvasTexture(c); this.ghostTex.colorSpace = THREE.SRGBColorSpace;
  }
  _textTex(str) {
    let t = this.texts.get(str); if (t) return t;
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
    g.font = '900 54px "Segoe UI",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(8,20,60,.95)'; g.lineJoin = 'round'; g.strokeText(str, 128, 50);
    const gr = g.createLinearGradient(0, 20, 0, 80); gr.addColorStop(0, '#fff6c8'); gr.addColorStop(1, '#ffb81c');
    g.fillStyle = gr; g.fillText(str, 128, 50);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    if (this.texts.size > 40) this.texts.clear();
    this.texts.set(str, t); return t;
  }
  _ring(p, normal, speed, S, life, count = 56) {
    const n = normal.clone().normalize();
    const a = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, a).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
      _v.set(0, 0, 0).addScaledVector(u, cs * speed).addScaledVector(w, sn * speed);
      this.glow.emit({ p, v: _v, life, s0: 0.16 * S, s1: 0.02, a0: 1, c0: this.cHot, c1: this.cBlue, drag: 3.2 });
    }
  }

  /** @param p world position   @param o {elite, combo, text, scale} */
  kill(p, o = {}) {
    const big = !!o.elite, S = (big ? 1.9 : 1) * (o.scale || 1) * 0.9 + (big ? 0 : 0.1);
    const combo = Math.min(o.combo || 1, 12), gold = Math.min(0.65, combo * 0.07);

    // 1. white-hot core flash + soft bloom
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.14, s0: 1.6 * S, s1: 0.4 * S, a0: 1, c0: this.cHot, c1: this.cBlueHi });
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.45, s0: 0.8 * S, s1: 4.6 * S, a0: 0.75, c0: this.cBlueHi, c1: this.cBlue });
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.7, s0: 0.4 * S, s1: 7 * S, a0: 0.28, c0: this.cBlue, c1: this.cBlue });

    // 2. shockwave rings (particle rings in 3 planes + mesh rings + dome)
    this._ring(p, new THREE.Vector3(0, 1, 0), 10 * S, S, 0.55, 64);
    this._ring(p, new THREE.Vector3(rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1)), 8 * S, S, 0.5, 48);
    this._ring(p, new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)), 6.5 * S, S, 0.45, 40);
    const mkRing = (flat, maxS, life, col) => {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.copy(p); m.scale.setScalar(0.2); m.renderOrder = 11; this.scene.add(m);
      this.waves.push({ m, kind: flat ? 'flat' : 'bill', t: 0, life, s1: maxS });
    };
    mkRing(false, 3.6 * S, 0.45, 0xbfe3ff); mkRing(true, 5.2 * S, 0.6, 0x4aa8ff);
    const dome = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: 0x66b8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    dome.position.copy(p); dome.scale.setScalar(0.3); dome.renderOrder = 11; this.scene.add(dome);
    this.waves.push({ m: dome, kind: 'dome', t: 0, life: 0.38, s1: 2.6 * S });

    // 3. comet sparks (glowing streaks that bounce on the floor)
    const nS = big ? 56 : 30;
    for (let i = 0; i < nS; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize();
      const sp = rnd(5, 17) * (big ? 1.25 : 1);
      const col = Math.random() < gold ? this.cGold : (Math.random() < 0.35 ? this.cHot : this.cBlueHi);
      this.sparks.push({ p: p.clone(), v: d.multiplyScalar(sp), life: rnd(0.45, big ? 1.5 : 1.1), t: 0, col, size: rnd(0.07, 0.13) * (big ? 1.4 : 1), tr: 0 });
    }

    // 4. dense spherical goo / glitter burst
    const nG = big ? 150 : 80;
    for (let i = 0; i < nG; i++) {
      _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(1.5, 9) * (big ? 1.3 : 1));
      const hot = Math.random() < 0.3;
      this.glow.emit({ p, v: _v, life: rnd(0.35, 1.0), s0: rnd(0.05, 0.16) * S, s1: 0.01, a0: 1, c0: hot ? this.cHot : (Math.random() < gold ? this.cGold : this.cBlueHi), c1: this.cBlue, grav: rnd(2, 9), drag: 1.6 });
    }
    // 5. blue smoke puffs
    for (let i = 0; i < 9; i++) {
      _v.set(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).multiplyScalar(rnd(1, 3.2));
      this.smoke.emit({ p, v: _v, life: rnd(0.7, 1.3), s0: 0.12 * S, s1: rnd(0.7, 1.3) * S, a0: 0.4, c0: this.cBlue, c1: this.cSmoke, grav: -0.4, drag: 2.5 });
    }

    // 6. shattered crystal shell (real meshes: spin, fall, bounce, shrink)
    const nD = big ? 22 : 12;
    for (let i = 0; i < nD; i++) {
      const gi = (Math.random() * 3) | 0, mi = Math.random() < 0.15 + gold * 0.4 ? 2 : (Math.random() < 0.4 ? 1 : 0);
      const m = new THREE.Mesh(this.shardGeos[gi], this.shardMats[mi]);
      const sz = rnd(0.045, 0.1) * (big ? 1.6 : 1);
      m.scale.set(sz, sz * rnd(0.5, 1.4), sz * rnd(0.6, 1.3));
      m.position.copy(p).add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.25 * S));
      m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); m.frustumCulled = false; this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1.1), rnd(-1, 1)).normalize().multiplyScalar(rnd(3, 11)), w: new THREE.Vector3(rnd(-14, 14), rnd(-14, 14), rnd(-14, 14)), t: 0, life: rnd(1.1, 1.9), sz, base: m.scale.clone(), tr: 0 });
    }

    // 7. ghost of the smile: a frowning face drifts up and dissolves
    const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ghostTex, transparent: true, depthWrite: false, opacity: 0.95 }));
    gs.position.copy(p); gs.scale.setScalar(0.5 * S); gs.renderOrder = 12; this.scene.add(gs);
    this.ghosts.push({ s: gs, kind: 'ghost', t: 0, life: 1.15, s1: 1.25 * S, vy: 1.6, ph: Math.random() * 6 });

    // 8. floating score text
    if (o.text) {
      const ts = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._textTex(o.text), transparent: true, depthWrite: false, depthTest: false }));
      ts.position.copy(p); ts.position.y += 0.5 * S; ts.scale.set(0.01, 0.01, 1); ts.renderOrder = 30; this.scene.add(ts);
      this.ghosts.push({ s: ts, kind: 'text', t: 0, life: 1.0, s1: 1, vy: 1.4, ph: 0, w: 1.5 + 0.1 * combo });
    }

    // 9. dynamic light pop
    this.killLight.position.copy(p); this.killLightT = this.killLightMax = big ? 0.55 : 0.32;
    this.killLight.color.set(gold > 0.3 ? 0xffc060 : 0x5aa8ff);
  }

  _updateKillFx(dt) {
    if (dt <= 0) return;
    const fy = this.floorY;
    // comet sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.t += dt;
      if (s.t >= s.life) { this.sparks.splice(i, 1); continue; }
      s.v.y -= 9 * dt; s.v.multiplyScalar(Math.max(0, 1 - 0.9 * dt));
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < fy + 0.05) {
        s.p.y = fy + 0.05;
        if (Math.abs(s.v.y) > 2) this.glow.emit({ p: s.p, v: _v.set(rnd(-1, 1), rnd(1, 3), rnd(-1, 1)), life: 0.25, s0: 0.05, s1: 0.01, a0: 1, c0: this.cHot, c1: s.col, grav: 12 });
        s.v.y *= -0.5; s.v.x *= 0.7; s.v.z *= 0.7;
      }
      const k = 1 - s.t / s.life;
      s.tr -= dt;
      if (s.tr <= 0) { s.tr = 0.012; this.glow.emit({ p: s.p, v: _v.set(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), life: 0.28 + 0.2 * k, s0: s.size * (0.6 + k), s1: 0.0, a0: 0.9, c0: this.cHot, c1: s.col }); }
    }
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (d.t >= d.life) { this.scene.remove(d.m); this.debris.splice(i, 1); continue; }
      d.v.y -= 15 * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.m.position.y < fy + d.sz) { d.m.position.y = fy + d.sz; d.v.y *= -0.45; d.v.x *= 0.65; d.v.z *= 0.65; d.w.multiplyScalar(0.7); }
      const fade = d.life - d.t < 0.45 ? (d.life - d.t) / 0.45 : 1;
      d.m.scale.copy(d.base).multiplyScalar(fade);
      d.tr -= dt; if (d.tr <= 0 && d.t < 0.7) { d.tr = 0.03; this.glow.emit({ p: d.m.position, v: _v.set(0, 0, 0), life: 0.3, s0: 0.07, s1: 0.0, a0: 0.8, c0: this.cBlueHi, c1: this.cBlue }); }
    }
    // shockwaves
    const cq = this.camera ? this.camera.quaternion : null;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.t += dt; const u = w.t / w.life;
      if (u >= 1) { this.scene.remove(w.m); w.m.material.dispose(); this.waves.splice(i, 1); continue; }
      const e = 1 - (1 - u) * (1 - u) * (1 - u);              // ease-out cubic
      w.m.scale.setScalar(0.2 + (w.s1 - 0.2) * e);
      w.m.material.opacity = (w.kind === 'dome' ? 0.55 : 0.9) * (1 - u) * (1 - u);
      if (w.kind === 'bill' && cq) w.m.quaternion.copy(cq); else if (w.kind === 'flat') w.m.rotation.set(-Math.PI / 2, 0, 0);
    }
    // ghosts + text
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]; g.t += dt; const u = g.t / g.life;
      if (u >= 1) { this.scene.remove(g.s); g.s.material.dispose(); this.ghosts.splice(i, 1); continue; }
      g.s.position.y += g.vy * dt * (1 - u * 0.6);
      if (g.kind === 'ghost') {
        g.s.position.x += Math.sin(g.t * 7 + g.ph) * 0.4 * dt;
        g.s.scale.setScalar(0.5 + (g.s1 - 0.5) * Math.min(1, u * 2));
        g.s.material.opacity = 0.95 * (1 - u) * (1 - u); g.s.material.rotation = Math.sin(g.t * 5 + g.ph) * 0.25;
      } else {
        const pop = u < 0.12 ? u / 0.12 : 1, over = 1 + 0.35 * Math.max(0, 1 - u / 0.2);
        g.s.scale.set(g.w * 0.55 * pop * over, g.w * 0.2 * pop * over, 1); g.s.material.opacity = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1;
      }
    }
    // light
    if (this.killLightT > 0) { this.killLightT -= dt; const k = Math.max(0, this.killLightT / this.killLightMax); this.killLight.intensity = 14 * k * k; } else this.killLight.intensity = 0;
  }

  /** Dust + sparks kicked up by a sliding player. p = feet, dir = travel direction (unit, horizontal). */
  slide(p, dir, strength = 1) {
    for (let i = 0; i < 2; i++) {
      _v.set(rnd(-1, 1), rnd(0.2, 1.2), rnd(-1, 1)).multiplyScalar(0.8).addScaledVector(dir, -rnd(1, 3) * strength);
      _p.copy(p).addScaledVector(dir, -0.2);
      this.smoke.emit({ p: _p, v: _v, life: rnd(0.4, 0.8), s0: 0.08, s1: rnd(0.35, 0.65), a0: 0.35, c0: this.cDust, c1: this.cSmoke, grav: -0.2, drag: 2.5 });
    }
    for (let i = 0; i < 3; i++) {
      _v.set(rnd(-1, 1), rnd(0.5, 2.5), rnd(-1, 1)).multiplyScalar(1.2).addScaledVector(dir, -rnd(2, 6) * strength);
      this.glow.emit({ p, v: _v, life: rnd(0.15, 0.35), s0: 0.03, s1: 0.005, a0: 1, c0: this.cHot, c1: this.cGold, grav: 12, drag: 0.5 });
    }
  }
  /** Burst when a slide is cancelled (pop out of it). */
  slideCancel(p, dir) {
    for (let i = 0; i < 18; i++) {
      _v.set(rnd(-1, 1), rnd(0.2, 1.5), rnd(-1, 1)).multiplyScalar(2.2).addScaledVector(dir, rnd(-4, 1));
      this.glow.emit({ p, v: _v, life: rnd(0.2, 0.45), s0: 0.05, s1: 0.01, a0: 1, c0: this.cHot, c1: this.cBlueHi, grav: 6, drag: 1.5 });
    }
    this._ring(p, new THREE.Vector3(0, 1, 0), 5, 0.7, 0.35, 28);
  }

  /** Muzzle blast at world position `p` firing along `dir`. */
  muzzle(p, dir) {
    for (let i = 0; i < 14; i++) {
      _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(2.2).addScaledVector(dir, rnd(8, 22));
      this.glow.emit({ p, v: _v, life: rnd(0.08, 0.22), s0: rnd(0.025, 0.05), s1: 0.005, a0: 1, c0: this.cHot, c1: this.cRed, grav: 8, drag: 2 });
    }
    for (let i = 0; i < 3; i++) {
      _v.set(rnd(-0.6, 0.6), rnd(-0.2, 0.9), rnd(-0.6, 0.6)).addScaledVector(dir, rnd(1.5, 4));
      this.smoke.emit({ p, v: _v, life: rnd(0.5, 0.9), s0: 0.05, s1: rnd(0.35, 0.6), a0: 0.28, c0: this.cSmoke2, c1: this.cSmoke, grav: -0.8, drag: 3 });
    }
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.05, s0: 0.45, s1: 0.2, a0: 0.9, c0: this.cHot, c1: this.cGold });
  }

  /** Bullet hit on a surface. */
  impact(p, n, color) {
    const c = color || this.cGold;
    for (let i = 0; i < 12; i++) {
      _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(2.5).addScaledVector(n, rnd(3, 8));
      this.glow.emit({ p, v: _v, life: rnd(0.2, 0.5), s0: rnd(0.02, 0.04), s1: 0.005, a0: 1, c0: this.cHot, c1: c, grav: 14, drag: 0.8 });
    }
    for (let i = 0; i < 4; i++) {
      _v.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).multiplyScalar(0.7).addScaledVector(n, rnd(0.6, 1.6));
      this.smoke.emit({ p, v: _v, life: rnd(0.5, 1.0), s0: 0.08, s1: rnd(0.3, 0.55), a0: 0.4, c0: this.cDust, c1: this.cSmoke, grav: -0.3, drag: 3 });
    }
  }

  /** Blue goo burst when a Falsity is hit / killed. */
  enemy(p, dir, count = 14, big = false) {
    for (let i = 0; i < count; i++) {
      _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(big ? 7 : 3).addScaledVector(dir, big ? 0 : rnd(2, 5));
      this.glow.emit({ p, v: _v, life: rnd(0.3, big ? 0.9 : 0.55), s0: rnd(0.06, big ? 0.2 : 0.1), s1: 0.01, a0: 1, c0: this.cBlueHi, c1: this.cBlue, grav: big ? 6 : 10, drag: 1.2 });
    }
    if (big) {
      for (let i = 0; i < 24; i++) {
        _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(4, 11));
        this.glow.emit({ p, v: _v, life: rnd(0.4, 0.8), s0: 0.05, s1: 0.01, a0: 1, c0: this.cHot, c1: this.cBlue, grav: 3, drag: 2 });
      }
      this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.25, s0: 0.8, s1: 3.2, a0: 0.5, c0: this.cBlueHi, c1: this.cBlue });
    }
  }

  /** Expanding ring when an enemy materialises. */
  spawn(p) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      _v.set(Math.cos(a) * 3.5, rnd(-0.5, 1.5), Math.sin(a) * 3.5);
      this.glow.emit({ p, v: _v, life: 0.55, s0: 0.1, s1: 0.02, a0: 1, c0: this.cBlueHi, c1: this.cBlue, drag: 3 });
    }
  }

  /** Little blue trail behind a flying Falsity. */
  trail(p, hex) {
    _v.set(rnd(-0.3, 0.3), rnd(-0.3, 0.1), rnd(-0.3, 0.3));
    let c = this.cBlue;
    if (hex !== undefined) { this._tc = this._tc || new Map(); c = this._tc.get(hex); if (!c) { c = new THREE.Color(hex); this._tc.set(hex, c); } }
    this.glow.emit({ p, v: _v, life: 0.4, s0: 0.12, s1: 0.0, a0: 0.45, c0: c, c1: c });
  }

  /* ---------- helpers for the new enemy types ---------- */
  _meshRing(p, flat, maxS, life, col) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(p); m.scale.setScalar(0.2); m.renderOrder = 11; this.scene.add(m);
    this.waves.push({ m, kind: flat ? 'flat' : 'bill', t: 0, life, s1: maxS });
  }
  /** Fiery blast (Mineity detonation). R = damage radius. */
  explosion(p, R = 3.4) {
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.16, s0: 2.2 * R, s1: 0.6 * R, a0: 1, c0: this.cHot, c1: this.cGold });
    this.glow.emit({ p, v: _v.set(0, 0, 0), life: 0.5, s0: 1.0 * R, s1: 3.2 * R, a0: 0.7, c0: this.cGold, c1: this.cRed });
    for (let i = 0; i < 90; i++) {
      _v.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(3, 15));
      this.glow.emit({ p, v: _v, life: rnd(0.3, 0.9), s0: rnd(0.08, 0.22), s1: 0.01, a0: 1, c0: Math.random() < 0.4 ? this.cHot : this.cGold, c1: this.cRed, grav: rnd(2, 10), drag: 1.5 });
    }
    for (let i = 0; i < 16; i++) {
      _v.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).multiplyScalar(rnd(1.5, 5));
      this.smoke.emit({ p, v: _v, life: rnd(0.8, 1.6), s0: 0.2, s1: rnd(1.0, 1.8), a0: 0.55, c0: this.cSmoke, c1: this.cSmoke, grav: -0.6, drag: 2 });
    }
    this._ring(p, new THREE.Vector3(0, 1, 0), 12, 1.2, 0.5, 64);
    this._meshRing(p, true, R * 1.5, 0.5, 0xff9a30); this._meshRing(p, false, R * 1.2, 0.4, 0xffe0a0);
    const dome = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    dome.position.copy(p); dome.scale.setScalar(0.3); dome.renderOrder = 11; this.scene.add(dome);
    this.waves.push({ m: dome, kind: 'dome', t: 0, life: 0.4, s1: R });
    this.killLight.position.copy(p); this.killLightT = this.killLightMax = 0.6; this.killLight.color.set(0xff9a40);
  }
  /** Healing pulse radiating from a Helpity. */
  healPulse(p, R = 7) {
    this._ring(p, new THREE.Vector3(0, 1, 0), R * 1.7, 0.8, 0.6, 48);
    this._meshRing(p, true, R, 0.6, 0x5affa0);
  }
  /** Sparkles on an enemy that just got healed. */
  heal(p) {
    if (!this.cGreen) this.cGreen = new THREE.Color(0.3, 1, 0.55);
    for (let i = 0; i < 10; i++) {
      _v.set(rnd(-0.5, 0.5), rnd(1, 2.4), rnd(-0.5, 0.5));
      _p.set(p.x + rnd(-0.4, 0.4), p.y + rnd(-0.2, 0.3), p.z + rnd(-0.4, 0.4));
      this.glow.emit({ p: _p, v: _v, life: rnd(0.5, 0.9), s0: 0.09, s1: 0.02, a0: 1, c0: this.cHot, c1: this.cGreen, drag: 1 });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Procedural sound effects (no audio files)                          */
/* ------------------------------------------------------------------ */
export class Sfx {
  constructor() { this.ctx = null; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.nbuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  _noise(dur, { type = 'lowpass', f0 = 1000, f1 = f0, q = 0.7, gain = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.nbuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  _tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.1, gain = 0.5, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  shot() {
    this._noise(0.05, { type: 'highpass', f0: 3500, gain: 0.55 });
    this._noise(0.2, { type: 'bandpass', f0: 3200, f1: 500, q: 0.8, gain: 0.9 });
    this._noise(0.32, { type: 'lowpass', f0: 900, f1: 120, gain: 0.8 });
    this._tone({ type: 'sine', f0: 150, f1: 42, dur: 0.16, gain: 0.9 });
  }
  empty() { this._noise(0.03, { type: 'highpass', f0: 2500, gain: 0.5 }); }
  click() { this._noise(0.035, { type: 'highpass', f0: 2200, gain: 0.45 }); this._tone({ type: 'square', f0: 900, f1: 400, dur: 0.03, gain: 0.08 }); }
  slide() { this._noise(0.14, { type: 'bandpass', f0: 1200, f1: 2600, q: 2, gain: 0.45 }); this._noise(0.05, { type: 'highpass', f0: 3000, gain: 0.4, delay: 0.13 }); }
  magOut() { this._noise(0.09, { type: 'bandpass', f0: 900, f1: 500, q: 2, gain: 0.55 }); this._tone({ type: 'triangle', f0: 220, f1: 120, dur: 0.08, gain: 0.25 }); }
  magIn() { this._noise(0.06, { type: 'bandpass', f0: 600, f1: 1400, q: 2, gain: 0.7 }); this._tone({ type: 'triangle', f0: 180, f1: 90, dur: 0.1, gain: 0.5 }); }
  hit() { this._tone({ type: 'sine', f0: 620, f1: 340, dur: 0.07, gain: 0.35 }); this._noise(0.05, { type: 'highpass', f0: 4000, gain: 0.3 }); }
  kill(combo = 1, elite = false) {
    const k = Math.min(combo, 12), pitch = Math.pow(1.0595, k * 1.5);           // each streak kill climbs the scale
    // glass shatter + whoosh
    this._noise(0.32, { type: 'highpass', f0: 6500, f1: 2200, gain: 0.55 });
    this._noise(0.22, { type: 'bandpass', f0: 3200, f1: 700, q: 1.2, gain: 0.6 });
    // upward zap
    this._tone({ type: 'sawtooth', f0: 240 * pitch, f1: 1500 * pitch, dur: 0.14, gain: 0.16 });
    // crystalline bell chord
    [1, 1.5, 2, 3].forEach((m, i) => this._tone({ type: i % 2 ? 'sine' : 'triangle', f0: 660 * pitch * m, f1: 660 * pitch * m * 0.99, dur: 0.5 + 0.1 * i, gain: 0.16 / (1 + i * 0.5), delay: 0.02 + i * 0.028 }));
    // sub boom
    this._tone({ type: 'sine', f0: elite ? 140 : 120, f1: 34, dur: elite ? 0.9 : 0.4, gain: elite ? 1.1 : 0.85 });
    this._noise(elite ? 0.8 : 0.3, { type: 'lowpass', f0: 1100, f1: 60, gain: elite ? 0.9 : 0.55 });
    // falling glitter
    for (let i = 0; i < 5; i++) this._tone({ type: 'sine', f0: 2600 + Math.random() * 2400, f1: 1800, dur: 0.07, gain: 0.07, delay: 0.1 + i * 0.05 + Math.random() * 0.03 });
    if (elite) { this._tone({ type: 'sawtooth', f0: 520, f1: 55, dur: 0.8, gain: 0.25, delay: 0.04 }); [0, 0.12, 0.24].forEach((d, i) => this._tone({ type: 'triangle', f0: 880 * [1, 1.25, 1.5][i], dur: 0.6, gain: 0.18, delay: 0.2 + d })); }
  }
  boom() { this._tone({ type: 'sine', f0: 150, f1: 28, dur: 0.9, gain: 1.2 }); this._noise(0.8, { type: 'lowpass', f0: 1800, f1: 60, gain: 1.0 }); this._noise(0.25, { type: 'highpass', f0: 3000, f1: 800, gain: 0.5 }); }
  fuse() { for (let i = 0; i < 5; i++) this._tone({ type: 'square', f0: 900 + i * 120, f1: 900 + i * 120, dur: 0.05, gain: 0.08, delay: i * 0.1 }); }
  orb() { this._tone({ type: 'sine', f0: 700, f1: 260, dur: 0.25, gain: 0.25 }); this._noise(0.2, { type: 'bandpass', f0: 1800, f1: 600, q: 2, gain: 0.25 }); }
  heal() { [0, 1, 2].forEach(i => this._tone({ type: 'sine', f0: 600 * [1, 1.26, 1.5][i], dur: 0.25, gain: 0.07, delay: i * 0.06 })); }
  discover() { [0, 0.1, 0.2, 0.34].forEach((d, i) => this._tone({ type: 'triangle', f0: 523 * [1, 1.25, 1.5, 2][i], dur: 0.35, gain: 0.2, delay: d })); this._noise(0.4, { type: 'bandpass', f0: 500, f1: 3000, q: 1, gain: 0.25 }); }
  buy() { this._tone({ type: 'square', f0: 1318, dur: 0.07, gain: 0.12 }); this._tone({ type: 'square', f0: 1760, dur: 0.18, gain: 0.12, delay: 0.07 }); this._noise(0.06, { type: 'highpass', f0: 5000, gain: 0.3 }); }
  deny() { this._tone({ type: 'sawtooth', f0: 180, f1: 110, dur: 0.18, gain: 0.2 }); }
  shop() { this._tone({ type: 'triangle', f0: 440, f1: 880, dur: 0.15, gain: 0.2 }); this._noise(0.1, { type: 'bandpass', f0: 2000, q: 2, gain: 0.2 }); }
  slideStart() { this._noise(0.45, { type: 'bandpass', f0: 250, f1: 1700, q: 1.2, gain: 0.55 }); this._noise(0.25, { type: 'lowpass', f0: 700, f1: 120, gain: 0.5 }); }
  scrape(v = 1) { this._noise(0.075, { type: 'bandpass', f0: 900 + 500 * v, f1: 500, q: 0.9, gain: 0.07 + 0.08 * v }); }
  slideCancel() { this._noise(0.14, { type: 'bandpass', f0: 2800, f1: 900, q: 1.3, gain: 0.5 }); this._tone({ type: 'triangle', f0: 380, f1: 900, dur: 0.1, gain: 0.18 }); this._noise(0.1, { type: 'lowpass', f0: 500, f1: 120, gain: 0.35 }); }
  hurt() { this._noise(0.28, { type: 'lowpass', f0: 500, f1: 90, gain: 1.0 }); this._tone({ type: 'sawtooth', f0: 110, f1: 45, dur: 0.25, gain: 0.35 }); }
  spawn() { this._tone({ type: 'sine', f0: 180, f1: 700, dur: 0.22, gain: 0.12 }); }
  lunge() { this._noise(0.2, { type: 'bandpass', f0: 400, f1: 1800, q: 1.5, gain: 0.3 }); }
  step(v = 1) { this._noise(0.07, { type: 'lowpass', f0: 600, f1: 200, gain: 0.18 * v }); }
  land() { this._noise(0.12, { type: 'lowpass', f0: 500, f1: 100, gain: 0.4 }); }
  wave() { [0, 0.12, 0.24].forEach((d, i) => this._tone({ type: 'triangle', f0: 440 * [1, 1.25, 1.5][i], f1: 440 * [1, 1.25, 1.5][i], dur: 0.3, gain: 0.18, delay: d })); }
  die() { this._tone({ type: 'sawtooth', f0: 300, f1: 40, dur: 1.2, gain: 0.35 }); this._noise(1.0, { type: 'lowpass', f0: 1200, f1: 60, gain: 0.7 }); }
}
