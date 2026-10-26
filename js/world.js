import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const GROUP = { WORLD: 1, PLAYER: 2, ENEMY: 4, DEBRIS: 8 };
export const ARENA = 26; // half-size of the arena

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

export function buildWorld(scene, world, mats) {
  const rayTargets = [];     // meshes bullets can hit
  const crates = [];         // dynamic, pushable
  const H = ARENA;

  /* ----- sky + fog ----- */
  const sky = canvasTex(512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#5b9bff'); gr.addColorStop(0.45, '#bfe0ff'); gr.addColorStop(0.5, '#fff1d6'); gr.addColorStop(1, '#e9d9bd');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  scene.fog = new THREE.Fog(0xe4eaf5, 30, 95);

  /* ----- lights ----- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b89a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.position.set(18, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -H - 4, right: H + 4, top: H + 4, bottom: -H - 4, near: 1, far: 90 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);

  /* ----- floor ----- */
  const floorTex = canvasTex(512, (g, s) => {
    g.fillStyle = '#f4efe4'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ebe4d4'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
    g.strokeStyle = 'rgba(120,100,60,.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.strokeStyle = 'rgba(120,100,60,.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, [H, H]);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 2, H * 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.0 }));
  floor.position.y = -1; floor.receiveShadow = true;
  scene.add(floor); rayTargets.push(floor);
  const fb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(H, 1, H)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1 });
  fb.position.set(0, -1, 0); world.addBody(fb);

  /* ----- rainbow ring decal on the floor (Verity colours) ----- */
  const rainbow = ['#ff3b4e', '#ff7a1c', '#ffc81c', '#3ccf5a', '#2d86ff', '#4a5cff', '#a04cff'];
  rainbow.forEach((c, i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2 + i * 0.35, 3.2 + i * 0.35 + 0.33, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; scene.add(ring);
  });

  /* ----- walls ----- */
  const wallTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, s, s);
    const w = s / 7; rainbow.forEach((c, i) => { g.fillStyle = c; g.globalAlpha = 0.85; g.fillRect(i * w, s - 34, w, 14); });
    g.globalAlpha = 1; g.fillStyle = 'rgba(120,100,60,.18)'; g.fillRect(0, 0, s, 6); g.fillRect(0, 0, 3, s);
  }, [10, 1]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7 });
  const addStatic = (w, h, d, x, y, z, mat, ray = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); if (ray) rayTargets.push(m);
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1 });
    b.position.set(x, y, z); world.addBody(b);
    return m;
  };
  const WH = 7;
  const mk = (rx, rz) => { const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(rx, 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }); };
  addStatic(H * 2 + 2, WH, 1, 0, WH / 2, -H - 0.5, mk(10)); addStatic(H * 2 + 2, WH, 1, 0, WH / 2, H + 0.5, mk(10));
  addStatic(1, WH, H * 2 + 2, -H - 0.5, WH / 2, 0, mk(10)); addStatic(1, WH, H * 2 + 2, H + 0.5, WH / 2, 0, mk(10));

  /* ----- pillars ----- */
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.5 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9971a, metalness: 0.9, roughness: 0.3 });
  [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -17], [0, 17], [-18, 0], [18, 0]].forEach(([x, z]) => {
    addStatic(2.2, 5, 2.2, x, 2.5, z, pillarMat);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.25, 2.5), goldMat); cap.position.set(x, 5.12, z); cap.castShadow = true; scene.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.25, 2.5), goldMat); base.position.set(x, 0.12, z); base.castShadow = true; scene.add(base);
  });

  /* ----- low cover blocks (static) ----- */
  const coverMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
  [[-6, 5, 4, 1.1, 1.2], [7, -6, 1.2, 1.1, 4.5], [6, 8, 3, 1.1, 1.2], [-8, -4, 1.2, 1.1, 3.5]].forEach(([x, z, w, h, d]) => addStatic(w, h, d, x, h / 2, z, coverMat));

  /* ----- dynamic crates (shoot them to shove them around) ----- */
  const crateTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#d9a441'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#8a5a14'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
    g.lineWidth = 6; g.beginPath(); g.moveTo(6, 6); g.lineTo(s - 6, s - 6); g.moveTo(s - 6, 6); g.lineTo(6, s - 6); g.stroke();
  });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.75 });
  const cGeo = new THREE.BoxGeometry(1, 1, 1);
  const spots = [[3, 4], [-3, 7], [5, -3], [-5, -8], [9, 3], [-10, 3], [2, -9], [-2, 11], [10, -10], [-9, 9]];
  spots.forEach(([x, z], i) => {
    const s = 0.8 + (i % 3) * 0.2;
    const m = new THREE.Mesh(cGeo, crateMat); m.scale.setScalar(s);
    m.position.set(x, s / 2 + 0.01, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    const b = new CANNON.Body({ mass: 6 * s * s * s, shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), material: mats.solid, collisionFilterGroup: GROUP.WORLD, collisionFilterMask: -1, linearDamping: 0.25, angularDamping: 0.35 });
    b.position.set(x, s / 2 + 0.01, z); world.addBody(b);
    m.userData.body = b; crates.push({ mesh: m, body: b }); rayTargets.push(m);
  });

  return {
    rayTargets, crates,
    sync() { for (const c of crates) { c.mesh.position.copy(c.body.position); c.mesh.quaternion.copy(c.body.quaternion); } },
  };
}
