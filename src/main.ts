import * as THREE from 'three';
import * as dat from 'dat.gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration & State ---
const config = {
  dispersion: 0.85,
  particleSize: 1.08,
  contrast: 1.35,
  flowSpeed: 0.45,
  flowAmplitude: 0.45,
  depthStrength: 6.0,
  mouseRadius: 6.0,
  sphereRadius: 6.0,
  sphereStrength: 0.82,
  sphereMass: 0.62,
  spatialDepth: 8.0,
  sphereSurfaceBend: 52.0,
  escapeSpeed: 0.72,
  escapeMotion: 1.0,
  escapeBrightness: 1.7,
  escapeOpacity: 1.8,
  colorShiftSpeed: 0.12,
  audioDance: false,
  danceStrength: 1.0,
  depthWave: 0.35
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
let haloGeometry: THREE.BufferGeometry;
let haloMaterial: THREE.ShaderMaterial;
let haloMesh: THREE.Points;
let interactionSphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
let currentImageSrc = '';

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
    vec2 squareCoord = abs(gl_PointCoord - vec2(0.5));
    float squareMask = 1.0 - smoothstep(0.44, 0.5, max(squareCoord.x, squareCoord.y));
    if (squareMask <= 0.01) discard;
    float dist = distance(gl_PointCoord, vec2(0.5));
    
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
    
    float alpha = squareMask * vAlpha * mix(0.86, 1.12, vScatter);
    float core = smoothstep(0.34, 0.0, dist);
    color += core * mix(vec3(0.06, 0.12, 0.18), vec3(0.24), vScatter);
    
    gl_FragColor = vec4(color, alpha);
  }
`;

const haloVertexShader = `
  uniform float uTime;
  uniform float uParticleSize;
  uniform float uFlowSpeed;
  uniform float uFlowAmplitude;
  uniform vec3 uSphereCenter;
  uniform vec3 uSphereVelocity;
  uniform float uSphereRadius;
  uniform float uSphereStrength;
  uniform float uSphereMass;
  uniform float uEscapeSpeed;
  uniform float uEscapeMotion;
  uniform float uEscapeBrightness;
  uniform float uEscapeOpacity;

  attribute vec3 color;
  attribute float size;
  attribute float alpha;
  attribute vec3 escapeDirection;
  attribute float escapeStrength;
  attribute float escapePhase;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vEscapeMix;

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
    vColor = color;
    vAlpha = alpha;
    vEscapeMix = clamp(escapeStrength / 58.0, 0.0, 1.0);

    vec3 pos = position;
    vec2 drift = vec2(
      snoise(vec3(pos.xy * 0.022, uTime * uFlowSpeed * 0.25)),
      snoise(vec3(pos.yx * 0.022, uTime * uFlowSpeed * 0.25 + 19.0))
    );
    pos.xy += drift * uFlowAmplitude * 2.8;
    pos.z += snoise(vec3(pos.xy * 0.015, uTime * 0.2)) * 1.4;

    float escapeCycle = fract(escapePhase + uTime * uEscapeSpeed * (0.16 + escapeStrength * 0.28));
    float escapeEase = smoothstep(0.0, 0.28, escapeCycle) * (1.0 - smoothstep(0.72, 1.0, escapeCycle));
    float escapeTravel = escapeCycle * escapeStrength * uEscapeMotion;
    vec3 escapeDir = normalize(escapeDirection + vec3(0.001, 0.001, 0.0));
    vec2 escapeFlutter = vec2(
      snoise(vec3(position.xy * 0.035, uTime * 0.55 + escapePhase * 17.0)),
      snoise(vec3(position.yx * 0.035, uTime * 0.55 + escapePhase * 31.0))
    );
    pos += escapeDir * escapeTravel * escapeEase;
    pos.xy += escapeFlutter * escapeStrength * 0.11 * escapeEase * uEscapeMotion;
    vColor = mix(vColor, vec3(1.0, 0.96, 0.88) * uEscapeBrightness, vEscapeMix * (0.62 + escapeEase * 0.28));
    vAlpha *= mix(1.0, (0.64 + escapeEase * 0.92) * uEscapeOpacity, vEscapeMix);

    vec3 toParticle = pos - uSphereCenter;
    float sphereDist = length(toParticle);
    float sphereRadius = max(uSphereRadius, 0.001);
    vec3 sphereNormal = normalize(toParticle + vec3(0.001, 0.001, 0.001));
    vec3 toSphere = -sphereNormal;
    float gravityRange = sphereRadius * (2.8 + uSphereMass * 0.9);
    float gravity = 1.0 - smoothstep(sphereRadius * 0.9, gravityRange, sphereDist);
    float capture = 1.0 - smoothstep(sphereRadius * 0.22, sphereRadius * 1.24, sphereDist);
    float motion = clamp(length(uSphereVelocity.xy) * 0.045, 0.0, 1.0);
    vec3 tangent = normalize(vec3(-sphereNormal.y, sphereNormal.x, 0.25));

    pos += toSphere * gravity * uSphereStrength * (7.0 + uSphereMass * 3.2);
    pos = mix(pos, uSphereCenter + tangent * sphereRadius * 0.32, capture * clamp(0.08 + uSphereMass * 0.08, 0.0, 0.24));
    pos += tangent * gravity * (1.8 + motion * 3.5);
    pos.xy += normalize(uSphereVelocity.xy + vec2(0.001)) * gravity * motion * 4.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(uParticleSize * size * (300.0 / -mvPosition.z), 0.28, 2.1);
  }
`;

const haloFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEscapeMix;

  void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;

    float core = smoothstep(0.36, 0.0, dist);
    float alpha = smoothstep(0.5, 0.05, dist) * vAlpha * mix(1.0, 1.35 + core * 0.45, vEscapeMix);
    vec3 color = vColor + vec3(core * 0.18 * vEscapeMix);
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
  sphere.renderOrder = 3;
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
    const haloPositions: number[] = [];
    const haloColors: number[] = [];
    const haloSizes: number[] = [];
    const haloAlphas: number[] = [];
    const haloEscapeDirections: number[] = [];
    const haloEscapeStrengths: number[] = [];
    const haloEscapePhases: number[] = [];
    
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
        const visibleImage = reveal * smoothstep(0.025, 0.12, subject);
        const dustChance = Math.max(edgeStrength * 0.72, borderDust * 0.9) * subject;
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

        const contourDensity = clamp(subject * (edgeStrength * 1.55 + borderDust * 0.42 + edgeDensity * 0.18), 0, 1);
        if (contourDensity > 0.18 && hash2(x, y, 14) < contourDensity * 0.78) {
          const tightJitter = 0.22 + contourDensity * 0.46;
          const contourX = posX + (hash2(x, y, 15) - 0.5) * stepX * tightJitter;
          const contourY = posY + (hash2(x, y, 16) - 0.5) * stepY * tightJitter;
          const contourZ = posZ + (hash2(x, y, 17) - 0.5) * depthArea * 0.035;
          const contourScatter = clamp(scatter * 0.55 + edgeStrength * 0.08, 0, 0.28);
          pushParticle(contourX, contourY, contourZ, r, g, b, brightness, contourScatter, centerDensity, edgeStrength, 20);
        }

        if (edgeStrength > 0.22 && subject > 0.3 && hash2(x, y, 18) < contourDensity * 0.34) {
          const microX = posX + (hash2(x, y, 19) - 0.5) * stepX * 0.92;
          const microY = posY + (hash2(x, y, 20) - 0.5) * stepY * 0.92;
          const microZ = posZ + (hash2(x, y, 21) - 0.5) * depthArea * 0.05;
          const microScatter = clamp(scatter * 0.72 + edgeStrength * 0.1, 0, 0.32);
          pushParticle(microX, microY, microZ, r, g, b, brightness, microScatter, centerDensity, edgeStrength, 40);
        }

        const haloChance = clamp(edgeStrength * 0.9 + borderDust * 0.95 + outerFalloff * 0.08, 0, 0.92);
        if (hash2(x, y, 8) < haloChance && subject > 0.18) {
          const haloDistance = 0.25 + hash2(x, y, 9) * 1.45;
          const radialX = nx / (Math.sqrt(nx * nx + ny * ny) + 0.001);
          const radialY = ny / (Math.sqrt(nx * nx + ny * ny) + 0.001);
          const haloJitterX = (hash2(x, y, 10) - 0.5) * stepX * (5.5 + haloDistance * 4.0);
          const haloJitterY = (hash2(x, y, 11) - 0.5) * stepY * (5.5 + haloDistance * 4.0);
          const haloX = posX + radialX * haloDistance * (7.0 + borderDust * 11.0) + haloJitterX;
          const haloY = posY - radialY * haloDistance * (7.0 + borderDust * 11.0) + haloJitterY;
          const glow = clamp(0.86 + brightness * 0.72 + edgeStrength * 0.42, 0.45, 1.65);
          const haloRadius = clamp(Math.sqrt(haloX * haloX + haloY * haloY) / curvedSurfaceRadius, 0, 0.98);
          const haloSurfaceZ = (Math.sqrt(1 - haloRadius * haloRadius) - 1) * curvedSurfaceLift + haloRadius * haloRadius * depthArea * 0.08;

          haloPositions.push(haloX, haloY, haloSurfaceZ + imageRelief * 0.45 + (hash2(x, y, 12) - 0.5) * depthArea * 0.16);
          haloColors.push(
            clamp(r * glow + 0.42, 0, 1),
            clamp(g * glow + 0.42, 0, 1),
            clamp(b * glow + 0.42, 0, 1)
          );
          haloSizes.push(0.22 + hash2(x, y, 13) * 0.42 + edgeStrength * 0.32);
          haloAlphas.push(clamp(0.1 + edgeStrength * 0.28 + borderDust * 0.24, 0.05, 0.5));
          haloEscapeDirections.push(0, 0, 0);
          haloEscapeStrengths.push(0);
          haloEscapePhases.push(0);
        }

        const escapeChance = clamp((borderDust * 0.92 + edgeStrength * 0.34 + outerFalloff * 0.14) * subject, 0, 0.78);
        if (hash2(x, y, 90) < escapeChance && subject > 0.18) {
          const edgeLength = Math.sqrt(nx * nx + ny * ny) + 0.001;
          const radialX = nx / edgeLength;
          const radialY = ny / edgeLength;
          const windX = -0.42;
          const windY = 0.24;
          const escapeDistance = 14.0 + hash2(x, y, 91) * 42.0 + borderDust * 34.0;
          const escapeWander = 4.0 + hash2(x, y, 92) * 12.0;
          const escapeX = posX + radialX * escapeDistance + windX * escapeWander + (hash2(x, y, 93) - 0.5) * stepX * 12.0;
          const escapeY = posY - radialY * escapeDistance + windY * escapeWander + (hash2(x, y, 94) - 0.5) * stepY * 12.0;
          const escapeRadius = clamp(Math.sqrt(escapeX * escapeX + escapeY * escapeY) / curvedSurfaceRadius, 0, 0.98);
          const escapeSurfaceZ = (Math.sqrt(1 - escapeRadius * escapeRadius) - 1) * curvedSurfaceLift + escapeRadius * escapeRadius * depthArea * 0.08;
          const fade = 1 - smoothstep(34.0, 96.0, escapeDistance);
          const glow = clamp(1.2 + brightness * 0.95 + edgeStrength * 0.45, 0.75, 2.1);

          haloPositions.push(escapeX, escapeY, escapeSurfaceZ + imageRelief * 0.28 + (hash2(x, y, 95) - 0.5) * depthArea * 0.12);
          haloColors.push(
            clamp(r * glow + 0.48, 0, 1),
            clamp(g * glow + 0.48, 0, 1),
            clamp(b * glow + 0.48, 0, 1)
          );
          haloSizes.push(0.24 + hash2(x, y, 96) * 0.46 + edgeStrength * 0.26);
          haloAlphas.push(clamp((0.14 + edgeStrength * 0.24 + borderDust * 0.3) * fade, 0.08, 0.62));
          haloEscapeDirections.push(radialX * 0.88 + windX * 0.28, -radialY * 0.88 + windY * 0.28, (hash2(x, y, 97) - 0.5) * 0.08);
          haloEscapeStrengths.push(8.0 + hash2(x, y, 98) * 24.0 + borderDust * 18.0);
          haloEscapePhases.push(hash2(x, y, 99));
        }
      }
    }
    
    console.log('Particles created:', positions.length / 3, 'Halo particles:', haloPositions.length / 3);
    
    if (particlesMesh) {
      scene.remove(particlesMesh);
      particlesGeometry.dispose();
      particlesMaterial.dispose();
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
    
    particlesMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
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
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);
    
    haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute(haloPositions, 3));
    haloGeometry.setAttribute('color', new THREE.Float32BufferAttribute(haloColors, 3));
    haloGeometry.setAttribute('size', new THREE.Float32BufferAttribute(haloSizes, 1));
    haloGeometry.setAttribute('alpha', new THREE.Float32BufferAttribute(haloAlphas, 1));
    haloGeometry.setAttribute('escapeDirection', new THREE.Float32BufferAttribute(haloEscapeDirections, 3));
    haloGeometry.setAttribute('escapeStrength', new THREE.Float32BufferAttribute(haloEscapeStrengths, 1));
    haloGeometry.setAttribute('escapePhase', new THREE.Float32BufferAttribute(haloEscapePhases, 1));
    
    haloMaterial = new THREE.ShaderMaterial({
      vertexShader: haloVertexShader,
      fragmentShader: haloFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uParticleSize: { value: config.particleSize },
        uFlowSpeed: { value: config.flowSpeed },
        uFlowAmplitude: { value: config.flowAmplitude },
        uSphereCenter: { value: sphereCenter.clone() },
        uSphereVelocity: { value: sphereVelocity.clone() },
        uSphereRadius: { value: config.sphereRadius },
        uSphereStrength: { value: config.sphereStrength },
        uSphereMass: { value: config.sphereMass },
        uEscapeSpeed: { value: config.escapeSpeed },
        uEscapeMotion: { value: config.escapeMotion },
        uEscapeBrightness: { value: config.escapeBrightness },
        uEscapeOpacity: { value: config.escapeOpacity }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    
    haloMesh = new THREE.Points(haloGeometry, haloMaterial);
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
gui.add(config, 'flowSpeed', 0, 5).name('流动速度').onChange(v => {
  if (particlesMaterial) particlesMaterial.uniforms.uFlowSpeed.value = v;
  if (haloMaterial) haloMaterial.uniforms.uFlowSpeed.value = v;
});
gui.add(config, 'flowAmplitude', 0, 5).name('流动幅度').onChange(v => {
  if (particlesMaterial) particlesMaterial.uniforms.uFlowAmplitude.value = v;
  if (haloMaterial) haloMaterial.uniforms.uFlowAmplitude.value = v;
});
gui.add(config, 'escapeSpeed', 0, 2).name('逃逸速度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeSpeed.value = v;
});
gui.add(config, 'escapeMotion', 0, 2.5).name('逃逸幅度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeMotion.value = v;
});
gui.add(config, 'escapeBrightness', 0.5, 3.5).name('逃逸亮度').onChange(v => {
  if (haloMaterial) haloMaterial.uniforms.uEscapeBrightness.value = v;
});
gui.add(config, 'escapeOpacity', 0.4, 3.0).name('逃逸透明度').onChange(v => {
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
