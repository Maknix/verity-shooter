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
    this.glow = new ParticleSystem(scene, { max: 1400, additive: true });
    this.smoke = new ParticleSystem(scene, { max: 500, additive: false });
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
  update(dt) { this.glow.update(dt); this.smoke.update(dt); }

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
  trail(p) {
    _v.set(rnd(-0.3, 0.3), rnd(-0.3, 0.1), rnd(-0.3, 0.3));
    this.glow.emit({ p, v: _v, life: 0.4, s0: 0.12, s1: 0.0, a0: 0.45, c0: this.cBlue, c1: this.cBlue });
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
  kill() {
    this._tone({ type: 'sine', f0: 260, f1: 1100, dur: 0.13, gain: 0.5 });
    this._noise(0.16, { type: 'bandpass', f0: 2500, f1: 800, q: 1, gain: 0.5 });
    this._tone({ type: 'triangle', f0: 90, f1: 40, dur: 0.2, gain: 0.5 });
  }
  hurt() { this._noise(0.28, { type: 'lowpass', f0: 500, f1: 90, gain: 1.0 }); this._tone({ type: 'sawtooth', f0: 110, f1: 45, dur: 0.25, gain: 0.35 }); }
  spawn() { this._tone({ type: 'sine', f0: 180, f1: 700, dur: 0.22, gain: 0.12 }); }
  lunge() { this._noise(0.2, { type: 'bandpass', f0: 400, f1: 1800, q: 1.5, gain: 0.3 }); }
  step(v = 1) { this._noise(0.07, { type: 'lowpass', f0: 600, f1: 200, gain: 0.18 * v }); }
  land() { this._noise(0.12, { type: 'lowpass', f0: 500, f1: 100, gain: 0.4 }); }
  wave() { [0, 0.12, 0.24].forEach((d, i) => this._tone({ type: 'triangle', f0: 440 * [1, 1.25, 1.5][i], f1: 440 * [1, 1.25, 1.5][i], dur: 0.3, gain: 0.18, delay: d })); }
  die() { this._tone({ type: 'sawtooth', f0: 300, f1: 40, dur: 1.2, gain: 0.35 }); this._noise(1.0, { type: 'lowpass', f0: 1200, f1: 60, gain: 0.7 }); }
}
