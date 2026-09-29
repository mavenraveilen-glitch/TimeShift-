(function () {
'use strict';

/* ============================================================
   TimeShift 3D — satu dunia 3D konsisten yang mengikuti waktu
   lokal pengguna. Vanilla JS + Three.js r128 (non-module).
   ============================================================ */

// ---------- Util ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(1337);

// ---------- Value noise + fbm (deterministik, untuk terrain) ----------
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}
function fbm(x, z, oct) {
  let v = 0, amp = 1, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, z * f) * amp; tot += amp; amp *= 0.5; f *= 2.1; }
  return v / tot;
}

// ---------- Deteksi perangkat & konfigurasi performa ----------
const isMobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;
const Q = isMobile
  ? { terrainSeg: 96, trees: 70, rocks: 26, bushes: 140, stars: 900,  fireflies: 70,  clouds: 12, shadow: 1024, pr: 1.6 }
  : { terrainSeg: 160, trees: 150, rocks: 55, bushes: 320, stars: 2200, fireflies: 130, clouds: 20, shadow: 2048, pr: 2.0 };

// ---------- Renderer / Scene / Camera ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('webgl-fail').hidden = false;
  document.getElementById('loader').classList.add('done');
  return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1020, 0.003);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2200);

// ---------- Kustom orbit controls (drag / wheel / pinch, inertia + drift) ----------
const camState = { theta: -Math.PI / 2, phi: 1.22, radius: 58, target: new THREE.Vector3(0, 4, 0) };
const camGoal  = { theta: -Math.PI / 2, phi: 1.22, radius: 58 };
const camVel   = { theta: 0, phi: 0, radius: 0 }; // inertia on release → no laggy stop
let lastInteract = -10;
let idleT = 0;
let dragging = false;

function applyCamera(dt) {
  const now = performance.now() / 1000;
  // apply residual velocity when not actively dragging (smooth slide)
  if (!dragging) {
    camGoal.theta += camVel.theta * dt;
    camGoal.phi = clamp(camGoal.phi + camVel.phi * dt, 0.32, 1.48);
    camGoal.radius = clamp(camGoal.radius + camVel.radius * dt, 18, 150);
    const damp = Math.exp(-5.5 * dt);
    camVel.theta *= damp;
    camVel.phi *= damp;
    camVel.radius *= damp;
  } else {
    camVel.theta *= 0.6;
    camVel.phi *= 0.6;
    camVel.radius *= 0.6;
  }
  // cinematic drift saat idle
  if (now - lastInteract > 4) idleT += dt; else idleT = 0;
  const drift = Math.min(idleT / 6, 1) * 0.018;
  camGoal.theta += drift * dt;
  // softer exponential smoothing — less rubber-band lag
  const k = 1 - Math.pow(0.0004, dt);
  camState.theta += (camGoal.theta - camState.theta) * k;
  camState.phi   += (camGoal.phi   - camState.phi)   * k;
  camState.radius+= (camGoal.radius- camState.radius)* k;
  const sp = Math.sin(camState.phi), cp = Math.cos(camState.phi);
  camera.position.set(
    camState.target.x + camState.radius * sp * Math.sin(camState.theta),
    camState.target.y + camState.radius * cp,
    camState.target.z + camState.radius * sp * Math.cos(camState.theta)
  );
  camera.position.y += Math.sin(now * 0.4) * 0.12 * Math.min(idleT, 1);
  camera.lookAt(camState.target);
}

const pointers = new Map();
let pinchDist = 0;
const dom = renderer.domElement;
dom.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const p = [...pointers.values()];
    pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  dragging = true;
  lastInteract = performance.now() / 1000;
  try { dom.setPointerCapture(e.pointerId); } catch (_) {}
});
dom.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInteract = performance.now() / 1000;
  if (pointers.size === 1) {
    const dTh = -dx * 0.005;
    const dPh = -dy * 0.0035;
    camGoal.theta += dTh;
    camGoal.phi = clamp(camGoal.phi + dPh, 0.32, 1.48);
    // accumulate velocity for inertia (pixels → rad/s estimate)
    camVel.theta = dTh * 55;
    camVel.phi = dPh * 55;
  } else if (pointers.size === 2) {
    const p = [...pointers.values()];
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    if (pinchDist > 0) {
      const ratio = pinchDist / d;
      const next = clamp(camGoal.radius * ratio, 18, 150);
      camVel.radius = (next - camGoal.radius) * 40;
      camGoal.radius = next;
    }
    pinchDist = d;
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) { dragging = false; pinchDist = 0; }
  else if (pointers.size === 1) pinchDist = 0;
};
dom.addEventListener('pointerup', endPointer);
dom.addEventListener('pointercancel', endPointer);
dom.addEventListener('wheel', (e) => {
  e.preventDefault();
  const next = clamp(camGoal.radius * (1 + e.deltaY * 0.00085), 18, 150);
  camVel.radius = (next - camGoal.radius) * 30;
  camGoal.radius = next;
  lastInteract = performance.now() / 1000;
}, { passive: false });

// ---------- Terrain height function (dipakai banyak objek) ----------
const LAKE = { x: 22, z: 20, r: 12 };
function terrainH(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm(x * 0.018, z * 0.018, 5) * 16 + fbm(x * 0.06, z * 0.06, 3) * 3.5;
  const flat = sstep(14, 46, d);                 // datar & landai di tengah
  h = h * flat + 1.6 * (1 - flat);
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z); // cekungan danau
  const lm = 1 - sstep(5.5, LAKE.r + 1.5, ld);
  h = h * (1 - lm) + (-1.6) * lm;
  return h;
}

// ---------- Langit (shader gradient + glow matahari) ----------
const skyUniforms = {
  uTop:     { value: new THREE.Color(0x060a1a) },
  uHorizon: { value: new THREE.Color(0x0b1226) },
  uFog:     { value: new THREE.Color(0x0a1020) },
  uSunDir:  { value: new THREE.Vector3(1, 0.1, 0) },
  uSunColor:{ value: new THREE.Color(0xffd9a0) },
  uSunI:    { value: 0.0 }
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_Position.z = gl_Position.w; // selalu paling jauh
    }`,
  fragmentShader: `
    uniform vec3 uTop, uHorizon, uFog, uSunColor;
    uniform vec3 uSunDir;
    uniform float uSunI;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = max(d.y, 0.0);
      vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
      float s = max(dot(d, normalize(uSunDir)), 0.0);
      col += uSunColor * (pow(s, 900.0) * 2.2 + pow(s, 24.0) * 0.38 + pow(s, 5.0) * 0.12) * uSunI;
      col = mix(uFog, col, smoothstep(-0.06, 0.14, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 20), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// ---------- Matahari & Bulan (sprite glow + disc) ----------
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,240,210,1)', 'rgba(255,170,90,0.35)'),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
}));
sunGlow.scale.set(260, 260, 1);
scene.add(sunGlow);

const moonGroup = new THREE.Group();
const moonDisc = new THREE.Mesh(
  new THREE.CircleGeometry(16, 32),
  new THREE.MeshBasicMaterial({ color: 0xe8ecf7, fog: false, transparent: true })
);
moonGroup.add(moonDisc);
const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(220,230,255,0.9)', 'rgba(160,180,255,0.18)'),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
}));
moonGlow.scale.set(130, 130, 1);
moonGroup.add(moonGlow);
scene.add(moonGroup);

// ---------- Bintang ----------
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(Q.stars * 3);
  for (let i = 0; i < Q.stars; i++) {
    // distribusi di hemisphere atas
    const u = rng(), v = rng();
    const th = 2 * Math.PI * u, ph = Math.acos(1 - v * 0.95);
    const r = 940;
    pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) + 20;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({
  color: 0xdfe8ff, size: 1.6, sizeAttenuation: false,
  transparent: true, opacity: 0, depthWrite: false, fog: false
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

// ---------- Lampu utama (dir + hemi) ----------
const dirLight = new THREE.DirectionalLight(0xffd9a0, 1.6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(Q.shadow, Q.shadow);
dirLight.shadow.camera.near = 10; dirLight.shadow.camera.far = 500;
const sc = 130;
dirLight.shadow.camera.left = -sc; dirLight.shadow.camera.right = sc;
dirLight.shadow.camera.top = sc; dirLight.shadow.camera.bottom = -sc;
dirLight.shadow.bias = -0.0008;
dirLight.shadow.normalBias = 0.04;
dirLight.shadow.autoUpdate = true; // toggled off when env settles (perf)
scene.add(dirLight);
scene.add(dirLight.target);

const hemi = new THREE.HemisphereLight(0x9db8dd, 0x3a4a35, 0.5);
scene.add(hemi);

// ---------- Terrain ----------
const TER = 320;
const terGeo = new THREE.PlaneGeometry(TER, TER, Q.terrainSeg, Q.terrainSeg);
terGeo.rotateX(-Math.PI / 2);
{
  const p = terGeo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const cGrass = new THREE.Color(0x4d7c38), cGrass2 = new THREE.Color(0x6b8f3e);
  const cDirt = new THREE.Color(0x6f6248), cRock = new THREE.Color(0x6d6a66), cSand = new THREE.Color(0x9a8a63);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = terrainH(x, z);
    p.setY(i, h);
    // warna berdasar ketinggian + noise
    const n = fbm(x * 0.08 + 40, z * 0.08, 3) * 0.5 + 0.5;
    tmp.copy(cGrass).lerp(cGrass2, n);
    if (h < 0.6) tmp.lerp(cSand, sstep(0.6, -0.6, h) * 0.7);       // tepi danau
    if (h > 7)  tmp.lerp(cRock, sstep(7, 13, h) * 0.8);          // batuan tinggi
    if (h < 1.2 && h > 0.3) tmp.lerp(cDirt, 0.25 * n);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  terGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terGeo.computeVertexNormals();
}
const terMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 });
const terrain = new THREE.Mesh(terGeo, terMat);
terrain.receiveShadow = true;
scene.add(terrain);

// ---------- Pegunungan (dua ridge untuk atmospheric perspective) ----------
function makeRidge(count, rMin, rMax, hMin, hMax, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.3;
    const r = lerp(rMin, rMax, rng());
    const h = lerp(hMin, hMax, rng());
    const rad = h * lerp(0.7, 1.1, rng());
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 5 + Math.floor(rng() * 3), 1), mat);
    m.position.set(Math.cos(a) * r, h * 0.32, Math.sin(a) * r);
    m.rotation.y = rng() * Math.PI;
    m.scale.z = lerp(0.5, 0.8, rng());
    g.add(m);
  }
  return g;
}
scene.add(makeRidge(isMobile ? 12 : 18, 250, 330, 70, 150, 0x5a6478));   // ridge dekat (lebih gelap)
scene.add(makeRidge(isMobile ? 10 : 16, 380, 480, 120, 260, 0x7a86a0));  // ridge jauh (terang oleh haze)

// ---------- Danau ----------
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x1a4560, roughness: 0.06, metalness: 0.88,
  transparent: true, opacity: 0.92
});
const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r - 0.5, 40), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.set(LAKE.x, 0.12, LAKE.z);
scene.add(water);
// pantulan cahaya di permukaan air (fake specular streak)
const waterGlint = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0.08)'),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
}));
waterGlint.scale.set(26, 7, 1);
waterGlint.position.set(LAKE.x, 0.6, LAKE.z);
scene.add(waterGlint);

// ---------- Pohon (instanced, sway via onBeforeCompile) ----------
const uTime = { value: 0 };
function addSway(mat, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float wx = instanceMatrix[3][0]; float wz = instanceMatrix[3][2];
        float sw = max(position.y, 0.0) * ${strength.toFixed(3)};
        transformed.x += sin(uTime * 1.4 + wx * 0.35 + wz * 0.27) * sw;
        transformed.z += cos(uTime * 1.05 + wx * 0.31) * sw * 0.6;
      #endif`
    );
  };
}
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 2.6, 6);
trunkGeo.translate(0, 1.3, 0);
// layered canopy for richer silhouette (still instanced / cheap)
const canopyGeoA = new THREE.ConeGeometry(2.05, 4.4, 7);
canopyGeoA.translate(0, 4.55, 0);
const canopyGeoB = new THREE.ConeGeometry(1.45, 3.4, 7);
canopyGeoB.translate(0, 6.35, 0);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 });
const canopyMatA = new THREE.MeshStandardMaterial({ color: 0x2c5828, roughness: 0.88 });
const canopyMatB = new THREE.MeshStandardMaterial({ color: 0x3a6e32, roughness: 0.86 });
addSway(canopyMatA, 0.032);
addSway(canopyMatB, 0.042);
const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Q.trees);
const canopiesA = new THREE.InstancedMesh(canopyGeoA, canopyMatA, Q.trees);
const canopiesB = new THREE.InstancedMesh(canopyGeoB, canopyMatB, Q.trees);
trunks.castShadow = canopiesA.castShadow = canopiesB.castShadow = true;
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  let placed = 0, guard = 0;
  while (placed < Q.trees && guard++ < Q.trees * 30) {
    const a = rng() * Math.PI * 2, r = 24 + rng() * 130;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) continue;
    const sc3 = 0.7 + rng() * 1.0;
    q.setFromAxisAngle(axisY, rng() * Math.PI * 2);
    s.set(sc3, sc3 * (0.85 + rng() * 0.4), sc3);
    v.set(x, terrainH(x, z) - 0.15, z);
    m.compose(v, q, s);
    trunks.setMatrixAt(placed, m);
    canopiesA.setMatrixAt(placed, m);
    canopiesB.setMatrixAt(placed, m);
    placed++;
  }
}
scene.add(trunks, canopiesA, canopiesB);

// ---------- Batu ----------
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x7b7a74, roughness: 1, flatShading: true });
const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Q.rocks);
rocks.castShadow = true; rocks.receiveShadow = true;
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const e = new THREE.Euler();
  for (let i = 0; i < Q.rocks; i++) {
    const a = rng() * Math.PI * 2, r = 12 + rng() * 140;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sc3 = 0.3 + rng() * 1.4;
    e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    q.setFromEuler(e);
    s.set(sc3 * (0.7 + rng() * 0.6), sc3 * (0.5 + rng() * 0.5), sc3 * (0.7 + rng() * 0.6));
    v.set(x, terrainH(x, z) + 0.05, z);
    m.compose(v, q, s);
    rocks.setMatrixAt(i, m);
  }
}
scene.add(rocks);

// ---------- Semak / rumput tinggi ----------
const bushGeo = new THREE.ConeGeometry(0.55, 1.1, 6);
bushGeo.translate(0, 0.5, 0);
const bushMat = new THREE.MeshStandardMaterial({ color: 0x3c6b2f, roughness: 1 });
addSway(bushMat, 0.06);
const bushes = new THREE.InstancedMesh(bushGeo, bushMat, Q.bushes);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < Q.bushes; i++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
    const sc3 = 0.5 + rng() * 0.9;
    q.setFromAxisAngle(axisY, rng() * Math.PI * 2);
    s.set(sc3, sc3, sc3);
    v.set(x, terrainH(x, z) - 0.05, z);
    m.compose(v, q, s);
    bushes.setMatrixAt(i, m);
  }
}
scene.add(bushes);

// ---------- Jalan setapak (ribbon mengikuti terrain) ----------
const HOUSE_POS = new THREE.Vector3(-14, 0, -16);
HOUSE_POS.y = terrainH(HOUSE_POS.x, HOUSE_POS.z);
{
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-52, 0, 30),
    new THREE.Vector3(-30, 0, 8),
    new THREE.Vector3(-22, 0, -6),
    new THREE.Vector3(HOUSE_POS.x + 4, 0, HOUSE_POS.z + 4)
  ]);
  const N = 64, W = 2.3;
  const pos = [], idx = [];
  const pt = new THREE.Vector3(), tan = new THREE.Vector3(), perp = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.getPoint(t, pt); curve.getTangent(t, tan);
    perp.set(-tan.z, 0, tan.x).normalize().multiplyScalar(W / 2);
    const lx = pt.x - perp.x, lz = pt.z - perp.z;
    const rx = pt.x + perp.x, rz = pt.z + perp.z;
    pos.push(lx, terrainH(lx, lz) + 0.07, lz, rx, terrainH(rx, rz) + 0.07, rz);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const pathMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x77664c, roughness: 1 }));
  pathMesh.receiveShadow = true;
  scene.add(pathMesh);
}

// ---------- Observatory / rumah modern ----------
const houseGroup = new THREE.Group();
houseGroup.position.copy(HOUSE_POS);
{
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d5cf, roughness: 0.55, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 2.4, 24), wallMat);
  base.position.y = 1.2; base.castShadow = base.receiveShadow = true;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 2.6, 24), wallMat);
  upper.position.y = 3.7; upper.castShadow = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
  dome.position.y = 5.0; dome.castShadow = true;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.6, 3.5), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.3, metalness: 0.7 }));
  slit.position.set(0, 6.2, 1.2);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.3, 24), darkMat);
  deck.position.y = 0.15; deck.receiveShadow = true;
  houseGroup.add(base, upper, dome, slit, deck);
}
// jendela (emissive saat malam)
const windowMat = new THREE.MeshBasicMaterial({ color: 0x232630 });
{
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), windowMat);
    w.position.set(Math.cos(a) * 5.55, 1.5, Math.sin(a) * 5.55);
    w.lookAt(w.position.clone().multiplyScalar(2).setY(1.5));
    houseGroup.add(w);
  }
  const topWin = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), windowMat);
  topWin.position.set(0, 3.9, 4.25);
  houseGroup.add(topWin);
}
scene.add(houseGroup);
const houseLight = new THREE.PointLight(0xffc687, 0, 26, 2);
houseLight.position.set(HOUSE_POS.x, HOUSE_POS.y + 3.4, HOUSE_POS.z);
scene.add(houseLight);

// ---------- Lampu outdoor di sepanjang jalan ----------
const lampLights = [], lampGlows = [];
{
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.5, metalness: 0.7 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x39322a });
  const spots = [[-30, 8], [-22, -6], [-9, -11]];
  for (const [x, z] of spots) {
    const y = terrainH(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.6, 8), postMat);
    post.position.set(x, y + 1.3, z); post.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat.clone());
    bulb.position.set(x, y + 2.7, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,205,140,0.95)', 'rgba(255,160,70,0.25)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
    }));
    glow.scale.set(5, 5, 1);
    glow.position.copy(bulb.position);
    const pl = new THREE.PointLight(0xffb46b, 0, 16, 2);
    pl.position.copy(bulb.position);
    lampLights.push(pl); lampGlows.push(glow);
    scene.add(post, bulb, glow, pl);
  }
}

// ---------- Awan (sprite canvas, drift) ----------
function makeCloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const x = 40 + rng() * 176, y = 45 + rng() * 45, r = 16 + rng() * 30;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}
const cloudTex = makeCloudTexture();
const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false });
const clouds = [];
for (let i = 0; i < Q.clouds; i++) {
  const sp = new THREE.Sprite(cloudMat.clone());
  const w = 70 + rng() * 90;
  sp.scale.set(w, w * 0.42, 1);
  sp.position.set((rng() - 0.5) * 700, 95 + rng() * 70, (rng() - 0.5) * 700);
  sp.material.opacity = 0.35 + rng() * 0.4;
  sp.userData.speed = 1.2 + rng() * 1.8;
  clouds.push(sp); scene.add(sp);
}

// ---------- Burung (siang) ----------
const birdsGroup = new THREE.Group();
const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c2230, side: THREE.DoubleSide });
const birds = [];
{
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.6, 0.25, -0.4, 1.6, 0.25, 0.4], 3));
  wingGeo.computeVertexNormals();
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group();
    const wl = new THREE.Mesh(wingGeo, birdMat);
    const wr = new THREE.Mesh(wingGeo, birdMat);
    wr.scale.x = -1;
    b.add(wl, wr);
    b.userData = { wl, wr, r: 55 + rng() * 45, h: 38 + rng() * 26, sp: 0.14 + rng() * 0.1, ph: rng() * Math.PI * 2, fph: rng() * 10 };
    birds.push(b); birdsGroup.add(b);
  }
}
scene.add(birdsGroup);

// ---------- Kunang-kunang (malam) ----------
const ffGeo = new THREE.BufferGeometry();
const ffBase = new Float32Array(Q.fireflies * 3);
{
  const pos = new Float32Array(Q.fireflies * 3);
  for (let i = 0; i < Q.fireflies; i++) {
    const a = rng() * Math.PI * 2, r = 10 + rng() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = terrainH(x, z) + 0.6 + rng() * 2.2;
    pos[i * 3] = ffBase[i * 3] = x;
    pos[i * 3 + 1] = ffBase[i * 3 + 1] = y;
    pos[i * 3 + 2] = ffBase[i * 3 + 2] = z;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const ffMat = new THREE.PointsMaterial({
  color: 0xd8ff9a, size: 0.35, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false
});
const fireflies = new THREE.Points(ffGeo, ffMat);
scene.add(fireflies);

/* ============================================================
   SISTEM WAKTU — keyframes lingkungan diinterpolasi mulus
   sepanjang 24 jam (satu dunia, transisi cinematic)
   ============================================================ */
const C = (h) => new THREE.Color(h);
const ENV_KEYS = [
  // h, elevasi matahari (°), warna langit atas/horizon, warna & intensitas matahari,
  // hemi, fog, exposure, bintang, lampu, awan, bulan
  { h: 0.0,  elev: -52, top: C(0x050a1c), hor: C(0x0d1428), sunC: C(0x28345c), sunI: 0.00, hs: C(0x1c2745), hg: C(0x0b0f16), hi: 0.34, fog: C(0x0a1122), fogD: 0.0034, exp: 1.02, stars: 1.00, lamps: 1.00, cloud: C(0x141b30), moon: 1 },
  { h: 4.5,  elev: -46, top: C(0x0a1230), hor: C(0x1c1a3a), sunC: C(0x3a3a6a), sunI: 0.02, hs: C(0x232c4e), hg: C(0x0e1218), hi: 0.36, fog: C(0x101530), fogD: 0.0036, exp: 1.03, stars: 0.95, lamps: 1.00, cloud: C(0x1c2140), moon: 1 },
  { h: 5.6,  elev: -8,  top: C(0x24386e), hor: C(0xb06278), sunC: C(0xff9a70), sunI: 0.28, hs: C(0x3a4a78), hg: C(0x241f22), hi: 0.42, fog: C(0x5c4a60), fogD: 0.0042, exp: 1.05, stars: 0.30, lamps: 0.90, cloud: C(0x8a5f78), moon: 0.4 },
  { h: 6.6,  elev: 6,   top: C(0x3f6fb8), hor: C(0xffb877), sunC: C(0xffd9a0), sunI: 1.55, hs: C(0x7a92c0), hg: C(0x4a4438), hi: 0.50, fog: C(0xd9b49a), fogD: 0.0044, exp: 1.08, stars: 0.04, lamps: 0.55, cloud: C(0xf3c9a2), moon: 0 },
  { h: 8.5,  elev: 22,  top: C(0x3a7bd0), hor: C(0xbcd8ee), sunC: C(0xfff0d0), sunI: 2.10, hs: C(0x9cbce4), hg: C(0x55604a), hi: 0.55, fog: C(0xcfe0ec), fogD: 0.0026, exp: 1.10, stars: 0.00, lamps: 0.10, cloud: C(0xffffff), moon: 0 },
  { h: 13.0, elev: 62,  top: C(0x2f6fd0), hor: C(0xaed0ea), sunC: C(0xfff6e8), sunI: 2.60, hs: C(0xa8c8ec), hg: C(0x5c6850), hi: 0.58, fog: C(0xc4d8ea), fogD: 0.0016, exp: 1.12, stars: 0.00, lamps: 0.00, cloud: C(0xffffff), moon: 0 },
  { h: 16.0, elev: 32,  top: C(0x3372c6), hor: C(0xc2d2e2), sunC: C(0xffedc8), sunI: 2.25, hs: C(0x9cb8dc), hg: C(0x585f48), hi: 0.55, fog: C(0xcad6e2), fogD: 0.0020, exp: 1.10, stars: 0.00, lamps: 0.05, cloud: C(0xfdf6ea), moon: 0 },
  { h: 17.4, elev: 12,  top: C(0x4a5aa0), hor: C(0xff9550), sunC: C(0xffb066), sunI: 1.75, hs: C(0x8a7aa8), hg: C(0x5a4638), hi: 0.48, fog: C(0xe0a880), fogD: 0.0030, exp: 1.08, stars: 0.02, lamps: 0.35, cloud: C(0xffbf90), moon: 0 },
  { h: 18.4, elev: -1,  top: C(0x3a3570), hor: C(0xd06a8e), sunC: C(0xff7a50), sunI: 0.75, hs: C(0x5c4a80), hg: C(0x3c2c34), hi: 0.42, fog: C(0x9a6a80), fogD: 0.0037, exp: 1.06, stars: 0.25, lamps: 0.85, cloud: C(0xe08aa0), moon: 0.1 },
  { h: 19.6, elev: -14, top: C(0x141c3e), hor: C(0x51406e), sunC: C(0x8a5a70), sunI: 0.04, hs: C(0x2c3458), hg: C(0x14141e), hi: 0.38, fog: C(0x1c2038), fogD: 0.0034, exp: 1.04, stars: 0.70, lamps: 1.00, cloud: C(0x3a3454), moon: 0.7 },
  { h: 21.5, elev: -34, top: C(0x070d20), hor: C(0x101830), sunC: C(0x28345c), sunI: 0.00, hs: C(0x1e2848), hg: C(0x0c1016), hi: 0.35, fog: C(0x0c1226), fogD: 0.0033, exp: 1.02, stars: 1.00, lamps: 1.00, cloud: C(0x161d34), moon: 1 },
  { h: 24.0, elev: -52, top: C(0x050a1c), hor: C(0x0d1428), sunC: C(0x28345c), sunI: 0.00, hs: C(0x1c2745), hg: C(0x0b0f16), hi: 0.34, fog: C(0x0a1122), fogD: 0.0034, exp: 1.02, stars: 1.00, lamps: 1.00, cloud: C(0x141b30), moon: 1 }
];

const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function sampleEnv(hour) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < ENV_KEYS.length - 2 && ENV_KEYS[i + 1].h <= hour) i++;
  const a = ENV_KEYS[i], b = ENV_KEYS[i + 1];
  let t = (hour - a.h) / (b.h - a.h);
  t = t * t * (3 - 2 * t); // smoothstep untuk transisi sinematik
  const L = (x, y) => lerp(x, y, t);
  const LC = (ca, cb, out) => out.copy(ca).lerp(cb, t);
  return {
    elev: L(a.elev, b.elev),
    top: LC(a.top, b.top, _c1.clone()),
    hor: LC(a.hor, b.hor, _c2.clone()),
    sunC: LC(a.sunC, b.sunC, new THREE.Color()),
    sunI: L(a.sunI, b.sunI),
    hs: LC(a.hs, b.hs, new THREE.Color()),
    hg: LC(a.hg, b.hg, new THREE.Color()),
    hi: L(a.hi, b.hi),
    fog: LC(a.fog, b.fog, new THREE.Color()),
    fogD: L(a.fogD, b.fogD),
    exp: L(a.exp, b.exp),
    stars: L(a.stars, b.stars),
    lamps: L(a.lamps, b.lamps),
    cloud: LC(a.cloud, b.cloud, new THREE.Color()),
    moon: L(a.moon, b.moon)
  };
}

// ---------- Mode waktu ----------
let timeMode = 'auto';
const PREVIEW_HOUR = { morning: 7.2, day: 13.0, sunset: 17.9, night: 23.2 };
let envHour = null; // diinit setelah first frame

function targetHour() {
  if (timeMode === 'auto') {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600;
  }
  return PREVIEW_HOUR[timeMode];
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    timeMode = btn.dataset.mode;
    document.getElementById('clock-mode').textContent = timeMode === 'auto' ? 'LOCAL TIME' : 'PREVIEW';
  });
});

// ---------- Realtime clock ----------
const elTime = document.getElementById('clock-time');
const elGreet = document.getElementById('clock-greet');
const elPeriod = document.getElementById('clock-period');
function periodOf(h) {
  if (h >= 5 && h < 10) return { id: 'MORNING', greet: 'GOOD MORNING' };
  if (h >= 10 && h < 17) return { id: 'DAY', greet: 'GOOD AFTERNOON' };
  if (h >= 17 && h < 19) return { id: 'SUNSET', greet: 'GOOD EVENING' };
  return { id: 'NIGHT', greet: 'GOOD NIGHT' };
}
function updateClock() {
  const n = new Date();
  elTime.textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  const p = periodOf(n.getHours() + n.getMinutes() / 60);
  elGreet.textContent = p.greet;
  elPeriod.textContent = p.id;
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Terapkan environment ke scene ----------
const sunDirV = new THREE.Vector3();
const moonDirV = new THREE.Vector3(-0.45, 0.72, -0.40).normalize();
const winDark = new THREE.Color(0x232630), winWarm = new THREE.Color(0xffc873);
let _lastShadowHour = -999;
function applyEnv(E, t) {
  // posisi matahari: terbit timur (+X) 6:00, terbenam barat (-X) 18:00
  const az = (envHour - 6) / 12 * Math.PI;
  const el = E.elev * Math.PI / 180;
  sunDirV.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

  if (E.elev > -1.5) {
    dirLight.position.copy(sunDirV).multiplyScalar(220);
    dirLight.color.copy(E.sunC);
    dirLight.intensity = Math.max(E.sunI, 0.06);
  } else {
    // malam: cahaya bulan
    dirLight.position.copy(moonDirV).multiplyScalar(220);
    dirLight.color.set(0x93a7d4);
    dirLight.intensity = 0.42;
  }
  dirLight.target.position.set(0, 0, 0);
  // only rebuild shadow map when sun/moon angle moved enough (smooth drag FPS)
  if (Math.abs(envHour - _lastShadowHour) > 0.08) {
    dirLight.shadow.needsUpdate = true;
    _lastShadowHour = envHour;
  }

  hemi.color.copy(E.hs);
  hemi.groundColor.copy(E.hg);
  hemi.intensity = E.hi;

  // langit & fog
  skyUniforms.uTop.value.copy(E.top);
  skyUniforms.uHorizon.value.copy(E.hor);
  skyUniforms.uFog.value.copy(E.fog);
  skyUniforms.uSunDir.value.copy(sunDirV);
  skyUniforms.uSunColor.value.copy(E.sunC);
  skyUniforms.uSunI.value = E.sunI > 0 ? E.sunI / 2.6 : 0;
  scene.fog.color.copy(E.fog);
  scene.fog.density = E.fogD;
  renderer.toneMappingExposure = E.exp;

  // matahari & bulan
  sunGlow.position.copy(sunDirV).multiplyScalar(930);
  sunGlow.material.opacity = clamp((E.elev + 4) / 8, 0, 1) * (E.sunI > 0 ? 0.95 : 0);
  sunGlow.visible = sunGlow.material.opacity > 0.01;
  moonGroup.position.copy(moonDirV).multiplyScalar(900);
  moonGroup.lookAt(camera.position);
  moonDisc.material.opacity = E.moon;
  moonGlow.material.opacity = E.moon * 0.85;
  moonGroup.visible = E.moon > 0.02;
  starMat.opacity = E.stars * (0.85 + 0.15 * Math.sin(t * 2.4));

  // lampu & jendela
  const lampI = E.lamps;
  houseLight.intensity = lampI * 1.6;
  for (const pl of lampLights) pl.intensity = lampI * 1.9;
  for (const g of lampGlows) g.material.opacity = lampI * 0.6;
  windowMat.color.copy(winDark).lerp(winWarm, lampI);

  // awan
  for (const cl of clouds) cl.material.color.copy(E.cloud);
  // kunang-kunang & burung & glint air
  ffMat.opacity = clamp(E.stars * 1.2 - 0.15, 0, 1) * (0.65 + 0.35 * Math.sin(t * 3.1));
  birdsGroup.visible = E.sunI > 1.15;
  const glintNight = E.moon * 0.22, glintDay = E.sunI > 0 ? 0.10 : 0;
  waterGlint.material.opacity = clamp(glintNight + glintDay, 0, 0.4) * (0.7 + 0.3 * Math.sin(t * 1.7));
}

// ---------- Animation loop ----------
const clock = new THREE.Clock();
let frames = 0, fpsTime = 0, qualityDropped = false;
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  uTime.value = t;

  // jam environment di-lerp mulus (transisi cinematic antar periode)
  const th = targetHour();
  if (envHour === null) envHour = th;
  let diff = ((th - envHour) % 24 + 36) % 24 - 12; // jarak terpendeks
  envHour = (envHour + diff * Math.min(1, dt * 0.55) + 24) % 24;

  const E = sampleEnv(envHour);
  applyEnv(E, t);

  // animasi dunia
  for (const cl of clouds) {
    cl.position.x += cl.userData.speed * dt * 2.2;
    if (cl.position.x > 420) cl.position.x = -420;
  }
  if (birdsGroup.visible) {
    for (const b of birds) {
      const u = b.userData;
      const a = t * u.sp + u.ph;
      b.position.set(Math.cos(a) * u.r, u.h + Math.sin(t * 0.7 + u.ph) * 3, Math.sin(a) * u.r);
      b.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(t * 9 + u.fph) * 0.65;
      u.wl.rotation.z = flap; u.wr.rotation.z = -flap;
    }
  }
  // fireflies: update every other frame to keep drag smooth
  if (ffMat.opacity > 0.01 && (frames & 1) === 0) {
    const p = ffGeo.attributes.position;
    for (let i = 0; i < Q.fireflies; i++) {
      p.array[i * 3]     = ffBase[i * 3]     + Math.sin(t * 0.9 + i * 1.7) * 1.1;
      p.array[i * 3 + 1] = ffBase[i * 3 + 1] + Math.sin(t * 1.6 + i * 2.3) * 0.55;
      p.array[i * 3 + 2] = ffBase[i * 3 + 2] + Math.cos(t * 0.8 + i * 1.3) * 1.1;
    }
    p.needsUpdate = true;
  }
  water.position.y = 0.12 + Math.sin(t * 0.9) * 0.03;

  applyCamera(dt);
  renderer.render(scene, camera);

  // progress loader + adaptive quality
  frames++;
  if (frames === 1) loaderFill.style.width = '100%';
  if (frames === 8) loaderEl.classList.add('done');
  // after warm-up: only update shadows when light angle changes (saves GPU while dragging)
  if (frames === 30) dirLight.shadow.autoUpdate = false;

  if (!qualityDropped) {
    fpsTime += dt;
    if (frames === 240) {
      const fps = frames / fpsTime;
      if (fps < 28) {
        qualityDropped = true;
        renderer.setPixelRatio(1);
        if (dirLight.shadow.map) { dirLight.shadow.map.dispose(); dirLight.shadow.map = null; }
        dirLight.shadow.mapSize.set(512, 512);
        dirLight.shadow.needsUpdate = true;
      }
    }
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
})();
