import * as THREE from 'three';
import * as dat from 'dat.gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration & State ---
const config = {
  dispersion: 0.42,
  particleSize: 0.96,
  contrast: 1.18,
  flowSpeed: 0.26,
  flowAmplitude: 0.24,
  depthStrength: 4.6,
  mouseRadius: 6.0,
  sphereRadius: 6.0,
  sphereStrength: 0.58,
  sphereMass: 0.52,
  spatialDepth: 7.2,
  sphereSurfaceBend: 38.0,
  escapeSpeed: 0.34,
  escapeMotion: 0.74,
  escapeBrightness: 1.34,
  escapeOpacity: 1.22,
  colorShiftSpeed: 0.0,
  audioDance: false,
  danceStrength: 1.0,
  depthWave: 0.12
};

let width = window.innerWidth;
let height = window.innerHeight;

// --- Setup Three.js ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
camera.position.z = 335;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(width, height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app')?.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = 210;
controls.maxDistance = 520;
controls.rotateSpeed = 0.7;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE
};
function preventRightButtonBrowserChrome(event: MouseEvent | PointerEvent | DragEvent) {
  if ('button' in event && event.button === 2) {
    event.preventDefault();
  }
}

renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 2) return;
  event.preventDefault();
  renderer.domElement.setPointerCapture(event.pointerId);
}, { capture: true });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button !== 2) return;
  event.preventDefault();
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
}, { capture: true });
document.addEventListener('contextmenu', preventRightButtonBrowserChrome, { capture: true });
document.addEventListener('dragstart', preventRightButtonBrowserChrome, { capture: true });
document.addEventListener('auxclick', preventRightButtonBrowserChrome, { capture: true });
document.addEventListener('selectstart', (event) => event.preventDefault(), { capture: true });
controls.addEventListener('start', () => {
  userInspecting = true;
});

const inactiveSphereCenter = new THREE.Vector3(-9999, -9999, -9999);
const sphereCenter = inactiveSphereCenter.clone();
const targetSphereCenter = inactiveSphereCenter.clone();
const previousSphereCenter = inactiveSphereCenter.clone();
const sphereVelocity = new THREE.Vector3();
let sphereActive = false;
let sphereVisualAlpha = 0;
let userInspecting = false;

// --- Particle System ---
let particlesGeometry: THREE.BufferGeometry;
let particlesMaterial: THREE.ShaderMaterial;
let particlesMesh: THREE.Points;
let particleOcclusionGeometry: THREE.BufferGeometry;
let particleOcclusionMaterial: THREE.ShaderMaterial;
let particleOcclusionMesh: THREE.Points;
let haloGeometry: THREE.BufferGeometry;
let haloMaterial: THREE.ShaderMaterial;
let haloMesh: THREE.Points;
let interactionSphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
let currentImageSrc = '';

// --- Escape Particle System ---
const ESCAPE_COUNT = 100000;
let escBirth: Float32Array = new Float32Array(0);
let escCol: Float32Array = new Float32Array(0);
let escVel: Float32Array = new Float32Array(0);
let escPhase: Float32Array = new Float32Array(0);
let escMaxL: Float32Array = new Float32Array(0);
let escSz: Float32Array = new Float32Array(0);
let escType: Float32Array = new Float32Array(0);
let escSeed: Float32Array = new Float32Array(0);
let escZOff: Float32Array = new Float32Array(0);
let spawnPool: { x:number; y:number; z:number; r:number; g:number; b:number; weight:number }[] = [];
let spawnTotalWeight = 0;

// Shaders
const vertexShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uMouseRadius;
  uniform vec3 uSphereCenter;
  uniform vec3 uSphereVelocity;
  uniform float uSphereRadius;
  uniform float uSphereStrength;
  uniform float uSphereMass;
  uniform float uDispersion;
  uniform float uParticleSize;
  uniform float uDepthStrength;
  uniform float uFlowSpeed;
  uniform float uFlowAmplitude;
  uniform float uDepthWave;
  uniform float uDanceStrength;
  
  attribute vec3 color;
  attribute float size;
  attribute float scatter;
  attribute float alpha;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vScatter;
  
  // Simplex 3D Noise 
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){ 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0 ); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vColor = color;
    vAlpha = alpha;
    vScatter = scatter;
    
    vec3 pos = position;
    
    // Brightness for depth
    float brightness = dot(color, vec3(0.299, 0.587, 0.114));
    
    // Noise flow
    float noise = snoise(vec3(pos.x * 0.01, pos.y * 0.01, uTime * uFlowSpeed * 0.5));
    float breath = snoise(vec3(pos.x * 0.018, pos.y * 0.018, uTime * 0.18)) * 0.5 + 0.5;
    vec2 radial = normalize(pos.xy + vec2(0.001));
    vec2 wind = normalize(vec2(-0.65, 0.38));
    vec2 drift = vec2(
      snoise(vec3(pos.xy * 0.025, uTime * 0.22)),
      snoise(vec3(pos.yx * 0.025, uTime * 0.22 + 37.0))
    );
    float dust = scatter * (0.14 + breath * 0.16);
    
    // Keep the uploaded image readable; only the outer edge behaves like airborne dust.
    pos.xy += drift * uFlowAmplitude * (1.0 - scatter) * 0.45;
    pos.xy += (radial * (2.8 + uDispersion * 2.6) + wind * (3.4 + uFlowAmplitude * 2.0) + drift * 3.2) * dust;
    
    // Base depth based on brightness and noise
    pos.z += (brightness * uDepthStrength * (0.28 + scatter * 0.08)) + (noise * uFlowAmplitude * 0.8) + dust * 1.8;
    
    // Depth wave effect
    pos.z += sin(pos.x * 0.02 + uTime) * cos(pos.y * 0.02 + uTime) * uDepthWave * 0.8 * (1.0 - scatter * 0.45);
    
    // The transparent sphere now acts like a compact gravity well above the cloud.
    vec3 toParticle = pos - uSphereCenter;
    float sphereDist = length(toParticle);
    float sphereRadius = max(uSphereRadius, 0.001);
    vec3 sphereNormal = normalize(toParticle + vec3(0.001, 0.001, 0.001));
    vec3 toSphere = -sphereNormal;
    float gravityRange = sphereRadius * (2.15 + uSphereMass * 0.75);
    float gravity = 1.0 - smoothstep(sphereRadius * 0.72, gravityRange, sphereDist);
    float capture = 1.0 - smoothstep(sphereRadius * 0.2, sphereRadius * 1.12, sphereDist);
    float motion = clamp(length(uSphereVelocity.xy) * 0.035, 0.0, 1.0);
    float glassNoise = snoise(vec3(pos.xy * 0.045, uTime * 0.7));
    vec3 tangent = normalize(vec3(-sphereNormal.y, sphereNormal.x, 0.16 + glassNoise * 0.2));
    float physicalForce = uSphereStrength * (0.65 + uSphereMass * 0.7);
    vec3 capturePoint = uSphereCenter + vec3(
      snoise(vec3(position.xy * 0.12, uTime * 0.55)),
      snoise(vec3(position.yx * 0.12, uTime * 0.55 + 23.0)),
      snoise(vec3(position.xy * 0.08, uTime * 0.42 + 47.0))
    ) * sphereRadius * 0.42;

    pos += toSphere * gravity * physicalForce * (6.2 + scatter * 8.0);
    pos = mix(pos, capturePoint, capture * clamp(0.06 + uSphereMass * 0.08, 0.0, 0.2));
    pos += tangent * gravity * (0.65 + scatter * 1.8) * (0.25 + motion) * uSphereStrength;
    pos.xy += normalize(uSphereVelocity.xy + vec2(0.001)) * gravity * motion * (1.8 + scatter * 3.0) * uSphereMass;
    
    // Audio dance (simulated)
    if (uDanceStrength > 0.0) {
      pos.y += snoise(vec3(pos.x * 0.05, uTime * 2.0, 0.0)) * uDanceStrength * 2.0;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size attenuation
    float sizeBoost = mix(0.9, 1.2, scatter) * (0.82 + brightness * 0.45);
    gl_PointSize = clamp(uParticleSize * size * sizeBoost * (300.0 / -mvPosition.z), 0.35, 2.45);
  }
`;

const fragmentShader = `
  uniform float uContrast;
  uniform float uTime;
  uniform float uColorShiftSpeed;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vScatter;
  
  // HSV to RGB conversion
  vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  
  vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    
    vec3 color = vColor;
    
    // Apply Contrast
    color = (color - 0.5) * uContrast + 0.5;
    
    // Color shift
    if (uColorShiftSpeed > 0.0) {
       vec3 hsv = rgb2hsv(color);
       hsv.x += uTime * uColorShiftSpeed * 0.1; // Shift hue
       hsv.x = fract(hsv.x);
       color = hsv2rgb(hsv);
    }
    
    float alpha = exp(-dist * dist * 6.5) * vAlpha * mix(0.84, 1.18, vScatter);
    float core = pow(max(1.0 - dist * 1.85, 0.0), 2.2);
    color += core * mix(vec3(0.04, 0.08, 0.14), vec3(0.22), vScatter);
    
    gl_FragColor = vec4(color, alpha);
  }
`;

const particleOcclusionFragmentShader = `
  void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

const haloVertexShader = `
  uniform float uTime;
  uniform float uParticleSize;
  uniform float uFlowSpeed;
  uniform float uFlowAmplitude;
  uniform float uEscapeSpeed;
  uniform float uEscapeMotion;
  uniform float uEscapeBrightness;
  uniform float uEscapeOpacity;
  uniform vec3 uSphereCenter;
  uniform vec3 uSphereVelocity;
  uniform float uSphereRadius;
  uniform float uSphereStrength;
  uniform float uSphereMass;

  attribute vec3 color;
  attribute vec3 aBirth;
  attribute vec3 aVel;
  attribute float aPhase;
  attribute float aMaxL;
  attribute float aSz;
  attribute float aTp;
  attribute float aSeed;
  attribute float aZOff;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vScatter;

  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    float life = max(aMaxL, 0.001);
    float age = mod(uTime * uEscapeSpeed * 0.58 + aPhase * life, life);
    float progress = age / life;
    float eased = progress * progress * (3.0 - 2.0 * progress);
    float t = uTime * 0.18 + aSeed * 0.37;

    vec2 radial2 = normalize(aBirth.xy + vec2(0.001));
    vec2 orbit2 = vec2(-radial2.y, radial2.x);
    float burstNoise = snoise(vec3(aBirth.x * 0.035, aSeed * 0.071, 2.0));
    float heightVariance = mix(0.45, 1.32, fract(sin(aSeed * 18.731) * 43758.5453));
    float sideBias = smoothstep(8.0, 54.0, abs(aBirth.x));
    vec3 pos = aBirth + aVel * age * uEscapeMotion * 0.24;

    // Gravity: accelerate downwards quadratically
    float gravityFactor = eased * eased * (9.0 + aTp * 2.4) * heightVariance * uEscapeMotion;
    pos.y += gravityFactor;
    pos.x += sign(aBirth.x) * sideBias * eased * (3.8 + burstNoise * 3.2) * uEscapeMotion;
    pos.y += max(burstNoise, -0.35) * eased * (3.4 + sideBias * 4.2) * uEscapeMotion;
    pos.xy += radial2 * eased * (0.45 + aTp * 0.22) * uEscapeMotion;
    pos.xy += orbit2 * sin(progress * (4.2 + heightVariance * 2.0) + aSeed) * (0.8 + aTp * 0.34 + sideBias * 1.25) * eased * uEscapeMotion;

    // Wave shimmer/sway as they fall (organic sway)
    float shimmerSpeed = 1.2 + aSeed * 0.012;
    float wave = sin(uTime * shimmerSpeed + aSeed * 6.2831);
    pos.x += wave * progress * (1.6 + aTp * 0.55 + sideBias * 3.6) * uEscapeMotion;
    pos.z += cos(uTime * 0.56 + aSeed * 4.7) * progress * 1.45 * uEscapeMotion + aZOff * eased * 0.14;

    // Large-scale noise flow with vertical correlation for curtain/filament look
    // By scaling y down, we make the noise vary slowly along y, creating vertical drapery/stripes of falling particles.
    float nf1 = snoise(vec3(aBirth.x * 0.018, aBirth.y * 0.003, t * 0.42));
    float nf2 = snoise(vec3(aBirth.x * 0.03 + aSeed * 5.0, aBirth.y * 0.004, t * 0.3));
    float nf3 = snoise(vec3(aBirth.x * 0.01, aBirth.y * 0.001 + 17.0, t * 0.24));
    
    vec3 noiseFlow = vec3(
      nf1 + nf2 * 0.45 + nf3 * 0.22,
      abs(nf2) * 0.42 + nf3 * 0.06,
      nf1 * 0.18 - nf3 * 0.08
    ) * age * (1.25 + sideBias * 1.9 + heightVariance * 0.45) * uEscapeMotion;
    
    pos += noiseFlow;

    // Interaction with the compact gravity well sphere
    vec3 toParticle = pos - uSphereCenter;
    float sphereDist = length(toParticle);
    float sphereRadius = max(uSphereRadius, 0.001);
    vec3 sphereNormal = normalize(toParticle + vec3(0.001, 0.001, 0.001));
    vec3 toSphere = -sphereNormal;
    float gravityRange = sphereRadius * (2.15 + uSphereMass * 0.75);
    float gravityForce = 1.0 - smoothstep(sphereRadius * 0.72, gravityRange, sphereDist);
    float capture = 1.0 - smoothstep(sphereRadius * 0.2, sphereRadius * 1.12, sphereDist);
    float motion = clamp(length(uSphereVelocity.xy) * 0.035, 0.0, 1.0);
    float glassNoise = snoise(vec3(pos.xy * 0.045, uTime * 0.7));
    vec3 tangent = normalize(vec3(-sphereNormal.y, sphereNormal.x, 0.16 + glassNoise * 0.2));
    float physicalForce = uSphereStrength * (0.65 + uSphereMass * 0.7);
    vec3 capturePoint = uSphereCenter + vec3(
      snoise(vec3(aBirth.xy * 0.12, uTime * 0.55)),
      snoise(vec3(aBirth.yx * 0.12, uTime * 0.55 + 23.0)),
      snoise(vec3(aBirth.xy * 0.08, uTime * 0.42 + 47.0))
    ) * sphereRadius * 0.42;

    pos += toSphere * gravityForce * physicalForce * 5.0;
    pos = mix(pos, capturePoint, capture * clamp(0.04 + uSphereMass * 0.055, 0.0, 0.14));
    pos += tangent * gravityForce * 0.9 * (0.25 + motion) * uSphereStrength;
    pos.xy += normalize(uSphereVelocity.xy + vec2(0.001)) * gravityForce * motion * 1.7 * uSphereMass;

    vec3 col = color;

    // opacity curve: >0.92 for first 55%, then fade
    float op = 1.0 - smoothstep(0.72 + heightVariance * 0.08, 1.0, progress);
    // early birth ramp
    op *= smoothstep(0.0, 0.08, progress) * uEscapeOpacity;

    // size attenuation with depth
    float farFade = clamp(1.0 - (pos.z + aZOff) / 90.0, 0.34, 1.0);
    float baseSize = aSz * farFade * (1.0 - progress * 0.26) * (0.82 + sideBias * 0.28 + heightVariance * 0.16);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uParticleSize * baseSize * (300.0 / -mv.z), 0.25, 6.0);

    vColor = col;
    vAlpha = op;
    vScatter = clamp(0.08 + progress * 0.12 + sideBias * 0.08 + (3.0 - min(aTp, 3.0)) * 0.04, 0.08, 0.34);
  }
`;

const haloFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vScatter;

  void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;

    vec3 color = vColor;
    float alpha = exp(-dist * dist * 6.5) * vAlpha * mix(0.84, 1.18, vScatter);
    float core = pow(max(1.0 - dist * 1.85, 0.0), 2.2);
    color += core * mix(vec3(0.04, 0.08, 0.14), vec3(0.22), vScatter);
    gl_FragColor = vec4(color, alpha);
  }
`;

const sphereVertexShader = `
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    vLocalPosition = position;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const sphereFragmentShader = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uRadius;
  uniform float uVelocity;

  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDirection)), 0.0), 2.2);
    float latitude = sin((vLocalPosition.y / max(uRadius, 0.001) + uTime * 0.28) * 15.0) * 0.5 + 0.5;
    float longitude = sin((atan(vLocalPosition.x, vLocalPosition.z) + uTime * 0.42) * 9.0) * 0.5 + 0.5;
    float innerMist = smoothstep(0.2, 1.0, fresnel) * 0.025;
    float contour = pow(latitude * longitude, 5.0) * 0.045;
    vec3 glass = mix(vec3(0.55, 0.78, 1.0), vec3(1.0), fresnel);
    float alpha = uAlpha * (0.014 + fresnel * 0.32 + contour + innerMist + uVelocity * 0.035);
    gl_FragColor = vec4(glass, alpha);
  }
`;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function getPixelBrightness(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const cx = clamp(x, 0, width - 1);
  const cy = clamp(y, 0, height - 1);
  const i = (cy * width + cx) * 4;
  return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
}

function getEdgeStrength(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const center = getPixelBrightness(data, width, height, x, y);
  const horizontal = Math.abs(getPixelBrightness(data, width, height, x + 1, y) - getPixelBrightness(data, width, height, x - 1, y));
  const vertical = Math.abs(getPixelBrightness(data, width, height, x, y + 1) - getPixelBrightness(data, width, height, x, y - 1));
  return clamp((horizontal + vertical) * 1.8 + center * 0.12, 0, 1);
}

function getWhiteBackgroundMask(r: number, g: number, b: number) {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const saturation = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
  const whiteness = (r + g + b) / 3;

  return smoothstep(0.78, 0.94, whiteness) * (1 - smoothstep(0.045, 0.16, saturation));
}

function getSubjectMaskAt(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const cx = clamp(x, 0, width - 1);
  const cy = clamp(y, 0, height - 1);
  const i = (cy * width + cx) * 4;
  return 1 - getWhiteBackgroundMask(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
}

function getSubjectEdgeStrength(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const left = getSubjectMaskAt(data, width, height, x - 2, y);
  const right = getSubjectMaskAt(data, width, height, x + 2, y);
  const up = getSubjectMaskAt(data, width, height, x, y - 2);
  const down = getSubjectMaskAt(data, width, height, x, y + 2);
  return clamp(Math.abs(right - left) + Math.abs(down - up), 0, 1);
}

function getTopSubjectEdgeStrength(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const up = getSubjectMaskAt(data, width, height, x, y - 2);
  const center = getSubjectMaskAt(data, width, height, x, y);
  const down = getSubjectMaskAt(data, width, height, x, y + 2);
  return clamp(Math.max(center - up, down - up), 0, 1);
}

function sampleImageColorNormalized(data: Uint8ClampedArray, width: number, height: number, nx: number, ny: number) {
  const px = clamp(Math.round((nx * 0.5 + 0.5) * (width - 1)), 0, width - 1);
  const py = clamp(Math.round(((-ny) * 0.5 + 0.5) * (height - 1)), 0, height - 1);
  const i = (py * width + px) * 4;
  const r = data[i] / 255;
  const g = data[i + 1] / 255;
  const b = data[i + 2] / 255;
  return {
    r,
    g,
    b,
    brightness: r * 0.299 + g * 0.587 + b * 0.114
  };
}

function buildHaloField(data: Uint8ClampedArray, imgW: number, imgH: number, widthArea: number, heightArea: number, depthArea: number) {
  const birth = new Float32Array(ESCAPE_COUNT * 3);
  const col = new Float32Array(ESCAPE_COUNT * 3);
  const vel = new Float32Array(ESCAPE_COUNT * 3);
  const phase = new Float32Array(ESCAPE_COUNT);
  const maxL = new Float32Array(ESCAPE_COUNT);
  const sz = new Float32Array(ESCAPE_COUNT);
  const type = new Float32Array(ESCAPE_COUNT);
  const seed = new Float32Array(ESCAPE_COUNT);
  const zOff = new Float32Array(ESCAPE_COUNT);
  let count = 0;
  let attempts = 0;

  while (count < ESCAPE_COUNT && attempts < ESCAPE_COUNT * 28) {
    attempts += 1;
    const nx = (Math.random() * 2 - 1) * 1.18;
    const ny = (Math.random() * 2 - 1) * 1.08;
    const angle = Math.atan2(ny - 0.04, nx);
    const lobe = Math.sin(angle * 3.0 + Math.cos(angle * 2.0) * 0.45) * 0.06;
    const rimNoise = (hash2(Math.floor((nx + 2.0) * 28), Math.floor((ny + 2.0) * 28), 301) - 0.5) * 0.1;
    const innerNoise = (hash2(Math.floor((nx + 2.0) * 36), Math.floor((ny + 2.0) * 36), 302) - 0.5) * 0.08;
    const outer = Math.sqrt(
      (nx / (1.02 + lobe + rimNoise)) ** 2 +
      ((ny - 0.04) / (0.94 + lobe * 0.7 + rimNoise * 0.8)) ** 2
    );
    const inner = Math.sqrt(
      (nx / (0.71 + innerNoise * 0.55)) ** 2 +
      ((ny + 0.01) / (0.63 + innerNoise * 0.45)) ** 2
    );
    const windowRim = 1 - smoothstep(1.02, 1.34, inner);
    const shellBand = (1 - smoothstep(0.9, 1.04, outer)) * smoothstep(1.0, 1.08, inner);
    const diffuseBand = smoothstep(1.08, 1.52, inner) * (1 - smoothstep(0.78, 1.04, outer));
    const topBias = smoothstep(-0.12, 0.84, ny);
    const sideBias = smoothstep(0.1, 0.78, Math.abs(nx));
    const density = clamp(shellBand * (0.58 + windowRim * 0.96 + topBias * 0.28) + diffuseBand * (0.16 + topBias * 0.18 + sideBias * 0.12), 0, 1);
    if (density < 0.08 || Math.random() > density) {
      continue;
    }

    const voidA = 1 - smoothstep(0.16, 0.34, Math.hypot(nx + 0.78, ny - 0.78));
    const voidB = 1 - smoothstep(0.2, 0.42, Math.hypot(nx - 0.02, ny - 0.98));
    const voidC = 1 - smoothstep(0.1, 0.24, Math.hypot(nx - 0.76, ny + 0.55));
    const voidD = 1 - smoothstep(0.12, 0.28, Math.hypot(nx - 0.02, ny + 0.68));
    const gapNoise = smoothstep(0.72, 0.92, hash2(Math.floor((nx + 1.7) * 23), Math.floor((ny + 1.7) * 23), 404));
    const voidMask = clamp(Math.max(voidA * 1.1, Math.max(voidB, Math.max(voidC * 1.35, voidD * 0.5))) + gapNoise * topBias * 0.12, 0, 1);
    if (Math.random() < voidMask * 0.96) {
      continue;
    }

    const vortexDist = Math.hypot(nx - 0.76, ny + 0.55);
    const vortexWeight = 1 - smoothstep(0.12, 0.34, vortexDist);
    const voidRim = Math.max(1 - smoothstep(0.04, 0.09, Math.abs(vortexDist - 0.17)), 1 - smoothstep(0.04, 0.12, Math.abs(Math.hypot(nx + 0.78, ny - 0.78) - 0.24)));
    const spread = 1 + diffuseBand * 0.16 + windowRim * 0.1;
    const posX = nx * widthArea * spread;
    const posY = ny * heightArea * spread;
    const posZ = (1 - outer) * depthArea * 8.0 + windowRim * 10.0 + diffuseBand * 2.6 + (hash2(count, attempts, 501) - 0.5) * depthArea * 0.7 + topBias * 2.5;
    const sample = sampleImageColorNormalized(data, imgW, imgH, clamp(nx * (0.56 + windowRim * 0.12), -0.95, 0.95), clamp(ny * (0.52 + windowRim * 0.12), -0.95, 0.95));
    const whiten = clamp(windowRim * 0.48 + topBias * 0.14 + voidRim * 0.38, 0, 0.82);
    const baseBoost = 0.82 + sample.brightness * 0.34 + diffuseBand * 0.1;
    const dirLength = Math.max(Math.hypot(posX, posY), 0.001);
    const tangentX = -posY / dirLength;
    const tangentY = posX / dirLength;
    const radialX = posX / dirLength;
    const radialY = posY / dirLength;
    const vortexDX = nx - 0.76;
    const vortexDY = ny + 0.55;
    const vortexLength = Math.max(Math.hypot(vortexDX, vortexDY), 0.001);
    const vortexTX = -vortexDY / vortexLength;
    const vortexTY = vortexDX / vortexLength;
    const drift = 0.12 + windowRim * 0.34 + diffuseBand * 0.18;
    const velX = tangentX * drift + radialX * (0.04 + diffuseBand * 0.12) + vortexTX * vortexWeight * 0.55;
    const velY = tangentY * drift + radialY * (0.02 + topBias * 0.08) + vortexTY * vortexWeight * 0.55;
    const haloType = vortexWeight > 0.18 || windowRim > 0.56 || voidRim > 0.28 ? 1 : (diffuseBand > 0.22 ? 2 : 3);
    const index3 = count * 3;

    birth[index3] = posX;
    birth[index3 + 1] = posY;
    birth[index3 + 2] = posZ;
    col[index3] = clamp(sample.r * baseBoost * (1 - whiten) + whiten, 0, 1);
    col[index3 + 1] = clamp(sample.g * baseBoost * (1 - whiten) + whiten * 0.985, 0, 1);
    col[index3 + 2] = clamp(sample.b * baseBoost * (1 - whiten) + whiten * 0.96, 0, 1);
    vel[index3] = velX;
    vel[index3 + 1] = velY;
    vel[index3 + 2] = (hash2(count, attempts, 511) - 0.5) * 0.35;
    phase[count] = Math.random();
    maxL[count] = 0.32 + windowRim * 0.55 + diffuseBand * 0.24 + vortexWeight * 0.4;
    sz[count] = 0.42 + Math.random() * 0.55 + windowRim * 0.65 + vortexWeight * 0.5 + (haloType < 1.5 ? 0.2 : 0);
    type[count] = haloType;
    seed[count] = Math.random() * 100.0;
    zOff[count] = (hash2(count, attempts, 544) - 0.5) * 8.0 + vortexWeight * 4.0;
    count += 1;
  }

  if (count === 0) {
    return { birth, col, vel, phase, maxL, sz, type, seed, zOff };
  }

  for (let i = count; i < ESCAPE_COUNT; i++) {
    const from = i % count;
    const from3 = from * 3;
    const to3 = i * 3;
    birth[to3] = birth[from3];
    birth[to3 + 1] = birth[from3 + 1];
    birth[to3 + 2] = birth[from3 + 2];
    col[to3] = col[from3];
    col[to3 + 1] = col[from3 + 1];
    col[to3 + 2] = col[from3 + 2];
    vel[to3] = vel[from3];
    vel[to3 + 1] = vel[from3 + 1];
    vel[to3 + 2] = vel[from3 + 2];
    phase[i] = phase[from];
    maxL[i] = maxL[from];
    sz[i] = sz[from];
    type[i] = type[from];
    seed[i] = seed[from];
    zOff[i] = zOff[from];
  }

  return { birth, col, vel, phase, maxL, sz, type, seed, zOff };
}

function createInteractionSphere() {
  const geometry = new THREE.SphereGeometry(1, 64, 32);
  const material = new THREE.ShaderMaterial({
    vertexShader: sphereVertexShader,
    fragmentShader: sphereFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uRadius: { value: config.sphereRadius },
      uVelocity: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide
  });

  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.copy(inactiveSphereCenter);
  sphere.scale.setScalar(config.sphereRadius);
  sphere.visible = false;
  sphere.renderOrder = 4;
  scene.add(sphere);
  return sphere;
}

function updateInteractionUniforms() {
  const uniformSphereCenter = sphereActive || sphereVisualAlpha > 0.015 ? sphereCenter : inactiveSphereCenter;
  if (particlesMaterial) {
    particlesMaterial.uniforms.uMouse.value.set(uniformSphereCenter.x, uniformSphereCenter.y);
    particlesMaterial.uniforms.uMouseRadius.value = config.sphereRadius;
    particlesMaterial.uniforms.uSphereCenter.value.copy(uniformSphereCenter);
    particlesMaterial.uniforms.uSphereVelocity.value.copy(sphereVelocity);
    particlesMaterial.uniforms.uSphereRadius.value = config.sphereRadius;
    particlesMaterial.uniforms.uSphereStrength.value = config.sphereStrength;
    particlesMaterial.uniforms.uSphereMass.value = config.sphereMass;
  }
  if (haloMaterial) {
    haloMaterial.uniforms.uSphereCenter.value.copy(uniformSphereCenter);
    haloMaterial.uniforms.uSphereVelocity.value.copy(sphereVelocity);
    haloMaterial.uniforms.uSphereRadius.value = config.sphereRadius;
    haloMaterial.uniforms.uSphereStrength.value = config.sphereStrength;
    haloMaterial.uniforms.uSphereMass.value = config.sphereMass;
  }
}

interactionSphere = createInteractionSphere();

// --- Escape Helpers ---
function sampleSpawn() {
  if (spawnPool.length === 0) return { x:0, y:0, z:0, r:0.5, g:0.5, b:0.5, weight:1 };
  const rVal = Math.random() * spawnTotalWeight;
  let cum = 0;
  for (const p of spawnPool) {
    cum += p.weight;
    if (cum >= rVal) return p;
  }
  return spawnPool[spawnPool.length - 1];
}

function spawnEsc(idx: number) {
  const sp = sampleSpawn();
  
  // Center is at 0,0. Find direction from center.
  const rad = Math.sqrt(sp.x * sp.x + sp.y * sp.y);
  const dx = rad > 0.001 ? sp.x / rad : (Math.random() - 0.5);
  const dy = rad > 0.001 ? sp.y / rad : (Math.random() - 0.5);
  
  // Decide particle type: 
  // tp = 1: Large glowing sparks sliding along contour
  // tp = 2: Medium particles falling down with wavy noise
  // tp = 3: Tiny misty dust collapsing straight down
  let tp: number;
  let vx: number, vy: number, vz: number;
  let sz: number;
  const rt = Math.random();
  
  if (rt < 0.15) {
    tp = 1; // Large sparks
    sz = 1.6 + Math.random() * 2.2;
  } else if (rt < 0.5) {
    tp = 2; // Medium particles
    sz = 0.85 + Math.random() * 1.05;
  } else {
    tp = 3; // Fine dust
    sz = 0.32 + Math.random() * 0.62;
  }

  // Base speeds
  const side = Math.random() < 0.5 ? 1 : -1;
  const spd = 1.6 + Math.random() * 4.2;
  
  // Sliding along contour (tangent) + outward push
  // If we are high up, we slide more along the contour.
  // If we are at the bottom, we just drop.
  const contourFactor = clamp((sp.y + 48) / 112, 0, 1.2); // higher near top
  
  vx = dx * (0.18 + Math.random() * 1.05) + side * (-dy) * spd * 0.14 * contourFactor;
  vy = 1.25 + Math.random() * 2.9 + Math.max(dy, 0) * (0.9 + Math.random() * 1.8) + contourFactor * (0.7 + Math.random() * 1.3);
  vz = (Math.random() - 0.5) * (0.9 + Math.random() * 2.2);

  // Scaling velocities based on particle type for depth and variety
  if (tp === 1) {
    // Large sparks: slower, more graceful, slide further
    vx *= 0.72;
    vy *= 0.74;
  } else if (tp === 3) {
    // Fine dust: faster collapse, more vertical drop
    vy += (0.7 + Math.random() * 1.8);
    vx *= 0.68;
  }

  const maxL = 8.5 + Math.random() * 8.5; // lifetime in seconds (scaled by speed in shader)
  const seed = Math.random() * 100.0;
  const zOff = (Math.random() - 0.5) * 12.0;

  escBirth[idx * 3] = sp.x; escBirth[idx * 3 + 1] = sp.y; escBirth[idx * 3 + 2] = sp.z;
  escCol[idx * 3] = sp.r; escCol[idx * 3 + 1] = sp.g; escCol[idx * 3 + 2] = sp.b;
  escVel[idx * 3] = vx; escVel[idx * 3 + 1] = vy; escVel[idx * 3 + 2] = vz;
  escPhase[idx] = Math.random();
  escMaxL[idx] = maxL;
  escSz[idx] = sz;
  escType[idx] = tp;
  escSeed[idx] = seed;
  escZOff[idx] = zOff;
}

// --- Load Image and Create Particles ---
function initParticles(imageSrc: string) {
  currentImageSrc = imageSrc;
  const img = new Image();
  // Only set crossOrigin for external URLs, not for data URLs
  if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
    img.crossOrigin = 'Anonymous';
  }
  img.src = imageSrc;
  
  img.onload = () => {
    console.log('Image loaded, dimensions:', img.width, 'x', img.height);
    // We use a canvas to read pixel data
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Scale down image for particle count while keeping enough detail for a readable all-particle image.
    const scale = 520 / Math.max(img.width, img.height);
    const imgW = Math.floor(img.width * scale);
    const imgH = Math.floor(img.height * scale);
    
    canvas.width = imgW;
    canvas.height = imgH;
    ctx?.drawImage(img, 0, 0, imgW, imgH);
    
    const imgData = ctx?.getImageData(0, 0, imgW, imgH).data;
    if (!imgData) return;
    
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const scatters: number[] = [];
    const alphas: number[] = [];

    // spawn pool for escape particles
    spawnPool = [];
    
    const maxArea = 170;
    const maxImageSide = Math.max(imgW, imgH);
    const widthArea = (imgW / maxImageSide) * maxArea;
    const heightArea = (imgH / maxImageSide) * maxArea;
    const stepX = widthArea / imgW;
    const stepY = heightArea / imgH;
    const depthArea = config.spatialDepth;
    const curvedSurfaceRadius = Math.max(widthArea, heightArea) * 1.06;
    const curvedSurfaceLift = config.sphereSurfaceBend;

    function pushParticle(
      posX: number,
      posY: number,
      posZ: number,
      r: number,
      g: number,
      b: number,
      brightness: number,
      scatter: number,
      centerDensity: number,
      edgeStrength: number,
      saltOffset = 0
    ) {
      const lightLift = 0.92 + brightness * 0.42 + scatter * 0.18;

      positions.push(posX, posY, posZ);
      colors.push(
        clamp(r * lightLift + scatter * 0.035, 0, 1),
        clamp(g * lightLift + scatter * 0.045, 0, 1),
        clamp(b * lightLift + scatter * 0.055, 0, 1)
      );
      sizes.push(0.24 + hash2(posX, posY, 7 + saltOffset) * 0.14 + brightness * 0.2 + scatter * 0.08 + centerDensity * 0.16);
      scatters.push(scatter);
      alphas.push(clamp(0.34 + brightness * 0.7 + edgeStrength * 0.12 + centerDensity * 0.32, 0.28, 1));
    }
    
    for (let y = 0; y < imgH; y++) {
      for (let x = 0; x < imgW; x++) {
        const i = (y * imgW + x) * 4;
        const r = imgData[i] / 255;
        const g = imgData[i+1] / 255;
        const b = imgData[i+2] / 255;
        const a = imgData[i+3] / 255;
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        
        if (a < 0.1) continue;
        
        const nx = x / imgW - 0.5;
        const ny = y / imgH - 0.5;
        const radius = Math.sqrt((nx / 0.58) * (nx / 0.58) + (ny / 0.58) * (ny / 0.58));
        const organicNoise = hash2(Math.floor(x / 7), Math.floor(y / 7), 1) * 0.12 + hash2(x, y, 2) * 0.04;
        const whiteBackground = getWhiteBackgroundMask(r, g, b);
        const subject = 1 - whiteBackground;
        const centerDensity = 1 - smoothstep(0.18, 0.7, radius);
        const edgeDensity = 1 - smoothstep(0.46, 1.1, radius);
        const reveal = subject * (1 - smoothstep(0.94 + organicNoise, 1.08 + organicNoise, radius));
        const borderDust = subject * smoothstep(0.5, 0.98, radius) * (1 - smoothstep(1.14, 1.34, radius));
        const edgeStrength = getEdgeStrength(imgData, imgW, imgH, x, y);
        const subjectEdge = getSubjectEdgeStrength(imgData, imgW, imgH, x, y);
        const topSubjectEdge = getTopSubjectEdgeStrength(imgData, imgW, imgH, x, y);
        const imageFrameEdge = subject * Math.max(
          smoothstep(0.34, 0.49, Math.abs(nx)),
          smoothstep(0.34, 0.49, Math.abs(ny))
        );
        const visibleImage = reveal * smoothstep(0.025, 0.12, subject);
        const dustChance = Math.max(subjectEdge * 1.35, Math.max(edgeStrength * 0.46, Math.max(borderDust * 0.9, imageFrameEdge * 0.78))) * subject;
        const density = clamp(0.68 + centerDensity * 0.7 + edgeDensity * 0.3, 0.34, 1);
        const keepChance = centerDensity > 0.42
          ? clamp(0.96 + subject * 0.08, 0, 1)
          : clamp((visibleImage * density) + dustChance * 0.06, 0, 1);
        
        if (subject < 0.16) continue;
        if (radius > 1.12 + organicNoise * 0.12) continue;
        if (hash2(x, y, 3) > keepChance) continue;
        
        const outerFalloff = 1 - centerDensity;
        const scatter = clamp(edgeStrength * 0.16 + borderDust * 0.25 + outerFalloff * 0.08, 0, 0.38);
        const jitterScale = 0.08 + scatter * 0.36 + outerFalloff * 0.08;
        const jitterX = (hash2(x, y, 4) - 0.5) * stepX * jitterScale;
        const jitterY = (hash2(x, y, 5) - 0.5) * stepY * jitterScale;
        
        // Map the image onto a forward-curving spherical surface.
        const flatX = (x / imgW - 0.5) * widthArea + jitterX;
        const flatY = -(y / imgH - 0.5) * heightArea + jitterY;
        const normalizedSurfaceRadius = clamp(Math.sqrt(flatX * flatX + flatY * flatY) / curvedSurfaceRadius, 0, 0.98);
        const sphericalLift = (Math.sqrt(1 - normalizedSurfaceRadius * normalizedSurfaceRadius) - 1) * curvedSurfaceLift;
        const rimWrap = normalizedSurfaceRadius * normalizedSurfaceRadius * depthArea * 0.08;
        const posX = flatX * (1 + normalizedSurfaceRadius * normalizedSurfaceRadius * 0.12);
        const posY = flatY * (1 + normalizedSurfaceRadius * normalizedSurfaceRadius * 0.12);
        const volumetricNoise = hash2(x, y, 6) - 0.5;
        const layerNoise = hash2(Math.floor(x / 3), Math.floor(y / 3), 22) - 0.5;
        const imageRelief = (brightness - 0.45) * depthArea * 0.08 + edgeStrength * depthArea * 0.06;
        const posZ = sphericalLift + rimWrap + imageRelief + volumetricNoise * depthArea * (0.045 + scatter * 0.11) + layerNoise * depthArea * 0.025;
        pushParticle(posX, posY, posZ, r, g, b, brightness, scatter, centerDensity, edgeStrength);

        if (centerDensity > 0.48 && subject > 0.2) {
          const centralFill = centerDensity * subject;
          const fillCount = centralFill > 0.82 ? 2 : 1;
          for (let fill = 0; fill < fillCount; fill++) {
            if (hash2(x, y, 60 + fill) > centralFill * 0.9) continue;
            const fillX = posX + (hash2(x, y, 61 + fill) - 0.5) * stepX * 0.72;
            const fillY = posY + (hash2(x, y, 63 + fill) - 0.5) * stepY * 0.72;
            const fillZ = posZ + (hash2(x, y, 65 + fill) - 0.5) * depthArea * 0.018;
            const fillScatter = clamp(scatter * 0.35, 0, 0.16);
            pushParticle(fillX, fillY, fillZ, r, g, b, brightness, fillScatter, centerDensity, edgeStrength, 70 + fill * 11);
          }
        }

        const contourDensity = clamp(subject * (subjectEdge * 2.1 + edgeStrength * 0.75 + borderDust * 0.58 + imageFrameEdge * 0.5), 0, 1);
        if (contourDensity > 0.18 && hash2(x, y, 14) < contourDensity * 0.78) {
          const tightJitter = 0.22 + contourDensity * 0.46;
          const contourX = posX + (hash2(x, y, 15) - 0.5) * stepX * tightJitter;
          const contourY = posY + (hash2(x, y, 16) - 0.5) * stepY * tightJitter;
          const contourZ = posZ + (hash2(x, y, 17) - 0.5) * depthArea * 0.035;
          const contourScatter = clamp(scatter * 0.55 + edgeStrength * 0.08, 0, 0.28);
          pushParticle(contourX, contourY, contourZ, r, g, b, brightness, contourScatter, centerDensity, edgeStrength, 20);
        }

        if ((subjectEdge > 0.08 || edgeStrength > 0.22 || imageFrameEdge > 0.45) && subject > 0.3 && hash2(x, y, 18) < contourDensity * 0.34) {
          const microX = posX + (hash2(x, y, 19) - 0.5) * stepX * 0.92;
          const microY = posY + (hash2(x, y, 20) - 0.5) * stepY * 0.92;
          const microZ = posZ + (hash2(x, y, 21) - 0.5) * depthArea * 0.05;
          const microScatter = clamp(scatter * 0.72 + edgeStrength * 0.1, 0, 0.32);
          pushParticle(microX, microY, microZ, r, g, b, brightness, microScatter, centerDensity, edgeStrength, 40);
        }

        // collect spawn pool for escape particles (weighted by edgeStrength & brightness)
        const upperRegion = 1 - smoothstep(0.18, 0.58, y / imgH);
        const topBand = 1 - smoothstep(0.04, 0.22, y / imgH);
        const raggedNoise = hash2(Math.floor(x / 17), Math.floor(y / 11), 301);
        const fineBreakup = hash2(x, y, 302);
        const leftPlume = Math.exp(-Math.pow((nx + 0.27) / 0.2, 2));
        const rightPlume = Math.exp(-Math.pow((nx - 0.25) / 0.22, 2));
        const centerGlow = Math.exp(-Math.pow(nx / 0.28, 2)) * (0.36 + raggedNoise * 0.22);
        const centerVoid = Math.exp(-Math.pow(nx / 0.16, 2)) * (0.16 + raggedNoise * 0.22);
        const sidePlumes = clamp(leftPlume * 1.05 + rightPlume * 1.15, 0, 1.6);
        const overflowArch = upperRegion * clamp(0.18 + raggedNoise * 0.92 + sidePlumes * 0.62 + centerGlow * 0.38 - centerVoid, 0, 1.55);
        const raggedTop = clamp(topBand * 0.42 + overflowArch, 0, 1.65);
        const edgeBirth = topSubjectEdge * (1.15 + sidePlumes * 0.9) + raggedTop * (0.28 + subject * 0.86) + edgeStrength * raggedTop * 0.18;
        const wEdge = edgeBirth * 0.96;
        const wBright = brightness * 0.18;
        const wRand = fineBreakup * 0.14;
        const weight = (wEdge + wBright + wRand) * raggedTop;
        if (weight > 0.1 && fineBreakup < clamp(0.34 + raggedTop * 0.46 + sidePlumes * 0.14, 0, 0.92) && (topSubjectEdge > 0.025 || raggedTop > 0.36)) {
          spawnPool.push({ x: posX, y: posY, z: posZ, r, g, b, weight });
        }
      }
    }

    console.log('Particles created:', positions.length / 3, 'Spawn pool:', spawnPool.length);

    // build cumulative weights for fast sampling
    spawnTotalWeight = 0;
    for (const p of spawnPool) { spawnTotalWeight += p.weight; }

    // init module-level escape arrays
    escBirth = new Float32Array(ESCAPE_COUNT * 3);
    escCol = new Float32Array(ESCAPE_COUNT * 3);
    escVel = new Float32Array(ESCAPE_COUNT * 3);
    escPhase = new Float32Array(ESCAPE_COUNT);
    escMaxL = new Float32Array(ESCAPE_COUNT);
    escSz = new Float32Array(ESCAPE_COUNT);
    escType = new Float32Array(ESCAPE_COUNT);
    escSeed = new Float32Array(ESCAPE_COUNT);
    escZOff = new Float32Array(ESCAPE_COUNT);

    for (let i = 0; i < ESCAPE_COUNT; i++) {
      spawnEsc(i);
    }
    
    if (particlesMesh) {
      scene.remove(particlesMesh);
      particlesGeometry.dispose();
      particlesMaterial.dispose();
    }
    if (particleOcclusionMesh) {
      scene.remove(particleOcclusionMesh);
      particleOcclusionGeometry.dispose();
      particleOcclusionMaterial.dispose();
    }
    if (haloMesh) {
      scene.remove(haloMesh);
      haloGeometry.dispose();
      haloMaterial.dispose();
    }
    particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    particlesGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    particlesGeometry.setAttribute('scatter', new THREE.Float32BufferAttribute(scatters, 1));
    particlesGeometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

    const particleUniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(-9999, -9999) },
      uMouseRadius: { value: config.sphereRadius },
      uSphereCenter: { value: sphereCenter.clone() },
      uSphereVelocity: { value: sphereVelocity.clone() },
      uSphereRadius: { value: config.sphereRadius },
      uSphereStrength: { value: config.sphereStrength },
      uSphereMass: { value: config.sphereMass },
      uDispersion: { value: config.dispersion },
      uParticleSize: { value: config.particleSize },
      uContrast: { value: config.contrast },
      uDepthStrength: { value: config.depthStrength },
      uFlowSpeed: { value: config.flowSpeed },
      uFlowAmplitude: { value: config.flowAmplitude },
      uDepthWave: { value: config.depthWave },
      uDanceStrength: { value: config.audioDance ? config.danceStrength : 0.0 },
      uColorShiftSpeed: { value: config.colorShiftSpeed }
    };

    particleOcclusionGeometry = new THREE.BufferGeometry();
    particleOcclusionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleOcclusionGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    particleOcclusionGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    particleOcclusionGeometry.setAttribute('scatter', new THREE.Float32BufferAttribute(scatters, 1));
    particleOcclusionGeometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

    particleOcclusionMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: particleOcclusionFragmentShader,
      uniforms: particleUniforms,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NoBlending
    });
    particleOcclusionMaterial.colorWrite = false;
    particleOcclusionMesh = new THREE.Points(particleOcclusionGeometry, particleOcclusionMaterial);
    particleOcclusionMesh.renderOrder = 1;
    scene.add(particleOcclusionMesh);

    particlesMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: particleUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    particlesMesh.renderOrder = 3;
    scene.add(particlesMesh);
    
    haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute(escBirth, 3));
    haloGeometry.setAttribute('color', new THREE.Float32BufferAttribute(escCol, 3));
    haloGeometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(escBirth, 3));
    haloGeometry.setAttribute('aVel', new THREE.Float32BufferAttribute(escVel, 3));
    haloGeometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(escPhase, 1));
    haloGeometry.setAttribute('aMaxL', new THREE.Float32BufferAttribute(escMaxL, 1));
    haloGeometry.setAttribute('aSz', new THREE.Float32BufferAttribute(escSz, 1));
    haloGeometry.setAttribute('aTp', new THREE.Float32BufferAttribute(escType, 1));
    haloGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(escSeed, 1));
    haloGeometry.setAttribute('aZOff', new THREE.Float32BufferAttribute(escZOff, 1));

    haloMaterial = new THREE.ShaderMaterial({
      vertexShader: haloVertexShader,
      fragmentShader: haloFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uParticleSize: { value: config.particleSize },
        uFlowSpeed: { value: config.flowSpeed },
        uFlowAmplitude: { value: config.flowAmplitude },
        uEscapeSpeed: { value: config.escapeSpeed },
        uEscapeMotion: { value: config.escapeMotion },
        uEscapeBrightness: { value: config.escapeBrightness },
        uEscapeOpacity: { value: config.escapeOpacity },
        uSphereCenter: { value: sphereCenter.clone() },
        uSphereVelocity: { value: sphereVelocity.clone() },
        uSphereRadius: { value: config.sphereRadius },
        uSphereStrength: { value: config.sphereStrength },
        uSphereMass: { value: config.sphereMass }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });
    
    haloMesh = new THREE.Points(haloGeometry, haloMaterial);
    haloMesh.renderOrder = 2;
    scene.add(haloMesh);
  };
  
  img.onerror = () => {
    console.error('Failed to load image:', imageSrc.substring(0, 100));
  };
}

// Expose initParticles to window so HTML can call it with a new image
(window as any).initParticles = initParticles;

// Load a nice landscape image (unsplash placeholder)
initParticles('https://images.unsplash.com/photo-1506748686214-e9df14d4d9d0?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80');

// --- Mouse Interaction ---
const mouse = new THREE.Vector2(-9999, -9999);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

window.addEventListener('mousemove', (e) => {
  // Normalize mouse coordinates for raycasting
  mouse.x = (e.clientX / width) * 2 - 1;
  mouse.y = -(e.clientY / height) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersectPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersectPoint);

  targetSphereCenter.set(intersectPoint.x, intersectPoint.y, config.sphereSurfaceBend * 0.12 + config.spatialDepth * 0.35);
  if (!sphereActive && sphereVisualAlpha < 0.05) {
    sphereCenter.copy(targetSphereCenter);
    previousSphereCenter.copy(targetSphereCenter);
    sphereVelocity.set(0, 0, 0);
  }
  sphereActive = true;
});

// Remove mouse force when leaving
window.addEventListener('mouseleave', () => {
  sphereActive = false;
  targetSphereCenter.copy(inactiveSphereCenter);
});

window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

// --- GUI ---
const gui = new dat.GUI();
gui.add(config, 'dispersion', 0, 5).name('扩散强度').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uDispersion.value = v));
gui.add(config, 'particleSize', 0.1, 10).name('粒子大小').onChange(v => {
  if (particlesMaterial) particlesMaterial.uniforms.uParticleSize.value = v;
  if (haloMaterial) haloMaterial.uniforms.uParticleSize.value = v;
});
gui.add(config, 'contrast', 0, 3).name('对比度').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uContrast.value = v));
gui.add(config, 'flowSpeed', 0, 5).name('主体流速').onChange(v => {
  if (particlesMaterial) particlesMaterial.uniforms.uFlowSpeed.value = v;
  if (haloMaterial) haloMaterial.uniforms.uFlowSpeed.value = v;
});
gui.add(config, 'flowAmplitude', 0, 5).name('主体流幅').onChange(v => {
  if (particlesMaterial) particlesMaterial.uniforms.uFlowAmplitude.value = v;
  if (haloMaterial) haloMaterial.uniforms.uFlowAmplitude.value = v;
});
gui.add(config, 'escapeSpeed', 0.05, 1.4).name('上部崩塌速度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeSpeed.value = v;
});
gui.add(config, 'escapeMotion', 0.2, 2.0).name('上部溢出范围').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeMotion.value = v;
});
gui.add(config, 'escapeBrightness', 0.8, 4.0).name('上部溢出亮度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeBrightness.value = v;
});
gui.add(config, 'escapeOpacity', 0.5, 3.0).name('上部溢出浓度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeOpacity.value = v;
});
gui.add(config, 'depthStrength', 0, 24).name('浮雕深度').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uDepthStrength.value = v));
gui.add(config, 'mouseRadius', 3, 18).name('旧版半径').onChange(v => {
  config.sphereRadius = v;
  interactionSphere.scale.setScalar(config.sphereRadius);
  interactionSphere.material.uniforms.uRadius.value = config.sphereRadius;
  updateInteractionUniforms();
});
gui.add(config, 'sphereRadius', 3, 18).name('圆球半径').onChange(v => {
  config.mouseRadius = v;
  interactionSphere.scale.setScalar(v);
  interactionSphere.material.uniforms.uRadius.value = v;
  updateInteractionUniforms();
});
gui.add(config, 'sphereStrength', 0, 2.6).name('引力强度').onChange(() => updateInteractionUniforms());
gui.add(config, 'sphereMass', 0.1, 2.0).name('引力质量').onChange(() => updateInteractionUniforms());
gui.add(config, 'spatialDepth', 1, 18).name('薄层厚度').onFinishChange(() => {
  if (currentImageSrc) initParticles(currentImageSrc);
});
gui.add(config, 'sphereSurfaceBend', 12, 90).name('球面弧度').onFinishChange(() => {
  if (currentImageSrc) initParticles(currentImageSrc);
});
gui.add(config, 'colorShiftSpeed', 0, 2).name('色相流动').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uColorShiftSpeed.value = v));
gui.add(config, 'audioDance').name('音频律动').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uDanceStrength.value = v ? config.danceStrength : 0.0));
gui.add(config, 'danceStrength', 0, 5).name('律动强度').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uDanceStrength.value = config.audioDance ? v : 0.0));
gui.add(config, 'depthWave', 0, 5).name('深度波动').onChange(v => particlesMaterial && (particlesMaterial.uniforms.uDepthWave.value = v));
// --- Animation Loop ---
const timer = new THREE.Timer();
timer.connect(document);

function animate(timestamp?: number) {
  requestAnimationFrame(animate);
  
  timer.update(timestamp);
  const elapsedTime = timer.getElapsed();
  
  if (particlesMaterial) {
    particlesMaterial.uniforms.uTime.value = elapsedTime;
  }
  if (haloMaterial) {
    haloMaterial.uniforms.uTime.value = elapsedTime;
  }

  previousSphereCenter.copy(sphereCenter);
  if (sphereActive) {
    sphereCenter.lerp(targetSphereCenter, 0.22);
  }
  sphereVelocity.copy(sphereCenter).sub(previousSphereCenter);
  sphereVisualAlpha += ((sphereActive ? 1 : 0) - sphereVisualAlpha) * 0.14;
  updateInteractionUniforms();

  interactionSphere.visible = sphereVisualAlpha > 0.015;
  interactionSphere.position.copy(sphereCenter);
  interactionSphere.scale.setScalar(config.sphereRadius);
  interactionSphere.material.uniforms.uTime.value = elapsedTime;
  interactionSphere.material.uniforms.uAlpha.value = sphereVisualAlpha;
  interactionSphere.material.uniforms.uRadius.value = config.sphereRadius;
  interactionSphere.material.uniforms.uVelocity.value = clamp(sphereVelocity.length() * 0.05, 0, 1);
  controls.update();

  if (particlesMesh) particlesMesh.rotation.set(0, 0, 0);
  if (haloMesh) haloMesh.rotation.set(0, 0, 0);
  
  renderer.render(scene, camera);
}

animate();
