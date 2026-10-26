import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const GROUP = { WORLD: 1, PLAYER: 2, ENEMY: 4, DEBRIS: 8 };
export const ARENA = 42; // half-size of the arena

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  world.allowSleep = false;
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.35;
  world.defaultContactMaterial.restitution = 0.05;
  const solid = new CANNON.Material('solid');
  const slippery = new CANNON.Material('slippery');
  const bouncy = new CANNON.Material('bouncy');
  world.addContactMaterial(new CANNON.ContactMaterial(slippery, solid, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(slippery, slippery, { friction: 0, restitution: 0.2 }));
  world.addContactMaterial(new CANNON.ContactMaterial(bouncy, solid, { friction: 0.4, restitution: 0.45 }));
  return { world, mats: { solid, slippery, bouncy } };
}

/* ====================================================================
   VERITY PARK
   N-S + E-W cobble paths cross in a rainbow plaza (spawn). Fountain and
   rainbow arch up north, supply station in a hedge alcove to the west,
   gazebo (NE), pond (SW), playground (SE), flower beds, benches, lamps,
   trees, hedges. Everything is generated from code - no extra assets.
   ==================================================================== */
export function buildWorld(scene, world, mats) {
  const rayTargets = [];     // meshes bullets can hit
  const crates = [];         // dynamic, pushable
  const anim = [];           // per-frame animators (t seconds, dt)
  const H = ARENA;
  const R = mulberry(20260);
  const rr = (a, b) => a + R() * (b - a);
  const RAINBOW = ['#ff3b4e', '#ff7a1c', '#ffc81c', '#3ccf5a', '#2d86ff', '#4a5cff', '#a04cff'];

  /* ----- sky + fog ----- */
  const sky = canvasTex(512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#4f93ff'); gr.addColorStop(0.45, '#b7dcff'); gr.addColorStop(0.5, '#e8f4ff'); gr.addColorStop(1, '#cfe3c4');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  scene.fog = new THREE.Fog(0xd6e8f5, 48, 150);

  /* ----- lights ----- */
  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x8aa070, 1.05));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sun.position.set(22, 42, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -H - 4, right: H + 4, top: H + 4, bottom: -H - 4, near: 1, far: 130 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);

  /* ----- textures ----- */
  const grassTex = canvasTex(512, (g, s) => {
    g.fillStyle = '#69b044'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { const x = R() * s, y = R() * s, r = 30 + R() * 70, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, R() < 0.5 ? 'rgba(40,110,40,.22)' : 'rgba(150,210,90,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `hsl(${88 + R() * 30},${45 + R() * 25}%,${32 + R() * 26}%)`; g.fillRect(R() * s, R() * s, 2, 4 + R() * 6); }
  }, [H * 2 / 8, H * 2 / 8]);
  const cobbleTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#8e7f66'; g.fillRect(0, 0, s, s);
    const n = 8, w = s / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * w + (r % 2 ? w / 2 : 0) - w / 2, y = r * w;
      for (const dx of [0, s]) { g.fillStyle = `hsl(${32 + R() * 10},${22 + R() * 12}%,${66 + R() * 14}%)`; g.beginPath(); g.roundRect(x + dx + 2, y + 2, w - 4, w - 4, 6); g.fill(); }
    }
  });
  const hedgeTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#2f6b2a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) { g.fillStyle = R() < 0.5 ? '#3f8a35' : '#235a22'; g.beginPath(); g.arc(R() * s, R() * s, 3 + R() * 8, 0, 7); g.fill(); }
  });
  const barkTex = canvasTex(128, (g, s) => { g.fillStyle = '#6b4a2b'; g.fillRect(0, 0, s, s); for (let i = 0; i < 60; i++) { g.fillStyle = R() < 0.5 ? '#573b20' : '#7d5a37'; g.fillRect(R() * s, 0, 2 + R() * 4, s); } }, [1, 2]);
  const woodTex = canvasTex(128, (g, s) => { g.fillStyle = '#b07a3f'; g.fillRect(0, 0, s, s); for (let i = 0; i < 40; i++) { g.strokeStyle = R() < 0.5 ? '#946027' : '#c28e50'; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(0, R() * s); g.lineTo(s, R() * s); g.stroke(); } });
  const waterTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#2f93e6'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 3;
    for (let i = 0; i < 14; i++) { g.beginPath(); const y = R() * s; g.moveTo(0, y); for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x / 20 + i) * 6); g.stroke(); }
  });
  const stoneTex = canvasTex(128, (g, s) => { g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, s, s); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '90,80,60' : '255,255,255'},${0.05 + R() * 0.1})`; g.fillRect(R() * s, R() * s, 2 + R() * 6, 2 + R() * 6); } });

  const M = {
    grass: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }),
    bark: new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.75 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.4, metalness: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.25, metalness: 0.9, emissive: 0x5a3a00, emissiveIntensity: 0.4 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf7f2e8, roughness: 0.5 }),
    water: new THREE.MeshStandardMaterial({ map: waterTex, color: 0xffffff, transparent: true, opacity: 0.88, roughness: 0.08, metalness: 0.15 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xe8d29a, roughness: 1 }),
  };
  const hedgeMat = (rx, ry) => { const t = hedgeTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); };
  const flatMat = (tex, w, d, tile = 2.4) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / tile, d / tile); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); };

  /* ----- helpers ----- */
  const solidBody = (x, y, z, rotY = 0) => {
    const b = new CANNON.Body({ mass: 0, material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1 });
    b.position.set(x, y, z); b.quaternion.setFromEuler(0, rotY, 0); world.addBody(b); return b;
  };
  const box = (w, h, d, x, y, z, mat, o = {}) => {
    const { ray = true, rot = 0, cast = true, phys = true } = o;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = rot; m.castShadow = cast; m.receiveShadow = true; scene.add(m); if (ray) rayTargets.push(m);
    if (phys) solidBody(x, y, z, rot).addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    return m;
  };
  const ball = (r, x, y, z) => solidBody(x, y, z).addShape(new CANNON.Sphere(r));
  const put = (mesh, x, y, z, o = {}) => { mesh.position.set(x, y, z); mesh.castShadow = o.cast !== false; mesh.receiveShadow = true; scene.add(mesh); if (o.ray) rayTargets.push(mesh); return mesh; };
  const zones = [[17, -15, 5], [-15, 15, 6.5], [16.5, 15, 8.5], [-9, -9, 4], [11, -10, 3.5], [-9, 9, 4], [7, 11, 3.5], [-16, -8, 3], [17.5, 5, 3], [13, 5, 2.5], [-11, -6, 2.5], [0, -14, 4.5], [0, -21, 5], [-8, -19.5, 4], [8, 19.5, 4], [-14.5, 0, 6]];
  const zone = (x, z, r) => { zones.push([x, z, r]); };
  const zoneHit = (x, z, pad = 0) => zones.some(([zx, zz, zr]) => Math.hypot(x - zx, z - zz) < zr + pad);
  const blocked = (x, z) => Math.abs(x) < 2.6 || Math.abs(z) < 2.6 || Math.hypot(x, z) < 7.4 || Math.abs(Math.hypot(x, z) - 34) < 2.5 || zoneHit(x, z);
  const octagonBody = (b, half, y) => {          // square + 45-degree square = octagon footprint
    b.addShape(new CANNON.Box(new CANNON.Vec3(half, y, half)));
    b.addShape(new CANNON.Box(new CANNON.Vec3(half, y, half)), new CANNON.Vec3(0, 0, 0), new CANNON.Quaternion().setFromEuler(0, Math.PI / 4, 0));
  };

  /* ----- ground ----- */
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), flatMat(grassTex, 700, 700, 8)); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; scene.add(outer);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 2, H * 2), M.grass);
  floor.position.y = -1; floor.receiveShadow = true;
  scene.add(floor); rayTargets.push(floor);
  const fb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(H, 1, H)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1 });
  fb.position.set(0, -1, 0); world.addBody(fb);

  /* ----- paths + plaza ----- */
  const flat = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  flat(new THREE.PlaneGeometry(4.4, H * 2), flatMat(cobbleTex, 4.4, H * 2), 0, 0.02, 0);
  flat(new THREE.PlaneGeometry(H * 2, 4.4), flatMat(cobbleTex, H * 2, 4.4), 0, 0.022, 0);
  flat(new THREE.CircleGeometry(7, 64), flatMat(cobbleTex, 14, 14), 0, 0.03, 0);
  flat(new THREE.RingGeometry(6.8, 7.15, 64), M.gold, 0, 0.034, 0);
  RAINBOW.forEach((c, i) => flat(new THREE.RingGeometry(3.2 + i * 0.35, 3.2 + i * 0.35 + 0.33, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }), 0, 0.045, 0));
  // a big Verity smiley in the middle of the plaza
  flat(new THREE.CircleGeometry(2.8, 48), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.6 }), 0, 0.05, 0);
  [-0.9, 0.9].forEach(x => { const e = flat(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: 0x24160a }), x, 0.06, -0.55); e.scale.set(0.8, 1.4, 1); });
  flat(new THREE.RingGeometry(1.5, 1.75, 40, 1, Math.PI * 1.1, Math.PI * 0.8), new THREE.MeshBasicMaterial({ color: 0x24160a }), 0, 0.06, 0.4);
  flat(new THREE.CircleGeometry(3.4, 40), flatMat(cobbleTex, 6.8, 6.8), -14.5, 0.04, 0);        // station pad

  /* ----- perimeter: tall hedge walls (the arena boundary) + iron fence ----- */
  const WH = 7;
  const hedgeWall = (w, d, x, z) => box(w, WH, d, x, WH / 2, z, hedgeMat(Math.max(w, d) / 5, 1.4), { cast: false });
  hedgeWall(H * 2 + 2, 1, 0, -H - 0.5); hedgeWall(H * 2 + 2, 1, 0, H + 0.5);
  hedgeWall(1, H * 2 + 2, -H - 0.5, 0); hedgeWall(1, H * 2 + 2, H + 0.5, 0);
  {
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), tipGeo = new THREE.ConeGeometry(0.08, 0.2, 6);
    const fenceN = Math.floor(H * 2 / 0.9);
    const fencePosts = new THREE.InstancedMesh(postGeo, M.iron, fenceN * 4), fenceTips = new THREE.InstancedMesh(tipGeo, M.gold, fenceN * 4), dm = new THREE.Object3D();
    let fi = 0;
    for (let i = 0; i < fenceN; i++) {
      const t = -H + (i + 0.5) * (H * 2 / fenceN);
      for (const [x, z] of [[t, -H + 0.5], [t, H - 0.5], [-H + 0.5, t], [H - 0.5, t]]) {
        dm.position.set(x, 0.65, z); dm.updateMatrix(); fencePosts.setMatrixAt(fi, dm.matrix);
        dm.position.set(x, 1.4, z); dm.updateMatrix(); fenceTips.setMatrixAt(fi, dm.matrix); fi++;
      }
    }
    fencePosts.castShadow = true; scene.add(fencePosts, fenceTips);
    for (const [w, d, x, z] of [[H * 2, 0.16, 0, -H + 0.5], [H * 2, 0.16, 0, H - 0.5], [0.16, H * 2, -H + 0.5, 0], [0.16, H * 2, H - 0.5, 0]]) {
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), M.iron); r1.position.set(x, 0.45, z); const r2 = r1.clone(); r2.position.y = 1.05; scene.add(r1, r2);
    }
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.6), new THREE.MeshBasicMaterial({
    map: canvasTex(512, (g, s) => {
      g.clearRect(0, 0, s, s); g.fillStyle = '#10244f'; g.beginPath(); g.roundRect(8, 150, s - 16, 212, 28); g.fill();
      g.strokeStyle = '#ffc233'; g.lineWidth = 10; g.stroke();
      g.font = '900 96px "Segoe UI",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const gr = g.createLinearGradient(40, 0, s - 40, 0); RAINBOW.forEach((c, i) => gr.addColorStop(i / 6, c)); g.fillStyle = gr; g.fillText('VERITY PARK', s / 2, 242);
      g.font = '700 30px "Segoe UI",system-ui,sans-serif'; g.fillStyle = '#ffe9a8'; g.fillText('THE HOME OF TRUTH', s / 2, 322);
    }), transparent: true, fog: false,
  }));
  sign.position.set(0, 4.6, -H + 0.04); sign.scale.set(1.35, 1.35, 1); scene.add(sign);

  /* ----- trees ----- */
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.42, 4, 10), canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMats = [0x3f9a3a, 0x4fae42, 0x2f8a35, 0x66b84a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
  const blossom = new THREE.MeshStandardMaterial({ color: 0xff9ecb, roughness: 0.85, flatShading: true }), autumn = new THREE.MeshStandardMaterial({ color: 0xf0a030, roughness: 0.85, flatShading: true });
  const treePts = [];
  function tree(x, z, s = 1, kind = 0, real = true) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = R() * 6;
    const t = new THREE.Mesh(trunkGeo, M.bark); t.scale.set(s, s, s); t.position.y = 2 * s; t.castShadow = real; g.add(t);
    [[0, 5.2, 0, 2.1], [1.2, 4.5, 0.6, 1.5], [-1.1, 4.7, -0.8, 1.6], [0.3, 6.4, 0.3, 1.5], [-0.5, 4.3, 1.2, 1.3]].forEach(([dx, dy, dz, r]) => {
      const c = new THREE.Mesh(canopyGeo, kind === 1 ? blossom : kind === 2 ? autumn : leafMats[(R() * 4) | 0]);
      c.position.set(dx * s, dy * s, dz * s); c.scale.setScalar(r * s * rr(0.92, 1.08)); c.rotation.set(R() * 3, R() * 3, 0); c.castShadow = real; g.add(c);
    });
    scene.add(g);
    if (real) { treePts.push([x, z]); rayTargets.push(t); solidBody(x, 2 * s, z).addShape(new CANNON.Box(new CANNON.Vec3(0.42 * s, 2 * s, 0.42 * s))); }
    return g;
  }
  [[-20, -20, 1.1, 0], [-23, -9, 1, 2], [-21, 9, 1.15, 0], [-22, 21, 1, 1], [-10, -22, 1.05, 0], [10, -23, 1.1, 1], [21, -23, 1, 0], [23, -8, 1.1, 2], [22, 6, 1.05, 0], [22, 22, 1.1, 0],
    [11.5, 23, 1, 1], [-9, 23, 1.1, 0], [-4.5, -7.5, 0.95, 1], [7, 7, 0.95, 0], [-12, 8, 1, 2], [13, -9, 1.05, 0], [-5, 15, 1, 0], [7, -18, 0.9, 1]].forEach(([x, z, s, k]) => tree(x, z, s, k));
  const fdm = new THREE.Object3D();
  function forest(pts, real) {                                  // instanced trees; real ones get a trunk collider
    const n = pts.length, pal = [0x3f9a3a, 0x4fae42, 0x2f8a35, 0x66b84a], col = new THREE.Color(), blobs = [[0, 5.2, 0, 2.1], [1.2, 4.5, 0.6, 1.5], [-1.1, 4.7, -0.8, 1.6], [0.3, 6.4, 0.3, 1.5]];
    const tr = new THREE.InstancedMesh(trunkGeo, M.bark, n), cn = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), n * 4);
    let ci = 0;
    pts.forEach(([x, z, s, k], i) => {
      fdm.rotation.set(0, 0, 0); fdm.scale.setScalar(s); fdm.position.set(x, 2 * s, z); fdm.updateMatrix(); tr.setMatrixAt(i, fdm.matrix);
      const rot = R() * 6, c = Math.cos(rot), sn = Math.sin(rot);
      for (const [dx, dy, dz, r] of blobs) {
        fdm.position.set(x + (dx * c + dz * sn) * s, dy * s, z + (-dx * sn + dz * c) * s); fdm.scale.setScalar(r * s * rr(0.92, 1.08)); fdm.rotation.set(R() * 3, R() * 3, 0); fdm.updateMatrix();
        cn.setMatrixAt(ci, fdm.matrix); col.set(k === 1 ? 0xff9ecb : k === 2 ? 0xf0a030 : pal[(R() * 4) | 0]); cn.setColorAt(ci, col); ci++;
      }
      if (real) solidBody(x, 2 * s, z).addShape(new CANNON.Box(new CANNON.Vec3(0.42 * s, 2 * s, 0.42 * s)));
    });
    tr.castShadow = cn.castShadow = real; scene.add(tr, cn); if (real) rayTargets.push(tr);
  }
  { const dec = []; for (let i = 0; i < 130; i++) { const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), m = Math.max(Math.abs(c), Math.abs(sn)), d = H + 4 + R() * 12; dec.push([c / m * d, sn / m * d, 2 + R() * 1.1, (R() * 3) | 0]); } forest(dec, false); }
  [[-100, -92, 52, 0x6fb35a], [88, -104, 58, 0x7cc063], [-118, 36, 50, 0x68ad55], [108, 52, 54, 0x74b95e], [0, 126, 62, 0x6bb057], [-56, 116, 44, 0x7ac162], [40, -126, 58, 0x6aae56], [136, -24, 50, 0x72b45c], [-136, -50, 52, 0x68ad55], [70, 112, 46, 0x74b95e]].forEach(([x, z, r, c]) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    h.scale.y = 0.38; h.position.set(x, -1, z); scene.add(h);
  });

  /* ----- hedges (cover) ----- */
  const lowHedge = (x, z, w, d) => {
    box(w, 1.15, d, x, 0.575, z, hedgeMat(Math.max(w, d) / 2.5, 0.5));
    const geo = new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, Math.max(w, d), 10, 1);
    if (w > d) geo.rotateZ(Math.PI / 2); else geo.rotateX(Math.PI / 2);
    const top = new THREE.Mesh(geo, hedgeMat(Math.max(w, d) / 2.5, 0.3)); top.position.set(x, 1.12, z); top.scale.y = 0.45; top.castShadow = true; scene.add(top);
  };
  [[-9, -9, 6, 1.3], [11, -10, 1.3, 5], [-9, 9, 1.3, 6], [7, 11, 5, 1.3], [-16, -8, 4, 1.3], [17.5, 5, 4, 1.3]].forEach(([x, z, w, d]) => lowHedge(x, z, w, d));
  box(1.5, 2.6, 7, -8, 1.3, -19.5, hedgeMat(2, 0.6)); box(1.5, 2.6, 7, 8, 1.3, 19.5, hedgeMat(2, 0.6));
  // station alcove (west)
  box(1.6, 2.2, 9, -17.8, 1.1, 0, hedgeMat(2, 0.6)); box(4.6, 2.2, 1.3, -15.6, 1.1, 4.6, hedgeMat(2, 0.6)); box(4.6, 2.2, 1.3, -15.6, 1.1, -4.6, hedgeMat(2, 0.6));

  /* ----- benches, lamps, tables, rocks ----- */
  function bench(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.1), M.wood); s.position.set(0, 0.46, -0.2 + i * 0.1); s.castShadow = true; g.add(s); }
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.04), M.wood); s.position.set(0, 0.62 + i * 0.13, -0.26); s.rotation.x = -0.12; s.castShadow = true; g.add(s); }
    for (const sx of [-0.8, 0.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.55), M.iron); l.position.set(sx, 0.45, -0.05); l.castShadow = true; g.add(l); }
    scene.add(g);
    solidBody(x, 0.45, z, rot).addShape(new CANNON.Box(new CANNON.Vec3(0.92, 0.45, 0.3)));
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.9, 0.6), M.wood); hit.visible = false; hit.position.set(x, 0.45, z); hit.rotation.y = rot; scene.add(hit); rayTargets.push(hit);
  }
  [[3.3, -6, Math.PI / 2], [-3.3, 6, -Math.PI / 2], [3.3, 11, Math.PI / 2], [-3.3, -11, -Math.PI / 2], [6, 3.3, Math.PI], [-6, -3.3, 0], [5.2, -14, Math.PI / 2], [-5.2, -14, -Math.PI / 2], [19, 2.6, Math.PI]].forEach(([x, z, r]) => bench(x, z, r));

  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  const haloTex = canvasTex(64, (g, s) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,240,170,.9)'); r.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  function lamp(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.5, 10), M.iron); base.position.y = 0.25; g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.2, 8), M.iron); pole.position.y = 2.0; pole.castShadow = true; g.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), lampGlow); bulb.position.y = 3.65; g.add(bulb);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.25, 10), M.gold); cap.position.y = 3.98; g.add(cap);
    const hl = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); hl.scale.setScalar(1.7); hl.position.y = 3.65; g.add(hl);
    scene.add(g); rayTargets.push(pole);
    solidBody(x, 1.8, z).addShape(new CANNON.Box(new CANNON.Vec3(0.14, 1.8, 0.14)));
  }
  [[2.8, -9], [-2.8, 9], [2.8, 17], [-2.8, -18], [9, 2.8], [-9, -2.8], [20, -2.8], [-2.8, 22], [7, -2.8]].forEach(([x, z]) => lamp(x, z));

  function picnic(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.07, 0.9), M.wood); top.position.y = 0.8; top.castShadow = true; g.add(top);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.02, 0.5), new THREE.MeshStandardMaterial({ map: canvasTex(64, (c, s) => { c.fillStyle = '#fff'; c.fillRect(0, 0, s, s); c.fillStyle = '#e8394a'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) c.fillRect(i * 16, j * 16, 16, 16); }, [4, 1]), roughness: 0.9 })); cloth.position.y = 0.845; g.add(cloth);
    for (const sz of [-0.75, 0.75]) { const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.32), M.wood); b.position.set(0, 0.46, sz); b.castShadow = true; g.add(b); }
    for (const sx of [-0.75, 0.75]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 1.7), M.wood); l.position.set(sx, 0.4, 0); g.add(l); }
    scene.add(g);
    solidBody(x, 0.45, z, rot).addShape(new CANNON.Box(new CANNON.Vec3(1.0, 0.45, 0.95)));
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 1.9), M.wood); hit.visible = false; hit.position.set(x, 0.45, z); hit.rotation.y = rot; scene.add(hit); rayTargets.push(hit);
  }
  picnic(13, 5, 0); picnic(-11, -6, Math.PI / 2);

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9aa09a, roughness: 0.95, flatShading: true });
  const rock = (x, z, r) => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat); put(m, x, r * 0.6, z, { ray: true }); m.scale.y = 0.75; m.rotation.set(R() * 3, R() * 6, 0); ball(r * 0.8, x, r * 0.55, z); };
  [[-5, -6, 0.7], [14.5, -6.5, 0.8], [-16, -15, 0.9], [4, 7, 0.55], [-3, 18, 0.7], [24, -17, 0.8]].forEach(([x, z, r]) => rock(x, z, r));

  /* ----- fountain (north plaza) ----- */
  {
    const FZ = -14, g = new THREE.Group(); g.position.set(0, 0, FZ); scene.add(g);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.45, 0.85, 32), M.stone); basin.position.y = 0.42; basin.castShadow = basin.receiveShadow = true; g.add(basin); rayTargets.push(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.16, 10, 48), M.gold); rim.rotation.x = Math.PI / 2; rim.position.y = 0.86; g.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.15, 40), M.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.72; g.add(water);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 1.6, 14), M.stone); pedestal.position.y = 1.4; pedestal.castShadow = true; g.add(pedestal);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.5, 0.4, 24), M.stone); bowl.position.y = 2.05; bowl.castShadow = true; g.add(bowl);
    const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), M.water); bowlWater.rotation.x = -Math.PI / 2; bowlWater.position.y = 2.26; g.add(bowlWater);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 10), M.stone); stem.position.y = 2.7; g.add(stem);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.25, emissive: 0xffa000, emissiveIntensity: 0.5 })); orb.position.y = 3.5; g.add(orb);
    const streams = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.14, 1.9, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      s.position.set(Math.cos(a) * 0.95, 1.3, Math.sin(a) * 0.95); s.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); g.add(s); streams.push(s);
    }
    const b = solidBody(0, 0.6, FZ); octagonBody(b, 2.45, 0.6);
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.45, 1.8, 0.45)), new CANNON.Vec3(0, 1.4, 0));
    anim.push(t => { water.material.map.offset.set(t * 0.02, t * 0.015); streams.forEach((s, i) => { s.material.opacity = 0.3 + 0.15 * Math.sin(t * 6 + i); s.scale.y = 1 + 0.08 * Math.sin(t * 8 + i * 2); }); orb.rotation.y = t; });
  }

  /* ----- rainbow arch over the north path ----- */
  {
    const AZ = -21, g = new THREE.Group(); g.position.set(0, 0, AZ); scene.add(g);
    RAINBOW.forEach((c, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(3.05 + i * 0.22, 0.12, 8, 48, Math.PI), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.4 })); m.castShadow = true; g.add(m); });
    for (const sx of [-1, 1]) solidBody(sx * 3.8, 1.7, AZ).addShape(new CANNON.Box(new CANNON.Vec3(0.95, 1.7, 0.35)));
  }

  /* ----- gazebo (north-east) ----- */
  {
    const GX = 17, GZ = -15, g = new THREE.Group(); g.position.set(GX, 0, GZ); scene.add(g);
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.2, 8), M.stone); fl.position.y = 0.1; fl.receiveShadow = true; g.add(fl); rayTargets.push(fl);
    octagonBody(solidBody(GX, 0.1, GZ), 3.3, 0.1);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.PI / 8, px = Math.cos(a) * 3.2, pz = Math.sin(a) * 3.2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.3, 8), M.white); p.position.set(px, 1.85, pz); p.castShadow = true; g.add(p);
      if (i % 2 === 0) solidBody(GX + px, 1.85, GZ + pz).addShape(new CANNON.Box(new CANNON.Vec3(0.14, 1.65, 0.14)));
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0xd24a4a, roughness: 0.6, flatShading: true })); roof.position.y = 4.25; roof.castShadow = true; g.add(roof);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), M.gold); knob.position.y = 5.3; g.add(knob);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.07, 6, 8), M.white); ring.rotation.x = Math.PI / 2; ring.position.y = 3.5; g.add(ring);
  }

  /* ----- pond (south-west) ----- */
  {
    const PX = -15, PZ = 15;
    const w = new THREE.Mesh(new THREE.CircleGeometry(4.3, 40), M.water); w.rotation.x = -Math.PI / 2; w.position.set(PX, 0.05, PZ); scene.add(w);
    const mud = new THREE.Mesh(new THREE.CircleGeometry(4.7, 40), new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 })); mud.rotation.x = -Math.PI / 2; mud.position.set(PX, 0.02, PZ); scene.add(mud);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; rock(PX + Math.cos(a) * 4.8, PZ + Math.sin(a) * 4.8, 0.55 + R() * 0.35); }
    const pads = [];
    for (let i = 0; i < 9; i++) {
      const a = R() * 6.28, d = R() * 3.3, p = new THREE.Mesh(new THREE.CircleGeometry(0.35 + R() * 0.15, 14, 0, Math.PI * 1.85), new THREE.MeshStandardMaterial({ color: 0x3d9a48, roughness: 0.8, side: THREE.DoubleSide }));
      p.rotation.x = -Math.PI / 2; p.rotation.z = R() * 6; p.position.set(PX + Math.cos(a) * d, 0.07, PZ + Math.sin(a) * d); scene.add(p); pads.push(p);
      if (i % 3 === 0) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff7fc0, emissive: 0x802050, emissiveIntensity: 0.4 })); f.position.set(p.position.x, 0.16, p.position.z); scene.add(f); }
    }
    for (let i = 0; i < 18; i++) {
      const a = R() * 6.28, d = 3.4 + R() * 0.7, r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.1 + R() * 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x6f9a3a }));
      r.position.set(PX + Math.cos(a) * d, 0.6, PZ + Math.sin(a) * d); r.rotation.set((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3); scene.add(r);
      const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 })); t2.position.set(r.position.x, 1.2 + R() * 0.6, r.position.z); scene.add(t2);
    }
    anim.push(t => { w.material.map.offset.set(-t * 0.015, t * 0.01); pads.forEach((p, i) => { p.position.y = 0.07 + 0.012 * Math.sin(t * 1.5 + i); }); });
    bench(PX + 6.2, PZ - 1, Math.PI / 2);
  }

  /* ----- playground (south-east) ----- */
  {
    const SX0 = 15, SZ0 = 13, colors = [0xff3b4e, 0xffc81c, 0x2d86ff, 0x3ccf5a];
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 });
    const swing = new THREE.Group(); swing.position.set(SX0, 0, SZ0); scene.add(swing);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 10).rotateZ(Math.PI / 2), mat(0xff3b4e)); bar.position.y = 2.7; bar.castShadow = true; swing.add(bar);
    for (const sx of [-2.2, 2.2]) for (const dir of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.85, 8), mat(0xff3b4e)); l.position.set(sx, 1.35, dir * 0.45); l.rotation.x = -dir * 0.32; l.castShadow = true; swing.add(l); }
    const seats = [];
    [-0.9, 0.9].forEach((sx, i) => {
      const s = new THREE.Group(); s.position.set(sx, 2.7, 0);
      for (const cx of [-0.22, 0.22]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 5), M.iron); ch.position.set(cx, -1.05, 0); s.add(ch); }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.28), mat(colors[i + 1])); seat.position.y = -2.1; seat.castShadow = true; s.add(seat);
      swing.add(s); seats.push(s);
    });
    for (const sx of [-2.2, 2.2]) solidBody(SX0 + sx, 1.4, SZ0).addShape(new CANNON.Box(new CANNON.Vec3(0.2, 1.4, 0.7)));
    const mg = new THREE.Group(); mg.position.set(SX0 + 4.6, 0.3, SZ0 + 3.2); scene.add(mg);    // merry-go-round
    for (let i = 0; i < 8; i++) { const sec = new THREE.Mesh(new THREE.CircleGeometry(1.5, 8, i * Math.PI / 4, Math.PI / 4), new THREE.MeshStandardMaterial({ color: RAINBOW[i % 7], roughness: 0.6, side: THREE.DoubleSide })); sec.rotation.x = -Math.PI / 2; sec.position.y = 0.08; sec.receiveShadow = true; mg.add(sec); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 10), M.iron); hub.position.y = 0.6; mg.add(hub);
    for (let i = 0; i < 4; i++) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 6, 14, Math.PI), M.iron); h.rotation.y = i * Math.PI / 2; h.position.y = 0.55; mg.add(h); }
    solidBody(SX0 + 4.6, 0.3, SZ0 + 3.2).addShape(new CANNON.Box(new CANNON.Vec3(1.1, 0.3, 1.1)));
    const sbx = SX0 - 2, sbz = SZ0 + 4.4;                                                         // sandbox
    put(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 3.4), M.sand), sbx, 0.1, sbz, { cast: false });
    for (const [w, d, dx, dz] of [[3.6, 0.2, 0, -1.7], [3.6, 0.2, 0, 1.7], [0.2, 3.6, -1.7, 0], [0.2, 3.6, 1.7, 0]]) box(w, 0.32, d, sbx + dx, 0.16, sbz + dz, M.wood, { phys: false });
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.25, 12), mat(0xff3b4e)), sbx - 0.6, 0.32, sbz + 0.4);
    put(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 10), M.sand), sbx + 0.5, 0.42, sbz - 0.4);
    anim.push(t => { seats.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.4 + i * 1.7) * 0.35; }); mg.rotation.y = t * 0.8; });
  }

  /* ==================================================================
     EXPANDED PARK: ring promenade, gates, monument, market + clock tower,
     lake + dock, windmill + wheat, stage, campfire grove, hedge garden,
     bulk trees / bushes / wildflowers, stepping-stone trails, butterflies.
     ================================================================== */
  const extraHeads = [];
  const textPlane = (text, w, h, bg = '#10244f', fg = '#ffe9a8') => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: canvasTex(256, (g, s) => { g.fillStyle = bg; g.fillRect(0, 0, s, s); g.strokeStyle = '#ffc233'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10); g.fillStyle = fg; g.font = '900 44px "Segoe UI",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; const parts = text.split('|'); parts.forEach((p, i) => g.fillText(p, s / 2, s / 2 + (i - (parts.length - 1) / 2) * 56)); }),
  }));

  /* ----- ring promenade ----- */
  flat(new THREE.RingGeometry(32.3, 35.7, 128), flatMat(cobbleTex, 72, 72), 0, 0.04, 0);
  flat(new THREE.RingGeometry(32.15, 32.4, 128), M.gold, 0, 0.05, 0);
  flat(new THREE.RingGeometry(35.6, 35.85, 128), M.gold, 0, 0.05, 0);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; lamp(Math.cos(a) * 37.2, Math.sin(a) * 37.2); }
  [[2.8, -30], [-2.8, -38.5], [2.8, 30], [-2.8, 39], [30, 2.8], [-30, -2.8], [39.5, -2.8], [-39.5, 2.8]].forEach(([x, z]) => lamp(x, z));
  [[3.3, -27, Math.PI / 2], [-3.3, 27, -Math.PI / 2], [27, 3.3, Math.PI], [-27, -3.3, 0], [3.3, -38, Math.PI / 2], [-3.3, 38, -Math.PI / 2]].forEach(([x, z, r]) => bench(x, z, r));

  /* ----- east + west gates ----- */
  function gate(gx, label) {
    for (const sz of [-4.6, 4.6]) {
      box(1.5, 6, 1.5, gx, 3, sz, M.stone);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), M.gold), gx, 6.6, sz);
      put(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 1.8), M.gold), gx, 0.12, sz, { cast: false });
    }
    box(1.8, 1.2, 11.4, gx, 6.6, 0, M.stone, { phys: false });
    put(new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.18, 11.6), M.gold), gx, 7.28, 0);
    RAINBOW.forEach((c, i) => put(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 10.8), new THREE.MeshBasicMaterial({ color: c })), gx - Math.sign(gx) * 0.93, 6.05 + i * 0.1, 0, { cast: false }));
    const sp = textPlane(label, 5.4, 1.5); sp.scale.set(1, 1, 1); sp.position.set(gx - Math.sign(gx) * 0.93, 6.6, 0); sp.rotation.y = Math.sign(gx) > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(sp);
    zone(gx, 0, 6);
  }
  gate(36.8, 'EAST|GATE'); gate(-36.8, 'WEST|GATE');

  /* ----- north monument: golden Verity statue on stepped plinth ----- */
  {
    const MZ = -34, g = new THREE.Group(); g.position.set(0, 0, MZ); scene.add(g);
    [[6.2, 0.25], [5.0, 0.5], [3.9, 0.75]].forEach(([r, top], i) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, 0.25, 8), i === 1 ? M.gold : M.stone); c.position.y = top - 0.125; c.castShadow = c.receiveShadow = true; g.add(c); rayTargets.push(c);
      octagonBody(solidBody(0, top - 0.125, MZ), r * 0.9, 0.125);
    });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 3.2, 8), M.stone); ped.position.y = 2.35; ped.castShadow = true; g.add(ped); rayTargets.push(ped);
    octagonBody(solidBody(0, 2.35, MZ), 1.35, 1.6);
    const st2 = new THREE.Group(); st2.position.y = 5.2; g.add(st2);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.3, 32, 24), new THREE.MeshStandardMaterial({ color: 0xffc928, roughness: 0.2, metalness: 0.85, emissive: 0x7a4800, emissiveIntensity: 0.5 })); body.castShadow = true; st2.add(body);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x24160a, roughness: 0.4 })); e.position.set(sx * 0.42, 0.3, 1.2); e.scale.set(0.1, 0.19, 0.08); st2.add(e); }
    const sm = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x24160a, roughness: 0.4 })); sm.rotation.z = Math.PI; sm.position.set(0, -0.12, 1.12); st2.add(sm);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe28a })); halo.position.y = 5.2; g.add(halo);
    const pl = textPlane('VERITY|PRESERVED', 2.2, 1.2); pl.position.set(0, 2.1, 1.53); pl.rotation.x = 0; g.add(pl);
    anim.push(t => { st2.rotation.y = Math.sin(t * 0.5) * 0.35; st2.position.y = 5.2 + Math.sin(t * 1.6) * 0.12; halo.rotation.x = Math.PI / 2 + Math.sin(t) * 0.15; halo.rotation.y = t * 0.6; });
    zone(0, MZ, 7);
  }

  /* ----- market street (south) + clock tower ----- */
  {
    const stripe = canvasTex(64, (c, s) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : RAINBOW[(i >> 1) % 7]; c.fillRect(i * 8, 0, 8, s); } }, [1, 1]);
    const awnMats = [0, 1, 2, 3].map(k => { const t = canvasTex(64, (c, s) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#fff6e4' : ['#e8394a', '#2d86ff', '#3ccf5a', '#ffb81c'][k]; c.fillRect(i * 8, 0, 8, s); } }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); });
    function stall(x, z, rot, k) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 0.9), M.wood); counter.position.set(0, 0.5, 0.5); counter.castShadow = true; g.add(counter);
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 1.0), M.stone); top.position.set(0, 1.03, 0.5); g.add(top);
      for (const sx of [-1.15, 1.15]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 0.08), M.wood); p.position.set(sx, 1.25, -0.5); p.castShadow = true; g.add(p); const p2 = p.clone(); p2.scale.y = 0.85; p2.position.set(sx, 1.06, 0.95); g.add(p2); }
      const aw = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.07, 1.9), awnMats[k % 4]); aw.position.set(0, 2.38, 0.2); aw.rotation.x = 0.2; aw.castShadow = true; g.add(aw);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 0.05), M.wood); back.position.set(0, 1.1, -0.5); g.add(back);
      for (let i = 0; i < 6; i++) { const it = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: RAINBOW[(i + k) % 7], roughness: 0.5 })); it.position.set(-0.9 + i * 0.36, 1.2, 0.5 + ((i % 2) - 0.5) * 0.2); g.add(it); }
      scene.add(g);
      const b = solidBody(x, 0, z, rot); b.addShape(new CANNON.Box(new CANNON.Vec3(1.2, 0.55, 0.5)), new CANNON.Vec3(0, 0.55, 0.5)); b.addShape(new CANNON.Box(new CANNON.Vec3(1.15, 1.2, 0.1)), new CANNON.Vec3(0, 1.2, -0.5));
      rayTargets.push(counter, back); zone(x, z, 2.2);
    }
    [26, 30.5, 35].forEach((z, i) => { stall(5.6, z, -Math.PI / 2, i); stall(-5.6, z + 1.2, Math.PI / 2, i + 1); });

    const CX = 11.5, CZ = 37.5, g = new THREE.Group(); g.position.set(CX, 0, CZ); scene.add(g);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(3, 9, 3), M.stone); shaft.position.y = 4.5; shaft.castShadow = true; g.add(shaft); rayTargets.push(shaft);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(3.7, 3, 3.7), M.stone); blk.position.y = 10.5; blk.castShadow = true; g.add(blk);
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.25, 3.9), M.gold); band.position.y = 9; g.add(band);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 3.4, 4), new THREE.MeshStandardMaterial({ color: 0x3c4a78, roughness: 0.6, flatShading: true })); roof.rotation.y = Math.PI / 4; roof.position.y = 13.7; roof.castShadow = true; g.add(roof);
    const spire = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), M.gold); spire.position.y = 15.6; g.add(spire);
    const faceTex = canvasTex(256, (c, s) => { c.fillStyle = '#fdf7e6'; c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 6, 0, 7); c.fill(); c.strokeStyle = '#c99320'; c.lineWidth = 10; c.stroke(); c.fillStyle = '#1a1208'; c.font = '700 30px "Segoe UI",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI * 2; c.fillText(String(i), s / 2 + Math.sin(a) * 90, s / 2 - Math.cos(a) * 90); } });
    const hands = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group(); f.rotation.y = i * Math.PI / 2; f.position.y = 10.5; g.add(f);
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32), new THREE.MeshBasicMaterial({ map: faceTex })); face.position.z = 1.86; f.add(face);
      const mk = (len, w, z) => { const geo = new THREE.BoxGeometry(w, len, 0.04); geo.translate(0, len / 2, 0); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1208 })); m.position.z = z; f.add(m); return m; };
      hands.push([mk(0.7, 0.09, 1.88), mk(1.0, 0.06, 1.9)]);
    }
    anim.push(() => { const d = new Date(), mi = d.getMinutes() + d.getSeconds() / 60, hr = (d.getHours() % 12) + mi / 60; for (const [h, m] of hands) { h.rotation.z = -hr / 12 * Math.PI * 2; m.rotation.z = -mi / 60 * Math.PI * 2; } });
    const cb = solidBody(CX, 6, CZ); cb.addShape(new CANNON.Box(new CANNON.Vec3(1.6, 6, 1.6)));
    zone(CX, CZ, 4.8);
    rayTargets.push(blk);
  }

  /* ----- lake with island, dock and rowing boat (north-east) ----- */
  {
    const LX = 31, LZ = -30;
    const mud = flat(new THREE.CircleGeometry(8.4, 48), new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 }), LX, 0.02, LZ); mud.scale.set(1.12, 0.92, 1);
    const lake = flat(new THREE.CircleGeometry(7.6, 48), M.water, LX, 0.06, LZ); lake.scale.set(1.12, 0.92, 1);
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2 + R() * 0.2; rock(LX + Math.cos(a) * 9.1, LZ + Math.sin(a) * 7.7, 0.5 + R() * 0.45); }
    const isl = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.grass); isl.scale.y = 0.35; put(isl, LX - 0.8, 0.02, LZ + 0.4, { cast: false });
    ball(1.7, LX - 0.8, 0.0, LZ + 0.4);
    tree(LX - 0.8, LZ + 0.4, 0.8, 1);
    const pads = [];
    for (let i = 0; i < 16; i++) { const a = R() * 6.28, d = 3 + R() * 4, p = new THREE.Mesh(new THREE.CircleGeometry(0.4 + R() * 0.2, 14, 0, Math.PI * 1.85), new THREE.MeshStandardMaterial({ color: 0x3d9a48, roughness: 0.8, side: THREE.DoubleSide })); p.rotation.x = -Math.PI / 2; p.rotation.z = R() * 6; p.position.set(LX + Math.cos(a) * d * 1.1, 0.09, LZ + Math.sin(a) * d * 0.9); scene.add(p); pads.push(p); }
    // dock
    box(6.4, 0.12, 1.8, LX - 6.4, 0.29, LZ + 3, M.wood);
    for (const dx of [-3, 0, 3]) for (const dz of [-0.8, 0.8]) put(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), M.wood), LX - 6.4 + dx, 0.15, LZ + 3 + dz, { cast: false });
    // rowing boat
    const boat = new THREE.Group(); boat.position.set(LX + 3.5, 0.12, LZ + 2); boat.rotation.y = 0.6; scene.add(boat);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0xd24a4a, roughness: 0.6 })); hull.position.y = 0.2; hull.castShadow = true; boat.add(hull);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 1.0), M.wood); inner.position.y = 0.5; boat.add(inner);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0xd24a4a, roughness: 0.6 })); bow.rotation.z = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.y = 0.6; bow.position.set(2.0, 0.2, 0); boat.add(bow);
    for (const sz of [-0.8, 0.8]) { const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), M.wood); oar.rotation.x = Math.PI / 2; oar.rotation.z = 0.3 * Math.sign(sz); oar.position.set(0, 0.7, sz * 1.1); boat.add(oar); }
    solidBody(LX + 3.5, 0.3, LZ + 2, 0.6).addShape(new CANNON.Box(new CANNON.Vec3(1.6, 0.3, 0.65)));
    // cattails
    for (let i = 0; i < 20; i++) { const a = R() * 6.28, rr0 = 8.6 + R() * 0.5, x = LX + Math.cos(a) * rr0 * 1.1, z = LZ + Math.sin(a) * rr0 * 0.92; const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.4 + R() * 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x6f9a3a })); r.position.set(x, 0.75, z); scene.add(r); const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a20 })); t2.position.set(x, 1.5 + R() * 0.6, z); scene.add(t2); }
    anim.push(t => { boat.position.y = 0.12 + Math.sin(t * 1.3) * 0.035; boat.rotation.z = Math.sin(t * 1.1) * 0.03; pads.forEach((p, i) => { p.position.y = 0.09 + 0.012 * Math.sin(t * 1.5 + i); }); });
    zone(LX, LZ, 10.2);
  }

  /* ----- windmill + wheat field (north-west) ----- */
  {
    const WX = -31, WZ = -31, g = new THREE.Group(); g.position.set(WX, 0, WZ); g.rotation.y = Math.PI / 4; scene.add(g);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.6, 8.2, 14), M.white); tw.position.y = 4.1; tw.castShadow = true; g.add(tw); rayTargets.push(tw);
    const brick = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.75, 1.0, 14), M.stone); brick.position.y = 0.5; g.add(brick);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(2.0, 2.4, 14), new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.7, flatShading: true })); rf.position.y = 9.4; rf.castShadow = true; g.add(rf);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.1), M.wood); door.position.set(0, 0.95, 2.45); g.add(door);
    for (const [y, a] of [[4.2, 0.5], [6, -0.5], [4.4, 2.8], [6.2, 3.6]]) { const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.12), new THREE.MeshStandardMaterial({ color: 0x24344f })); const rad = 2.5 - (y - 0) * 0.13; w2.position.set(Math.sin(a) * rad, y, Math.cos(a) * rad); w2.rotation.y = a; g.add(w2); }
    const bl = new THREE.Group(); bl.position.set(0, 8.3, 1.9); g.add(bl);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10).rotateX(Math.PI / 2), M.iron); bl.add(hub);
    const sailTex = canvasTex(64, (c, s) => { c.fillStyle = '#f2ead6'; c.fillRect(0, 0, s, s); c.strokeStyle = '#9a8460'; c.lineWidth = 3; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(0, i * 8); c.lineTo(s, i * 8); c.stroke(); } for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, s); c.stroke(); } });
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; bl.add(arm);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.4, 0.14), M.wood); bar.position.y = 3.7; bar.castShadow = true; arm.add(bar);
      const sail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4.8, 0.05), new THREE.MeshStandardMaterial({ map: sailTex, roughness: 0.9 })); sail.position.set(0.9, 4.2, 0.06); sail.castShadow = true; arm.add(sail);
    }
    anim.push(t => { bl.rotation.z = -t * 0.55; });
    octagonBody(solidBody(WX, 4.2, WZ, Math.PI / 4), 1.9, 4.2);
    zone(WX, WZ, 5);
    // wheat
    const cells = [];
    for (let x = -40.4; x < -23; x += 0.42) for (let z = -40.4; z < -23; z += 0.42) {
      const px = x + (R() - 0.5) * 0.3, pz = z + (R() - 0.5) * 0.3;
      if (Math.hypot(px - WX, pz - WZ) < 4.4 || Math.hypot(px, pz) < 36.2 || (Math.floor((px + 40.4) / 3.4) % 5 === 4 && R() < 0.9)) continue;   // gaps = furrows
      cells.push([px, pz]);
    }
    const wm = new THREE.InstancedMesh(new THREE.ConeGeometry(0.045, 1.0, 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), cells.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    cells.forEach(([x, z], i) => { o.position.set(x, 0, z); o.rotation.set((R() - 0.5) * 0.3, R() * 6, (R() - 0.5) * 0.3); o.scale.set(1, 0.8 + R() * 0.5, 1); o.updateMatrix(); wm.setMatrixAt(i, o.matrix); c.setHSL(0.12 + R() * 0.03, 0.7, 0.45 + R() * 0.15); wm.setColorAt(i, c); });
    scene.add(wm);
    const sc = new THREE.Group(); sc.position.set(-36.5, 0, -26.5); scene.add(sc);        // scarecrow
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), M.wood); pole.position.y = 1.2; sc.add(pole);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.1), M.wood); arms.position.y = 1.7; sc.add(arms);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0xd24a4a })); shirt.position.y = 1.35; sc.add(shirt);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf0d9a0 })); hd.position.y = 2.0; sc.add(hd);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14), M.wood); hat.position.y = 2.22; sc.add(hat);
    const hat2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 12), M.wood); hat2.position.y = 2.38; sc.add(hat2);
    anim.push(t => { sc.rotation.z = Math.sin(t * 1.4) * 0.03; });
    zone(-32, -32, 10);
  }

  /* ----- stage + audience (south-east) ----- */
  {
    const SXs = 30, SZs = 35;
    box(10, 0.9, 5.5, SXs, 0.45, SZs, M.wood);
    box(3, 0.45, 1.0, SXs, 0.225, SZs - 3.25, M.wood);
    const bannerTex = canvasTex(512, (g, s) => {
      const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#0e2a66'); gr.addColorStop(1, '#2a0e66'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
      RAINBOW.forEach((c, i) => { g.strokeStyle = c; g.lineWidth = 18; g.beginPath(); g.arc(s / 2, s * 0.92, s * 0.62 - i * 20, Math.PI, 0); g.stroke(); });
      g.fillStyle = '#fff'; g.font = '900 64px "Segoe UI",sans-serif'; g.textAlign = 'center'; g.fillText('VERITY LIVE', s / 2, s * 0.3);
    });
    box(10, 6.5, 0.5, SXs, 3.9, SZs + 2.9, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 }));
    for (const sx of [-1, 1]) { box(0.7, 6.8, 0.7, SXs + sx * 5.2, 3.4, SZs - 2.5, M.gold, { phys: true }); box(1.1, 1.8, 1.0, SXs + sx * 3.9, 1.8, SZs - 1.5, M.iron); }
    box(11.4, 0.5, 0.7, SXs, 6.9, SZs - 2.5, M.iron, { phys: false });
    const beams = [];
    [-3.6, -1.2, 1.2, 3.6].forEach((dx, i) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.2, 16, 1, true), new THREE.MeshBasicMaterial({ color: RAINBOW[(i * 2) % 7], transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const holder = new THREE.Group(); holder.position.set(SXs + dx, 6.6, SZs - 2.4); cone.position.y = -2.6; cone.rotation.x = Math.PI; holder.add(cone); scene.add(holder); beams.push(holder);
      const lamp2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: RAINBOW[(i * 2) % 7] })); lamp2.position.set(SXs + dx, 6.55, SZs - 2.4); scene.add(lamp2);
    });
    anim.push(t => beams.forEach((b, i) => { b.rotation.x = -0.25 + Math.sin(t * 1.2 + i) * 0.18; b.rotation.z = Math.cos(t * 0.9 + i * 1.7) * 0.25; }));
    [-1, 0, 1].forEach((c, ci) => [26.4, 28.6, 30.8].forEach(z => bench(SXs + c * 4.6, z - 0.2, 0)));
    zone(SXs, 33, 9.5);
  }

  /* ----- campfire grove (south-west) ----- */
  const groveTrees = [];
  {
    const FX = -31, FZ = 31;
    const stones = [];
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), rockMat); put(s, FX + Math.cos(a) * 0.95, 0.15, FZ + Math.sin(a) * 0.95); stones.push(s); }
    for (const a of [0.4, 1.6]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8).rotateZ(Math.PI / 2), M.bark); l.rotation.y = a; put(l, FX, 0.22, FZ); }
    const flames = [];
    [[0xff5a1a, 0.55, 1.3], [0xffa21c, 0.4, 1.1], [0xffe27a, 0.25, 0.8]].forEach(([c, r, h]) => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); f.position.set(FX, 0.3 + h / 2, FZ); scene.add(f); flames.push(f);
    });
    const fl = new THREE.PointLight(0xff8a30, 5, 15, 2); fl.position.set(FX, 1.3, FZ); scene.add(fl);
    solidBody(FX, 0.3, FZ).addShape(new CANNON.Box(new CANNON.Vec3(0.8, 0.3, 0.8)));
    anim.push(t => { flames.forEach((f, i) => { f.scale.set(1 + 0.12 * Math.sin(t * 13 + i * 2), 1 + 0.25 * Math.sin(t * 9 + i * 3), 1 + 0.12 * Math.cos(t * 11 + i)); f.rotation.y = t * (2 + i); }); fl.intensity = 4.4 + Math.sin(t * 17) * 0.7 + Math.sin(t * 29) * 0.4; });
    for (let i = 0; i < 5; i++) {                                    // log seats
      const a = i / 5 * Math.PI * 2 + 0.3, x = FX + Math.cos(a) * 2.7, z = FZ + Math.sin(a) * 2.7, rot = a - Math.PI / 2;
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.9, 10).rotateZ(Math.PI / 2), M.bark); l.rotation.y = rot; put(l, x, 0.25, z, { ray: true });
      solidBody(x, 0.25, z, rot).addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.25, 0.25)));
    }
    const tentMats = [0xe8394a, 0x2d86ff, 0x3ccf5a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
    [[-36.5, 27.5, 0.6], [-38, 33.5, 1.2], [-33, 37.5, 2.6]].forEach(([x, z, a], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = a; scene.add(g);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.2, 4), tentMats[i]); tent.rotation.y = Math.PI / 4; tent.position.y = 1.1; tent.castShadow = true; g.add(tent);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), new THREE.MeshBasicMaterial({ color: 0x14100a, side: THREE.DoubleSide })); door.position.set(0, 0.65, 1.0); door.rotation.x = -0.45; g.add(door);
      rayTargets.push(tent);
      solidBody(x, 0.9, z, a + Math.PI / 4).addShape(new CANNON.Box(new CANNON.Vec3(1.15, 0.9, 1.15)));
      zone(x, z, 2.6);
    });
    for (let i = 0; i < 30; i++) {
      const a = R() * 6.28, d = 7 + R() * 7, x = FX + Math.cos(a) * d, z = FZ + Math.sin(a) * d;
      if (Math.abs(x) > 40 || Math.abs(z) > 40 || Math.hypot(x, z) < 38.5) continue;
      if (groveTrees.some(([a2, b2]) => Math.hypot(a2 - x, b2 - z) < 3.3) || [[-36.5, 27.5], [-38, 33.5], [-33, 37.5]].some(([a2, b2]) => Math.hypot(a2 - x, b2 - z) < 4)) continue;
      groveTrees.push([x, z, 1.0 + R() * 0.45, R() < 0.2 ? 2 : 0]);
    }
    zone(FX, FZ, 5);
  }

  /* ----- low hedge garden (east) ----- */
  {
    const GX = 27, GZ = -8;
    lowHedge(GX, GZ - 3.5, 7.4, 0.9); lowHedge(GX, GZ + 3.5, 7.4, 0.9); lowHedge(GX + 3.5, GZ, 0.9, 6.6);
    lowHedge(GX - 3.5, GZ - 2.4, 0.9, 2.6); lowHedge(GX - 3.5, GZ + 2.4, 0.9, 2.6);
    lowHedge(GX, GZ - 1.6, 3.2, 0.9); lowHedge(GX, GZ + 1.6, 3.2, 0.9); lowHedge(GX - 1.6, GZ, 0.9, 2.3);
    const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.9, 10), M.stone); put(bb, GX + 0.3, 0.45, GZ, { ray: true });
    const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.3, 0.2, 14), M.stone); put(bw, GX + 0.3, 1.0, GZ);
    const bwa = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), M.water); bwa.rotation.x = -Math.PI / 2; bwa.position.set(GX + 0.3, 1.095, GZ); scene.add(bwa);
    ball(0.45, GX + 0.3, 0.5, GZ);
    for (let i = 0; i < 40; i++) extraHeads.push([GX + rr(-1.1, 1.1), GZ + rr(-1.1, 1.1) + 0, R()]);
    zone(GX, GZ, 5.6);
  }

  /* ----- stepping-stone trails from the plaza to each corner feature ----- */
  {
    const stones = [], targets = [[26, 25], [-27, 26], [-26, -26], [22, -27], [24, 7], [-24, -9]];
    for (const [tx, tz] of targets) {
      const len = Math.hypot(tx, tz), dx = tx / len, dz = tz / len;
      for (let d = 9; d < len - 1; d += 1.5) {
        const x = dx * d - dz * rr(-0.25, 0.25), z = dz * d + dx * rr(-0.25, 0.25);
        if (Math.abs(Math.hypot(x, z) - 34) < 2.4 || zoneHit(x, z, -0.4) || Math.abs(x) < 2.6 || Math.abs(z) < 2.6) continue;
        stones.push([x, z, R() * 3]);
      }
    }
    const sm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.46, 0.06, 8), M.stone, stones.length), o = new THREE.Object3D();
    stones.forEach(([x, z, r], i) => { o.position.set(x, 0.035, z); o.rotation.y = r; o.scale.set(1 + R() * 0.3, 1, 1 + R() * 0.3); o.updateMatrix(); sm.setMatrixAt(i, o.matrix); });
    sm.receiveShadow = true; scene.add(sm);
  }

  /* ----- bulk trees (instanced + physics), bushes, wildflowers ----- */
  {
    const tp = [...groveTrees];
    let tries = 0;
    while (tp.length < 95 && tries++ < 4000) {
      const x = rr(-H + 3, H - 3), z = rr(-H + 3, H - 3);
      if (blocked(x, z) || zoneHit(x, z, 1.8) || Math.hypot(x, z) < 11) continue;
      if (tp.some(([a, b]) => Math.hypot(a - x, b - z) < 4.6) || treePts.some(([a, b]) => Math.hypot(a - x, b - z) < 4)) continue;
      tp.push([x, z, 0.95 + R() * 0.4, R() < 0.12 ? 1 : R() < 0.2 ? 2 : 0]);
    }
    forest(tp, true);
    tp.forEach(([x, z]) => treePts.push([x, z]));

    const bush = [];
    for (let i = 0; i < 90; i++) {                                    // hedge-line shrubs inside the fence
      const t = rr(-H + 2, H - 2), side = i % 4, off = H - 1.9;
      const x = side < 2 ? t : (side === 2 ? -off : off), z = side < 2 ? (side === 0 ? -off : off) : t;
      if (Math.abs(x) < 3.4 && Math.abs(z) < 3.4) continue;
      if ((side < 2 && Math.abs(t) < 3.4) || (side >= 2 && Math.abs(t) < 3.4)) continue;
      if (zoneHit(x, z, 0.5)) continue;
      bush.push([x, z, rr(0.7, 1.3)]);
    }
    tries = 0;
    while (bush.length < 230 && tries++ < 3000) {
      const x = rr(-H + 2, H - 2), z = rr(-H + 2, H - 2);
      if (blocked(x, z) || zoneHit(x, z, 0.8) || treePts.some(([a, b]) => Math.hypot(a - x, b - z) < 1.4)) continue;
      bush.push([x, z, rr(0.5, 1.0)]);
    }
    const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), bush.length), o = new THREE.Object3D(), c = new THREE.Color();
    bush.forEach(([x, z, s], i) => { o.position.set(x, 0.3 * s, z); o.rotation.set(R() * 3, R() * 3, 0); o.scale.set(s * 1.2, s * 0.8, s * 1.2); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); c.setHSL(0.27 + R() * 0.08, 0.5 + R() * 0.15, 0.24 + R() * 0.14); bm.setColorAt(i, c); });
    bm.castShadow = true; scene.add(bm);

    const wf = [];
    tries = 0;
    while (wf.length < 700 && tries++ < 5000) { const x = rr(-H + 1, H - 1), z = rr(-H + 1, H - 1); if (blocked(x, z) || zoneHit(x, z, 0.3)) continue; wf.push([x, z, R()]); }
    const fm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), wf.length);
    wf.forEach(([x, z, k], i) => { o.position.set(x, 0.14 + R() * 0.1, z); o.rotation.set(0, 0, 0); o.scale.setScalar(0.8 + R() * 0.8); o.updateMatrix(); fm.setMatrixAt(i, o.matrix); c.set(['#ffffff', '#ffe27a', '#ff9ecb', '#c9a8ff', '#9fd8ff', '#ff7a5c'][(k * 6) | 0]); fm.setColorAt(i, c); });
    scene.add(fm);
  }

  /* ----- butterflies ----- */
  {
    const flies = [], wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.16, 0.1, 0.05, 0.16, -0.1, 0.05], 3)); wingGeo.computeVertexNormals();
    const centers = [[-9, -14], [10, -5], [-8, 5.5], [-6, 18.5], [20, 18], [27, -8], [36, -12], [12, 30], [-12, -31], [-20, -15], [0, -22], [16, -14], [-31, 31], [31, 33]];
    centers.forEach(([cx, cz], i) => {
      const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: RAINBOW[i % 7], side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(wingGeo, mat), w2 = new THREE.Mesh(wingGeo, mat); w2.scale.x = -1; g.add(w1, w2); scene.add(g);
      flies.push({ g, w1, w2, cx, cz, ph: R() * 6, sp: rr(0.35, 0.7), rad: rr(1.5, 3.5) });
    });
    anim.push(t => flies.forEach(f => {
      const a = t * f.sp + f.ph;
      f.g.position.set(f.cx + Math.cos(a) * f.rad, 1.0 + 0.35 * Math.sin(a * 2.3) + 0.2, f.cz + Math.sin(a * 1.3) * f.rad);
      f.g.rotation.y = -a + Math.PI / 2; const fl = Math.sin(t * 18 + f.ph) * 0.9; f.w1.rotation.z = fl; f.w2.rotation.z = -fl;
    }));
  }

  /* ----- flower beds + grass tufts ----- */
  const heads = [...extraHeads], beds = [[36, -12, 2.4, 6], [-36, 12, 2.4, 6], [13, 31, 6, 2.2], [-13, -31, 6, 2.2], [20, -36, 4, 2.4], [-22, 36, 4, 2.4], [-3.5 - 4, -40, 5, 2], [-9, -14, 5, 2.4], [10, -5, 2.4, 5], [-8, 5.5, 5, 2.4], [-6, 18.5, 6, 2.2], [-20, -15, 3, 4], [20, 18, 4, 2.4]];
  beds.forEach(([x, z, w, d]) => {
    for (const [bw, bd, dx, dz] of [[w, 0.22, 0, -d / 2], [w, 0.22, 0, d / 2], [0.22, d, -w / 2, 0], [0.22, d, w / 2, 0]]) box(bw, 0.26, bd, x + dx, 0.13, z + dz, M.stone, { phys: false });
    put(new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), new THREE.MeshStandardMaterial({ color: 0x5b3d22, roughness: 1 })), x, 0.09, z, { cast: false });
    for (let i = 0; i < Math.round(w * d * 6); i++) heads.push([x + (R() - 0.5) * (w - 0.3), z + (R() - 0.5) * (d - 0.3), R()]);
  });
  {
    const hm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), heads.length);
    const sm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 4), new THREE.MeshStandardMaterial({ color: 0x3f8a35 }), heads.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    heads.forEach(([x, z, k], i) => {
      const h = 0.3 + R() * 0.2;
      o.position.set(x, 0.18 + h, z); o.scale.setScalar(0.8 + R() * 0.7); o.updateMatrix(); hm.setMatrixAt(i, o.matrix); c.set(RAINBOW[Math.min(6, (k * 7) | 0)]); hm.setColorAt(i, c);
      o.position.set(x, 0.18 + h / 2, z); o.scale.set(1, h / 0.34, 1); o.updateMatrix(); sm.setMatrixAt(i, o.matrix);
    });
    scene.add(hm, sm);
  }
  {
    const N = 16000, gm = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.42, 4).translate(0, 0.21, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), N);
    const o = new THREE.Object3D(), c = new THREE.Color(); let n = 0;
    while (n < N) {
      const x = (R() * 2 - 1) * (H - 1), z = (R() * 2 - 1) * (H - 1); if (blocked(x, z)) continue;
      o.position.set(x, 0, z); o.rotation.set((R() - 0.5) * 0.4, R() * 6, (R() - 0.5) * 0.4); o.scale.set(1, 0.7 + R() * 1.1, 1); o.updateMatrix(); gm.setMatrixAt(n, o.matrix);
      c.setHSL(0.24 + R() * 0.08, 0.5 + R() * 0.2, 0.3 + R() * 0.2); gm.setColorAt(n, c); n++;
    }
    scene.add(gm);
  }

  /* ----- clouds ----- */
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.93, fog: false });
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), m); s.scale.set(5 + R() * 4, 2.4 + R() * 1.4, 3.5 + R() * 2); s.position.set((k - 2) * 5 + R() * 3, R() * 1.5, R() * 3); g.add(s); }
    g.position.set(rr(-140, 140), rr(42, 66), rr(-140, 140)); scene.add(g); clouds.push(g);
  }
  anim.push((t, dt) => { for (const c of clouds) { c.position.x += dt * 1.1; if (c.position.x > 150) c.position.x = -150; } });

  /* ----- dynamic crates (shoot them to shove them around) ----- */
  const crateTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#d9a441'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#8a5a14'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
    g.lineWidth = 6; g.beginPath(); g.moveTo(6, 6); g.lineTo(s - 6, s - 6); g.moveTo(s - 6, 6); g.lineTo(6, s - 6); g.stroke();
  });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.75 });
  const cGeo = new THREE.BoxGeometry(1, 1, 1);
  [[6, -7], [-6, 8.5], [-4, -12], [12, 0.5], [-12, 2.5], [4, 8], [-7, 13], [0.8, -8.5], [9, -15], [-28, -10], [27, 18], [-27, 20], [20, -27], [-20, -29], [33, 10], [-33, 6], [14, 27], [-16, 29], [8, -30], [-8, 31], [34, -14], [-24, 10]].forEach(([x, z], i) => {
    const s = 0.8 + (i % 3) * 0.2;
    const m = new THREE.Mesh(cGeo, crateMat); m.scale.setScalar(s);
    m.position.set(x, s / 2 + 0.01, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    const b = new CANNON.Body({ mass: 6 * s * s * s, shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1, linearDamping: 0.25, angularDamping: 0.35 });
    b.position.set(x, s / 2 + 0.01, z); world.addBody(b);
    m.userData.body = b; crates.push({ mesh: m, body: b }); rayTargets.push(m);
  });

  /* ----- SUPPLY STATION: walk up and press F to buy ammo + weapon upgrades ----- */
  const SX = -14.5, SZ = 0;
  const st = new THREE.Group(); st.position.set(SX, 0, SZ); st.rotation.y = Math.PI / 2; scene.add(st);   // faces +X (toward the park)
  const steel = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.35, metalness: 0.2 });
  const gold = M.gold;
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.0), steel); pedestal.position.y = 0.55; pedestal.castShadow = pedestal.receiveShadow = true; st.add(pedestal);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 1.1), gold); trim.position.y = 1.12; st.add(trim);
  const baseP = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.1, 40), gold); baseP.position.y = 0.05; baseP.receiveShadow = true; st.add(baseP);
  const screenTex = canvasTex(256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#0e2a66'); gr.addColorStop(1, '#061230'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#ffc233'; g.lineWidth = 8; g.strokeRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#ffc233'; g.font = '900 54px "Segoe UI",sans-serif'; g.textAlign = 'center'; g.fillText('SUPPLY', s / 2, 100);
    g.fillStyle = '#fff'; g.font = '700 40px "Segoe UI",sans-serif'; g.fillText('STATION', s / 2, 150);
    g.fillStyle = '#7fd0ff'; g.font = '700 30px "Segoe UI",sans-serif'; g.fillText('AMMO + UPGRADES', s / 2, 205);
  });
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 0.12), new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.9, roughness: 0.3 }));
  screen.position.set(0, 2.0, 0.15); screen.rotation.x = -0.12; screen.castShadow = true; st.add(screen);
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 12, 40), gold); ringMesh.position.set(0, 3.35, 0.15); st.add(ringMesh);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0xffe28a, emissive: 0xffb81c, emissiveIntensity: 1.6, roughness: 0.1 })); gem.position.copy(ringMesh.position); st.add(gem);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 7; st.add(beam);
  const padRing = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.9, 48), new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  padRing.rotation.x = -Math.PI / 2; padRing.position.y = 0.12; st.add(padRing);
  const sLight = new THREE.PointLight(0xffc860, 6, 9, 2); sLight.position.set(0, 2.6, 1.4); st.add(sLight);
  rayTargets.push(pedestal);
  const sb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.9, 1.0)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1 });
  sb.position.set(SX, 0.9, SZ); world.addBody(sb);
  let lastT = 0;
  const station = {
    pos: new THREE.Vector3(SX + 1.6, 0, SZ), radius: 3.6,
    update(t) {
      const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
      ringMesh.rotation.y = t * 1.4; gem.rotation.y = -t * 2; gem.position.y = 3.35 + Math.sin(t * 2) * 0.08;
      beam.material.opacity = 0.13 + 0.05 * Math.sin(t * 3); padRing.material.opacity = 0.55 + 0.3 * Math.sin(t * 3 + 1);
      for (const f of anim) f(t, dt);          // fountain, swings, merry-go-round, clouds...
    },
  };

  return {
    rayTargets, crates, station,
    noSpawn: (x, z) => zoneHit(x, z, 0.5),
    sync() { for (const c of crates) { c.mesh.position.copy(c.body.position); c.mesh.quaternion.copy(c.body.quaternion); } },
  };
}
