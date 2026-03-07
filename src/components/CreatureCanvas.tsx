"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Vector2 } from "three";

// ── Simplex 3D noise (compact implementation) ────────────────────────────────

const F3 = 1 / 3;
const G3 = 1 / 6;
const grad3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
}

function simplex3(xin: number, yin: number, zin: number): number {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  let i1: number, j1: number, k1: number;
  let i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) { t0 *= t0; const gi = permMod12[ii + perm[jj + perm[kk]]]; n0 = t0 * t0 * (grad3[gi][0] * x0 + grad3[gi][1] * y0 + grad3[gi][2] * z0); }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) { t1 *= t1; const gi = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; n1 = t1 * t1 * (grad3[gi][0] * x1 + grad3[gi][1] * y1 + grad3[gi][2] * z1); }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) { t2 *= t2; const gi = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; n2 = t2 * t2 * (grad3[gi][0] * x2 + grad3[gi][1] * y2 + grad3[gi][2] * z2); }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) { t3 *= t3; const gi = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; n3 = t3 * t3 * (grad3[gi][0] * x3 + grad3[gi][1] * y3 + grad3[gi][2] * z3); }
  return 32 * (n0 + n1 + n2 + n3);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTER_COUNT = 40000;     // dense packed shell
const INNER_COUNT = 22000;     // rich inner volume
const TENDRIL_COUNT = 7;
const PARTICLES_PER_TENDRIL = 600;
const OUTER_RADIUS = 260;
const STREAM_COUNT = 600;

// ── Shaders ───────────────────────────────────────────────────────────────────

// Sphere layers — breathe + global dim + core brightness
const SPHERE_VERT = /* glsl */ `
  uniform float breathe;
  uniform float uGlobalAlpha;
  attribute float size;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha * uGlobalAlpha;
    vec3 pos = position * breathe;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPHERE_FRAG = /* glsl */ `
  uniform float uCoreBrightness;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    // Hard bright center, tight falloff — crystal not dust
    float alpha = 1.0 - smoothstep(0.0, 0.5, d);
    alpha = pow(alpha, 2.5);          // tight dim point, not a fat disc
    float core = max(0.0, 1.0 - d * 8.0);
    vec3 lit = vColor * uCoreBrightness + vec3(core * 0.1);
    gl_FragColor = vec4(lit, alpha * vAlpha);
  }
`;

// Stream particles — age-based color, no sphere breathe
const STREAM_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 aStreamColor;
  attribute float aStreamAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aStreamColor;
    vAlpha = aStreamAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STREAM_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = max(0.0, 1.0 - d * 2.5);
    alpha = pow(alpha, 1.2);
    gl_FragColor = vec4(vColor, alpha * vAlpha);
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface CreatureRef {
  triggerFeed: (
    x: number,
    y: number,
    noteData: { wordCount: number; tags: string[] }
  ) => void;
  triggerSeek: (query: string) => void;
  setDimmed: (dimmed: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const CreatureCanvas = forwardRef<CreatureRef>(function CreatureCanvas(
  _props,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);

  // Bridge: dispatch window events so the Three.js loop (inside useEffect)
  // can react without cross-closure coupling.
  useImperativeHandle(ref, () => ({
    triggerFeed(_x, _y, _noteData) {
      window.dispatchEvent(new CustomEvent("creature-start-feeding"));
    },
    triggerSeek(_query) {},
    setDimmed(dimmed) {
      window.dispatchEvent(new CustomEvent("creature-dim", { detail: dimmed }));
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    // ── Renderer ──────────────────────────────────────────────────────────────

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 1);

    const scene = new Scene();

    // ── Camera — orthographic, centered at origin ─────────────────────────────
    // Sphere radius = 260. We want it to fill ~55% of viewport height.
    // visibleHalfH is constant — only aspect changes on resize.
    const visibleHalfH = OUTER_RADIUS / 0.55;
    let aspect = width / height;
    const camera = new OrthographicCamera(
      -visibleHalfH * aspect,
      visibleHalfH * aspect,
      visibleHalfH,
      -visibleHalfH,
      -1000,
      1000
    );
    camera.position.z = 500;

    // ── Screen → world coordinate conversion ─────────────────────────────────
    // Used to convert char screen positions to Three.js world units.
    const screenToWorld = (sx: number, sy: number): [number, number] => [
      (sx / width - 0.5) * visibleHalfH * aspect * 2,
      -(sy / height - 0.5) * visibleHalfH * 2,
    ];

    // ── Bloom ─────────────────────────────────────────────────────────────────

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      0.45,
      0.5,
      0.5
    );
    composer.addPass(bloomPass);

    // ── Sphere group ──────────────────────────────────────────────────────────

    const sphereGroup = new Group();
    scene.add(sphereGroup);

    // ── LAYER 1: Outer shell — 14000 particles on sphere surface with noise ──

    const outerPositions = new Float32Array(OUTER_COUNT * 3);
    const outerColors = new Float32Array(OUTER_COUNT * 3);
    const outerAlphas = new Float32Array(OUTER_COUNT);
    const outerSizes = new Float32Array(OUTER_COUNT);

    const colPaleBW = hexToRgb("#ddeeff");     // colder white-blue
    const colMedBlue = hexToRgb("#4488ff");    // electric mid blue
    const colDeepBlue = hexToRgb("#1133bb");   // deep navy

    for (let i = 0; i < OUTER_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      const noiseVal = simplex3(nx * 3, ny * 3, nz * 3);
      const r = OUTER_RADIUS + noiseVal * 45;

      outerPositions[i * 3] = nx * r;
      outerPositions[i * 3 + 1] = ny * r;
      outerPositions[i * 3 + 2] = nz * r;

      let col: [number, number, number];
      if (r > 275) {
        col = colPaleBW;                              // tips: cold white
      } else if (r > 240) {
        col = lerpColor(colMedBlue, colPaleBW, (r - 240) / 35);
      } else {
        col = lerpColor(colDeepBlue, colMedBlue, Math.max(0, (r - 200) / 40));
      }

      outerColors[i * 3]     = col[0];
      outerColors[i * 3 + 1] = col[1];
      outerColors[i * 3 + 2] = col[2];
      // Particles furthest from surface = biggest/brightest
      // They are the "note particles" — distinct, countable
      const t = Math.max(0, (r - (OUTER_RADIUS - 30)) / 75);
      if (t > 0.6) {
        // Outermost spike tips — large, countable, star-like
        outerAlphas[i] = 0.60 + Math.random() * 0.25; // 0.60–0.85
        outerSizes[i]  = 4.5 + Math.random() * 3.0;   // 4.5–7.5px
      } else if (t > 0.2) {
        // Mid-shell — dense visible blue points
        outerAlphas[i] = 0.40 + Math.random() * 0.18; // 0.40–0.58
        outerSizes[i]  = 2.5 + Math.random() * 2.0;   // 2.5–4.5px
      } else {
        // Base shell — smaller but still legible
        outerAlphas[i] = 0.22 + Math.random() * 0.12; // 0.22–0.34
        outerSizes[i]  = 1.5 + Math.random() * 1.0;   // 1.5–2.5px
      }
    }

    const outerGeo = new BufferGeometry();
    outerGeo.setAttribute("position", new BufferAttribute(outerPositions, 3));
    outerGeo.setAttribute("aColor", new BufferAttribute(outerColors, 3));
    outerGeo.setAttribute("aAlpha", new BufferAttribute(outerAlphas, 1));
    outerGeo.setAttribute("size", new BufferAttribute(outerSizes, 1));

    const outerMat = new ShaderMaterial({
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      uniforms: {
        breathe: { value: 1.0 },
        uGlobalAlpha: { value: 1.0 },
        uCoreBrightness: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    sphereGroup.add(new Points(outerGeo, outerMat));

    // ── LAYER 2: Inner volume — 10000 particles, denser toward center ─────────

    const innerPositions = new Float32Array(INNER_COUNT * 3);
    const innerColors = new Float32Array(INNER_COUNT * 3);
    const innerAlphas = new Float32Array(INNER_COUNT);
    const innerSizes = new Float32Array(INNER_COUNT);

    const colInnerBlue = hexToRgb("#2244aa");    // deep cold blue outer ring
    const colOrange = hexToRgb("#ff4400");       // burning orange mid
    const colRed = hexToRgb("#ff5500");          // burning orange core

    // Petal void axes — 6 directions that carve dark claws
    const PETAL_COUNT = 6;
    const petalAxes: [number, number, number][] = [];
    for (let p = 0; p < PETAL_COUNT; p++) {
      const angle = (p / PETAL_COUNT) * Math.PI * 2;
      // Tilted petal axes so they're visible at the front
      petalAxes.push([
        Math.cos(angle) * 0.85,
        Math.sin(angle) * 0.85,
        0.3 + Math.random() * 0.4,
      ]);
    }

    let innerPlaced = 0;
    let innerAttempts = 0;
    while (innerPlaced < INNER_COUNT && innerAttempts < INNER_COUNT * 12) {
      innerAttempts++;
      const r = OUTER_RADIUS * Math.pow(Math.random(), 0.4);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      const i = innerPlaced;

      // Carve dark petal voids in the mid-shell region (r 80–200)
      if (r > 80 && r < 200) {
        let inPetalVoid = false;
        for (const axis of petalAxes) {
          // Dot product = angular alignment with petal axis
          const dot = nx * axis[0] + ny * axis[1] + nz * axis[2];
          const alignedLength = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
          const cosAngle = dot / alignedLength;
          // Void threshold: angular cone of ~28 degrees
          const voidWidth = 0.12 + (r / OUTER_RADIUS) * 0.10;
          if (cosAngle > (1 - voidWidth)) {
            inPetalVoid = true;
            break;
          }
        }
        if (inPetalVoid) continue; // skip — creates the dark petal shapes
      }

      innerPositions[i * 3]     = nx * r;
      innerPositions[i * 3 + 1] = ny * r;
      innerPositions[i * 3 + 2] = nz * r;

      let col: [number, number, number];
      let alpha: number;
      let size: number;

      if (r > 130 && r < 200) {
        // Dark moat — only keep 12% of particles here
        if (Math.random() > 0.04) continue;
        col = colDeepBlue;
        alpha = 0.15;
        size = 0.8;
      } else if (r > 200) {
        col = lerpColor(colInnerBlue, colMedBlue, (r - 200) / 60);
        alpha = 0.55 + Math.random() * 0.20;  // bright blue bridge ring
        size = 3.0 + Math.random() * 2.5;     // 3–5.5px — large, visible
      } else if (r > 90) {
        // Mid ring: deep blue, structured
        col = colInnerBlue;
        alpha = 0.38;
        size = 1.1;
      } else if (r > 45) {
        // Transition to hot core: blue → orange
        col = lerpColor(colOrange, colInnerBlue, (r - 45) / 45);
        alpha = 0.55;
        size = 1.4;
      } else if (r > 18) {
        // Inner hot zone: orange
        col = colOrange;
        alpha = 0.75;
        size = 2.0;
      } else {
        // Dead center: WHITE-HOT burning point, very dense
        col = colRed;  // #ffffff
        alpha = 0.95;
        size = 3.2;
      }

      innerColors[i * 3]     = col[0];
      innerColors[i * 3 + 1] = col[1];
      innerColors[i * 3 + 2] = col[2];
      innerAlphas[i] = alpha;
      innerSizes[i]  = size;
      innerPlaced++;
    }

    const innerGeo = new BufferGeometry();
    innerGeo.setAttribute("position", new BufferAttribute(innerPositions, 3));
    innerGeo.setAttribute("aColor", new BufferAttribute(innerColors, 3));
    innerGeo.setAttribute("aAlpha", new BufferAttribute(innerAlphas, 1));
    innerGeo.setAttribute("size", new BufferAttribute(innerSizes, 1));

    const innerMat = new ShaderMaterial({
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      uniforms: {
        breathe: { value: 1.0 },
        uGlobalAlpha: { value: 1.0 },
        uCoreBrightness: { value: 1.0 }, // animated on feeding
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    sphereGroup.add(new Points(innerGeo, innerMat));

    // ── LAYER 3: Core glow sprite ─────────────────────────────────────────────

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const ctx = glowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0,    "rgba(255, 255, 255, 1.0)");  // blinding white
    gradient.addColorStop(0.08, "rgba(255, 200, 80, 1.0)");   // sear yellow
    gradient.addColorStop(0.2,  "rgba(255, 40, 0, 0.95)");    // violent red
    gradient.addColorStop(0.38, "rgba(180, 0, 80, 0.7)");     // deep magenta-red
    gradient.addColorStop(0.55, "rgba(60, 0, 40, 0.35)");     // dark violet
    gradient.addColorStop(0.75, "rgba(10, 0, 10, 0.1)");
    gradient.addColorStop(1,    "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const glowTexture = new CanvasTexture(glowCanvas);
    const glowMat = new SpriteMaterial({
      map: glowTexture,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const glowSprite = new Sprite(glowMat);
    glowSprite.scale.set(90, 90, 1);
    glowSprite.position.set(0, 0, 1);
    sphereGroup.add(glowSprite);

    // ── LAYER 4: Spike tendrils — 8 tendrils ─────────────────────────────────

    const tendrilTotalParticles = TENDRIL_COUNT * PARTICLES_PER_TENDRIL;
    const tendrilPositions = new Float32Array(tendrilTotalParticles * 3);
    const tendrilColors = new Float32Array(tendrilTotalParticles * 3);
    const tendrilAlphas = new Float32Array(tendrilTotalParticles);
    const tendrilSizes = new Float32Array(tendrilTotalParticles);

    const tendrilBasePoints: {
      nx: number; ny: number; nz: number; length: number;
    }[] = [];
    for (let t = 0; t < TENDRIL_COUNT; t++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      tendrilBasePoints.push({
        nx: Math.sin(phi) * Math.cos(theta),
        ny: Math.sin(phi) * Math.sin(theta),
        nz: Math.cos(phi),
        length: 200 + Math.random() * 280,
      });
    }

    for (let t = 0; t < TENDRIL_COUNT; t++) {
      const base = tendrilBasePoints[t];
      for (let p = 0; p < PARTICLES_PER_TENDRIL; p++) {
        const idx = t * PARTICLES_PER_TENDRIL + p;
        const progress = p / PARTICLES_PER_TENDRIL;
        // Bright at base (emerging from blue shell),
        // dark and thin at tips
        const tipFade = Math.pow(1 - progress, 0.5);
        tendrilColors[idx * 3]     = colMedBlue[0] * tipFade;
        tendrilColors[idx * 3 + 1] = colMedBlue[1] * tipFade;
        tendrilColors[idx * 3 + 2] = colMedBlue[2] * tipFade;
        tendrilAlphas[idx] = 0.45 * tipFade;
        // Base size varies by arm — some thick, some medium
        const armThickness = 2.5 + (t % 3) * 1.5; // 2.5, 4.0, 5.5 cycling
        tendrilSizes[idx]  = armThickness * tipFade + 0.4;
      }
    }

    const tendrilGeo = new BufferGeometry();
    tendrilGeo.setAttribute("position", new BufferAttribute(tendrilPositions, 3));
    tendrilGeo.setAttribute("aColor", new BufferAttribute(tendrilColors, 3));
    tendrilGeo.setAttribute("aAlpha", new BufferAttribute(tendrilAlphas, 1));
    tendrilGeo.setAttribute("size", new BufferAttribute(tendrilSizes, 1));

    const tendrilMat = new ShaderMaterial({
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      uniforms: {
        breathe: { value: 1.0 },
        uGlobalAlpha: { value: 1.0 },
        uCoreBrightness: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    sphereGroup.add(new Points(tendrilGeo, tendrilMat));

    // ── LAYER 5: Feeding stream — 600 particles, not part of sphere group ──────

    const streamPos = new Float32Array(STREAM_COUNT * 3);
    const streamColors = new Float32Array(STREAM_COUNT * 3);
    const streamAlphas = new Float32Array(STREAM_COUNT);
    const streamSizes = new Float32Array(STREAM_COUNT);

    // Per-particle state (CPU side, not GPU attributes)
    const streamT = new Float32Array(STREAM_COUNT);
    const streamAlive = new Uint8Array(STREAM_COUNT);
    const streamOriginX = new Float32Array(STREAM_COUNT);
    const streamOriginY = new Float32Array(STREAM_COUNT);

    for (let i = 0; i < STREAM_COUNT; i++) {
      streamPos[i * 3] = -99999;
      streamPos[i * 3 + 1] = -99999;
      streamPos[i * 3 + 2] = 0;
      streamSizes[i] = 1.0;
    }

    const streamGeo = new BufferGeometry();
    streamGeo.setAttribute("position", new BufferAttribute(streamPos, 3));
    streamGeo.setAttribute("aStreamColor", new BufferAttribute(streamColors, 3));
    streamGeo.setAttribute("aStreamAlpha", new BufferAttribute(streamAlphas, 1));
    streamGeo.setAttribute("size", new BufferAttribute(streamSizes, 1));

    const streamMat = new ShaderMaterial({
      vertexShader: STREAM_VERT,
      fragmentShader: STREAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    // Added to scene directly — NOT sphereGroup — so it doesn't rotate
    scene.add(new Points(streamGeo, streamMat));

    // Stream color palettes (percolation reference)
    const colCyan = hexToRgb("#00ccff");
    const colAmber = hexToRgb("#ffaa00");
    const colDeepRed = hexToRgb("#ff2800");

    // ── Dynamic state ─────────────────────────────────────────────────────────

    let feedActive = false;
    let feedTargetWorldX = 0;
    let feedTargetWorldY = 0;
    let coreBrightness = 1.0;
    let coreBrightnessTarget = 1.0;
    let globalAlpha = 1.0;
    let globalAlphaTarget = 1.0;

    // ── Event handlers ────────────────────────────────────────────────────────

    const onStartFeeding = () => {
      feedActive = true;
      coreBrightnessTarget = 2.2;
      const [wx, wy] = screenToWorld(width * 0.5, height * 0.18);
      feedTargetWorldX = wx;
      feedTargetWorldY = wy;
    };

    const onStopFeeding = () => {
      feedActive = false;
      coreBrightnessTarget = 1.0;
      // Kill all stream particles immediately
      for (let i = 0; i < STREAM_COUNT; i++) {
        streamAlive[i] = 0;
        streamPos[i * 3] = -99999;
        streamPos[i * 3 + 1] = -99999;
        streamAlphas[i] = 0;
      }
      (streamGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (streamGeo.getAttribute("aStreamAlpha") as BufferAttribute).needsUpdate = true;
    };

    const onCharConsumed = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      [feedTargetWorldX, feedTargetWorldY] = screenToWorld(x, y);
    };

    const handleDim = (e: Event) => {
      const dim = (e as CustomEvent<boolean>).detail;
      globalAlphaTarget = dim ? 0.12 : 1.0;
    };

    window.addEventListener("creature-start-feeding", onStartFeeding);
    window.addEventListener("creature-stop-feeding", onStopFeeding);
    window.addEventListener("creature-char-consumed", onCharConsumed);
    window.addEventListener("creature-dim", handleDim);

    // ── Animation loop ────────────────────────────────────────────────────────

    let time = 0;

    function animate() {
      time += 0.016;

      // ── Breathing ──────────────────────────────────────────────────────────
      const breathe = Math.sin(time * 0.35) * 0.055 + 1.0;
      outerMat.uniforms.breathe.value = breathe;
      innerMat.uniforms.breathe.value = breathe;
      tendrilMat.uniforms.breathe.value = breathe;

      // ── Rotation ───────────────────────────────────────────────────────────
      sphereGroup.rotation.y += 0.00018;
      sphereGroup.rotation.x += 0;

      // ── Part C: Core brightness (feeding response) ─────────────────────────
      // Ramp up fast (40 frames), decay slow (120 frames)
      const brightnessLerp = coreBrightness < coreBrightnessTarget ? 0.05 : 0.015;
      coreBrightness += (coreBrightnessTarget - coreBrightness) * brightnessLerp;
      innerMat.uniforms.uCoreBrightness.value = coreBrightness;
      // Pulse sprite scale with brightness
      const spriteScale = 90 * (0.7 + 0.5 * coreBrightness);
      glowSprite.scale.set(spriteScale, spriteScale, 1);

      // ── Part D: Global dim (search overlay) ────────────────────────────────
      const alphaLerp = globalAlphaTarget < globalAlpha ? 0.05 : 0.04;
      globalAlpha += (globalAlphaTarget - globalAlpha) * alphaLerp;
      outerMat.uniforms.uGlobalAlpha.value = globalAlpha;
      innerMat.uniforms.uGlobalAlpha.value = globalAlpha;
      tendrilMat.uniforms.uGlobalAlpha.value = globalAlpha;
      glowMat.opacity = globalAlpha;

      // ── Part B: Stream particle system ─────────────────────────────────────
      if (feedActive) {
        // Emit 8 particles per frame from current target position
        const spreadWorld = (80 / height) * visibleHalfH * 2;
        let emitted = 0;
        for (let i = 0; i < STREAM_COUNT && emitted < 8; i++) {
          if (!streamAlive[i]) {
            streamAlive[i] = 1;
            streamT[i] = 0;
            streamOriginX[i] = feedTargetWorldX + (Math.random() - 0.5) * spreadWorld;
            streamOriginY[i] = feedTargetWorldY;
            emitted++;
          }
        }
      }

      // Update all alive stream particles
      const posArr = streamGeo.getAttribute("position").array as Float32Array;
      const colArr = streamGeo.getAttribute("aStreamColor").array as Float32Array;
      const alphaArr = streamGeo.getAttribute("aStreamAlpha").array as Float32Array;

      for (let i = 0; i < STREAM_COUNT; i++) {
        if (!streamAlive[i]) continue;

        streamT[i] += 0.008 + Math.random() * 0.003;
        const t = streamT[i];

        if (t >= 1.0) {
          streamAlive[i] = 0;
          posArr[i * 3] = -99999;
          posArr[i * 3 + 1] = -99999;
          posArr[i * 3 + 2] = 0;
          alphaArr[i] = 0;
          continue;
        }

        // Arc: lerp from origin to sphere center (0,0), sine wiggle
        posArr[i * 3] = streamOriginX[i] * (1 - t)
          + Math.sin(t * Math.PI + i * 0.3) * 30;
        posArr[i * 3 + 1] = streamOriginY[i] * (1 - t);
        posArr[i * 3 + 2] = 0;

        // Age-based color: cyan → amber → deep red (percolation reference)
        let col: [number, number, number];
        if (t < 0.3) {
          col = lerpColor(colCyan, colAmber, t / 0.3);
        } else if (t < 0.7) {
          col = lerpColor(colAmber, colDeepRed, (t - 0.3) / 0.4);
        } else {
          col = colDeepRed;
        }
        colArr[i * 3] = col[0];
        colArr[i * 3 + 1] = col[1];
        colArr[i * 3 + 2] = col[2];

        // Alpha: fade in (0→0.1), full (0.1→0.8), fade out (0.8→1.0)
        const fadeIn = Math.min(1, t / 0.1);
        const fadeOut = Math.max(0, 1 - Math.max(0, (t - 0.8) / 0.2));
        alphaArr[i] = 0.6 * fadeIn * fadeOut;
      }

      (streamGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (streamGeo.getAttribute("aStreamColor") as BufferAttribute).needsUpdate = true;
      (streamGeo.getAttribute("aStreamAlpha") as BufferAttribute).needsUpdate = true;

      // ── Tendril animation (writhing) ───────────────────────────────────────
      const tPos = tendrilGeo.getAttribute("position").array as Float32Array;
      for (let t = 0; t < TENDRIL_COUNT; t++) {
        const base = tendrilBasePoints[t];
        for (let p = 0; p < PARTICLES_PER_TENDRIL; p++) {
          const idx = t * PARTICLES_PER_TENDRIL + p;
          const progress = p / PARTICLES_PER_TENDRIL;
          const dist = OUTER_RADIUS + progress * base.length;
          const warp = time * 0.8 + t * 1.3;
          const ns = 0.04;
          const dx = simplex3(base.nx * dist * ns + warp, base.ny * dist * ns + 100, base.nz * dist * ns) * 80 * progress;
          const dy = simplex3(base.nx * dist * ns + 200, base.ny * dist * ns + warp, base.nz * dist * ns) * 80 * progress;
          const dz = simplex3(base.nx * dist * ns, base.ny * dist * ns + 300, base.nz * dist * ns + warp) * 80 * progress;
          tPos[idx * 3]     = base.nx * dist + dx;
          tPos[idx * 3 + 1] = base.ny * dist + dy;
          tPos[idx * 3 + 2] = base.nz * dist + dz;
        }
      }
      (tendrilGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;

      composer.render();
      animFrameRef.current = window.requestAnimationFrame(animate);
    }

    animFrameRef.current = window.requestAnimationFrame(animate);

    // ── Resize ────────────────────────────────────────────────────────────────

    function onResize() {
      width = window.innerWidth;
      height = window.innerHeight;
      aspect = width / height;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      camera.left = -visibleHalfH * aspect;
      camera.right = visibleHalfH * aspect;
      camera.top = visibleHalfH;
      camera.bottom = -visibleHalfH;
      camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", onResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("creature-start-feeding", onStartFeeding);
      window.removeEventListener("creature-stop-feeding", onStopFeeding);
      window.removeEventListener("creature-char-consumed", onCharConsumed);
      window.removeEventListener("creature-dim", handleDim);
      outerGeo.dispose();
      outerMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      tendrilGeo.dispose();
      tendrilMat.dispose();
      streamGeo.dispose();
      streamMat.dispose();
      glowTexture.dispose();
      glowMat.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
});

export default CreatureCanvas;
