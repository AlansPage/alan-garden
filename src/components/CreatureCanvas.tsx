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

const OUTER_COUNT  = 65000;  // dense blue crystalline shell
const MOAT_COUNT   = 28000;  // attempts for sparse spiked dark moat
const CORE_COUNT   = 20000;  // hot red/orange core
const STREAM_COUNT = 600;

const OUTER_RADIUS  = 260;   // nominal sphere radius (world units)
const SHELL_INNER   = 168;   // inner edge of blue outer shell
const MOAT_INNER    = 82;    // inner edge of dark moat / outer edge of core
const SPIKE_COUNT   = 9;     // number of dark radial void spikes

// ── Shaders ───────────────────────────────────────────────────────────────────

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
    float alpha = 1.0 - smoothstep(0.0, 0.5, d);
    alpha = pow(alpha, 2.2);
    float core = max(0.0, 1.0 - d * 7.0);
    vec3 lit = vColor * uCoreBrightness + vec3(core * 0.08);
    gl_FragColor = vec4(lit, alpha * vAlpha);
  }
`;

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

    const visibleHalfH = OUTER_RADIUS / 0.52;
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

    const screenToWorld = (sx: number, sy: number): [number, number] => [
      (sx / width - 0.5) * visibleHalfH * aspect * 2,
      -(sy / height - 0.5) * visibleHalfH * 2,
    ];

    // ── Bloom ─────────────────────────────────────────────────────────────────

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new Vector2(width, height), 0.55, 0.4, 0.72);
    composer.addPass(bloomPass);

    // ── Sphere group ──────────────────────────────────────────────────────────

    const sphereGroup = new Group();
    scene.add(sphereGroup);

    // ── Color palette ─────────────────────────────────────────────────────────

    const colDeepNavy  = hexToRgb("#0a1a55");   // darkest base
    const colDeepBlue  = hexToRgb("#1144cc");   // deep electric blue
    const colMidBlue   = hexToRgb("#3377ff");   // mid blue
    const colBrightBlue = hexToRgb("#66aaff");  // bright blue
    const colColdWhite = hexToRgb("#cce8ff");   // cold white-blue tip
    const colSparkle   = hexToRgb("#ffffff");   // pure white sparkle

    const colCoreWhite  = hexToRgb("#ffffff");  // dead center white
    const colCoreYellow = hexToRgb("#ffdd44");  // hot yellow
    const colCoreOrange = hexToRgb("#ff6600");  // burning orange
    const colCoreRed    = hexToRgb("#dd1100");  // deep red
    const colCoreDarkRed = hexToRgb("#880000"); // outer core edge

    // ── LAYER 1: Outer blue crystalline shell ─────────────────────────────────
    // Dense noisy sphere: r = OUTER_RADIUS ± 55 noise displacement.
    // Only particles beyond SHELL_INNER make it through — creates the thick
    // outer shell with naturally bumpy, irregular inner boundary.

    const outerPositions = new Float32Array(OUTER_COUNT * 3);
    const outerColors    = new Float32Array(OUTER_COUNT * 3);
    const outerAlphas    = new Float32Array(OUTER_COUNT);
    const outerSizes     = new Float32Array(OUTER_COUNT);

    let outerPlaced = 0;
    let outerAttempts = 0;
    while (outerPlaced < OUTER_COUNT && outerAttempts < OUTER_COUNT * 3) {
      outerAttempts++;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      // Two octaves of noise for bumpy, organic shell edge
      const n1 = simplex3(nx * 2.8, ny * 2.8, nz * 2.8);
      const n2 = simplex3(nx * 6.0 + 17, ny * 6.0 + 31, nz * 6.0 + 53) * 0.4;
      const noiseVal = n1 + n2; // -1.4 to 1.4
      const r = OUTER_RADIUS + noiseVal * 50; // 190–330 range

      if (r < SHELL_INNER) continue; // inside the shell inner boundary — skip

      // t=0 at inner boundary, t=1 at outer tips
      const t = Math.max(0, Math.min(1, (r - SHELL_INNER) / (OUTER_RADIUS + 50 - SHELL_INNER)));

      const i = outerPlaced;
      outerPositions[i * 3]     = nx * r;
      outerPositions[i * 3 + 1] = ny * r;
      outerPositions[i * 3 + 2] = nz * r;

      // Color gradient: deep navy → deep blue → mid blue → bright blue → cold white
      let col: [number, number, number];
      if (t > 0.85) {
        // Outermost tips: cold white with slight blue
        col = lerpColor(colColdWhite, colSparkle, (t - 0.85) / 0.15);
      } else if (t > 0.65) {
        col = lerpColor(colBrightBlue, colColdWhite, (t - 0.65) / 0.20);
      } else if (t > 0.38) {
        col = lerpColor(colMidBlue, colBrightBlue, (t - 0.38) / 0.27);
      } else if (t > 0.15) {
        col = lerpColor(colDeepBlue, colMidBlue, (t - 0.15) / 0.23);
      } else {
        col = lerpColor(colDeepNavy, colDeepBlue, t / 0.15);
      }

      outerColors[i * 3]     = col[0];
      outerColors[i * 3 + 1] = col[1];
      outerColors[i * 3 + 2] = col[2];

      // 8% of particles are large "sparkle" stars (mimic the crystalline flash in reference)
      const isStar = Math.random() < 0.08;
      if (t > 0.75) {
        outerAlphas[i] = isStar
          ? 0.55 + Math.random() * 0.30  // bright sparkle star
          : 0.22 + Math.random() * 0.18; // normal tip particle
        outerSizes[i] = isStar
          ? 4.5 + Math.random() * 4.0   // 4.5–8.5px
          : 2.5 + Math.random() * 2.5;  // 2.5–5px
      } else if (t > 0.45) {
        outerAlphas[i] = isStar
          ? 0.35 + Math.random() * 0.20
          : 0.14 + Math.random() * 0.12;
        outerSizes[i] = isStar
          ? 3.0 + Math.random() * 2.5
          : 1.8 + Math.random() * 1.8;
      } else {
        outerAlphas[i] = 0.07 + Math.random() * 0.07;
        outerSizes[i]  = 1.0 + Math.random() * 1.0;
      }

      outerPlaced++;
    }

    const outerGeo = new BufferGeometry();
    outerGeo.setAttribute("position", new BufferAttribute(outerPositions, 3));
    outerGeo.setAttribute("aColor",   new BufferAttribute(outerColors, 3));
    outerGeo.setAttribute("aAlpha",   new BufferAttribute(outerAlphas, 1));
    outerGeo.setAttribute("size",     new BufferAttribute(outerSizes, 1));

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

    // ── LAYER 2: Spiked dark moat ─────────────────────────────────────────────
    // r = MOAT_INNER to SHELL_INNER. Almost entirely empty.
    //
    // SPIKE mechanism: in 2D screen-space projection the angle atan2(ny, nx)
    // determines which "angular slice" the particle falls in. We define SPIKE_COUNT
    // evenly-spaced void cones. Particles in void cones are rejected, creating the
    // dark claw-shaped spikes radiating from the core outward. Surviving bridge
    // particles are then kept at only 4% probability (very sparse).
    //
    // Void width grows with r (narrow at core, wide near outer shell) — this gives
    // the "converging claw" silhouette of the reference image.

    const moatPositions = new Float32Array(MOAT_COUNT * 3);
    const moatColors    = new Float32Array(MOAT_COUNT * 3);
    const moatAlphas    = new Float32Array(MOAT_COUNT);
    const moatSizes     = new Float32Array(MOAT_COUNT);

    const spikePeriod = (Math.PI * 2) / SPIKE_COUNT;
    // Random overall angular offset so spikes aren't always axis-aligned
    const spikePhase  = Math.random() * spikePeriod;

    let moatPlaced = 0;
    let moatAttempts = 0;
    while (moatPlaced < MOAT_COUNT && moatAttempts < MOAT_COUNT * 20) {
      moatAttempts++;

      const r = MOAT_INNER + Math.random() * (SHELL_INNER - MOAT_INNER);
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      // 2D projected angle (orthographic: screen pos = nx*r, ny*r → angle = atan2(ny, nx))
      const angle2D = ((Math.atan2(ny, nx) + Math.PI * 2 + spikePhase) % (Math.PI * 2));
      const withinPeriod = angle2D % spikePeriod;

      // Void half-width grows from 28% of half-period at inner edge to 44% at outer
      const radFraction = (r - MOAT_INNER) / (SHELL_INNER - MOAT_INNER); // 0→1
      // Noise perturbation for organic ragged spike edges
      const edgeNoise = simplex3(nx * 3.5 + 7, ny * 3.5 + 13, nz * 3.5) * 0.06;
      const voidHalfFrac = 0.28 + radFraction * 0.16 + edgeNoise; // 0.28→0.44 + noise
      const voidHalfAngle = spikePeriod * voidHalfFrac;

      const inVoid = withinPeriod < voidHalfAngle || withinPeriod > (spikePeriod - voidHalfAngle);
      if (inVoid) continue; // dark spike zone — no particles here

      // Bridge zone: very sparse (3% survival)
      if (Math.random() > 0.03) continue;

      const i = moatPlaced;
      moatPositions[i * 3]     = nx * r;
      moatPositions[i * 3 + 1] = ny * r;
      moatPositions[i * 3 + 2] = nz * r;

      // Dim deep-blue bridge particles (barely visible against the black background)
      moatColors[i * 3]     = colDeepBlue[0];
      moatColors[i * 3 + 1] = colDeepBlue[1];
      moatColors[i * 3 + 2] = colDeepBlue[2];
      moatAlphas[i] = 0.10 + Math.random() * 0.10;
      moatSizes[i]  = 0.8 + Math.random() * 0.8;

      moatPlaced++;
    }

    const moatGeo = new BufferGeometry();
    moatGeo.setAttribute("position", new BufferAttribute(moatPositions, 3));
    moatGeo.setAttribute("aColor",   new BufferAttribute(moatColors, 3));
    moatGeo.setAttribute("aAlpha",   new BufferAttribute(moatAlphas, 1));
    moatGeo.setAttribute("size",     new BufferAttribute(moatSizes, 1));

    const moatMat = new ShaderMaterial({
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

    sphereGroup.add(new Points(moatGeo, moatMat));

    // ── LAYER 3: Hot core ─────────────────────────────────────────────────────
    // Dense spherical volume: r = 0 to MOAT_INNER.
    // Colors: white-hot center → yellow → orange → deep red at edge.
    // Includes a thin "corona" fade at r=65–82 where orange sparks into dark.

    const corePositions = new Float32Array(CORE_COUNT * 3);
    const coreColors    = new Float32Array(CORE_COUNT * 3);
    const coreAlphas    = new Float32Array(CORE_COUNT);
    const coreSizes     = new Float32Array(CORE_COUNT);

    for (let i = 0; i < CORE_COUNT; i++) {
      // Bias toward center: pow(rand, 0.55) → more particles near r=0
      const r = MOAT_INNER * Math.pow(Math.random(), 0.55);
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      corePositions[i * 3]     = nx * r;
      corePositions[i * 3 + 1] = ny * r;
      corePositions[i * 3 + 2] = nz * r;

      // t=0 center, t=1 outer edge
      const t = r / MOAT_INNER;

      let col: [number, number, number];
      let alpha: number;
      let size: number;

      if (t < 0.12) {
        // Dead center: blinding white-yellow
        col   = lerpColor(colCoreWhite, colCoreYellow, t / 0.12);
        alpha = 0.95 + Math.random() * 0.05;
        size  = 4.5 + Math.random() * 2.5; // 4.5–7px
      } else if (t < 0.30) {
        // Inner hot zone: yellow → orange
        col   = lerpColor(colCoreYellow, colCoreOrange, (t - 0.12) / 0.18);
        alpha = 0.85 + Math.random() * 0.10;
        size  = 3.0 + Math.random() * 2.0; // 3–5px
      } else if (t < 0.58) {
        // Mid core: orange → red
        col   = lerpColor(colCoreOrange, colCoreRed, (t - 0.30) / 0.28);
        alpha = 0.70 + Math.random() * 0.15;
        size  = 2.0 + Math.random() * 1.5; // 2–3.5px
      } else if (t < 0.80) {
        // Outer core: red → dark red
        col   = lerpColor(colCoreRed, colCoreDarkRed, (t - 0.58) / 0.22);
        alpha = 0.50 + Math.random() * 0.20;
        size  = 1.4 + Math.random() * 1.0; // 1.4–2.4px
      } else {
        // Corona fringe: dark red fading to almost nothing
        col   = colCoreDarkRed;
        alpha = (1.0 - (t - 0.80) / 0.20) * 0.35 + Math.random() * 0.10;
        size  = 1.0 + Math.random() * 0.8;
      }

      coreColors[i * 3]     = col[0];
      coreColors[i * 3 + 1] = col[1];
      coreColors[i * 3 + 2] = col[2];
      coreAlphas[i] = alpha;
      coreSizes[i]  = size;
    }

    const coreGeo = new BufferGeometry();
    coreGeo.setAttribute("position", new BufferAttribute(corePositions, 3));
    coreGeo.setAttribute("aColor",   new BufferAttribute(coreColors, 3));
    coreGeo.setAttribute("aAlpha",   new BufferAttribute(coreAlphas, 1));
    coreGeo.setAttribute("size",     new BufferAttribute(coreSizes, 1));

    const coreMat = new ShaderMaterial({
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

    sphereGroup.add(new Points(coreGeo, coreMat));

    // ── LAYER 4: Core glow sprite ─────────────────────────────────────────────

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const ctx = glowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0.00, "rgba(255, 255, 255, 1.0)");  // blinding white core
    gradient.addColorStop(0.05, "rgba(255, 240, 120, 1.0)");  // hot yellow
    gradient.addColorStop(0.14, "rgba(255, 120, 10, 0.95)");  // deep orange
    gradient.addColorStop(0.28, "rgba(200, 20, 0, 0.80)");    // red
    gradient.addColorStop(0.45, "rgba(100, 0, 0, 0.45)");     // dark red
    gradient.addColorStop(0.65, "rgba(30, 0, 0, 0.15)");      // near black
    gradient.addColorStop(1.00, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const glowTexture = new CanvasTexture(glowCanvas);
    const glowMat = new SpriteMaterial({
      map: glowTexture,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const glowSprite = new Sprite(glowMat);
    glowSprite.scale.set(210, 210, 1);
    glowSprite.position.set(0, 0, 1);
    sphereGroup.add(glowSprite);

    // ── LAYER 5: Feeding stream ───────────────────────────────────────────────

    const streamPos    = new Float32Array(STREAM_COUNT * 3);
    const streamColors = new Float32Array(STREAM_COUNT * 3);
    const streamAlphas = new Float32Array(STREAM_COUNT);
    const streamSizes  = new Float32Array(STREAM_COUNT);

    const streamT      = new Float32Array(STREAM_COUNT);
    const streamAlive  = new Uint8Array(STREAM_COUNT);
    const streamOriginX = new Float32Array(STREAM_COUNT);
    const streamOriginY = new Float32Array(STREAM_COUNT);

    for (let i = 0; i < STREAM_COUNT; i++) {
      streamPos[i * 3] = -99999;
      streamPos[i * 3 + 1] = -99999;
      streamPos[i * 3 + 2] = 0;
      streamSizes[i] = 1.0;
    }

    const streamGeo = new BufferGeometry();
    streamGeo.setAttribute("position",     new BufferAttribute(streamPos, 3));
    streamGeo.setAttribute("aStreamColor", new BufferAttribute(streamColors, 3));
    streamGeo.setAttribute("aStreamAlpha", new BufferAttribute(streamAlphas, 1));
    streamGeo.setAttribute("size",         new BufferAttribute(streamSizes, 1));

    const streamMat = new ShaderMaterial({
      vertexShader: STREAM_VERT,
      fragmentShader: STREAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    scene.add(new Points(streamGeo, streamMat));

    const colCyan    = hexToRgb("#00ccff");
    const colAmber   = hexToRgb("#ffaa00");
    const colDeepRed = hexToRgb("#ff2800");

    // ── Dynamic state ─────────────────────────────────────────────────────────

    let feedActive        = false;
    let feedTargetWorldX  = 0;
    let feedTargetWorldY  = 0;
    let coreBrightness       = 1.0;
    let coreBrightnessTarget = 1.0;
    let globalAlpha       = 1.0;
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
    window.addEventListener("creature-stop-feeding",  onStopFeeding);
    window.addEventListener("creature-char-consumed", onCharConsumed);
    window.addEventListener("creature-dim",           handleDim);

    // ── Animation loop ────────────────────────────────────────────────────────

    let time = 0;

    function animate() {
      time += 0.016;

      // Slow breathing
      const breathe = Math.sin(time * 0.32) * 0.045 + 1.0;
      outerMat.uniforms.breathe.value = breathe;
      moatMat.uniforms.breathe.value  = breathe;
      coreMat.uniforms.breathe.value  = breathe;

      // Very slow rotation
      sphereGroup.rotation.y += 0.00015;

      // Core brightness (feeding response)
      const bLerp = coreBrightness < coreBrightnessTarget ? 0.05 : 0.015;
      coreBrightness += (coreBrightnessTarget - coreBrightness) * bLerp;
      coreMat.uniforms.uCoreBrightness.value = coreBrightness;
      outerMat.uniforms.uCoreBrightness.value = 1.0; // outer shell never brightens
      const spriteScale = 210 * (0.75 + 0.45 * coreBrightness);
      glowSprite.scale.set(spriteScale, spriteScale, 1);

      // Global dim (search overlay)
      const aLerp = globalAlphaTarget < globalAlpha ? 0.05 : 0.04;
      globalAlpha += (globalAlphaTarget - globalAlpha) * aLerp;
      outerMat.uniforms.uGlobalAlpha.value = globalAlpha;
      moatMat.uniforms.uGlobalAlpha.value  = globalAlpha;
      coreMat.uniforms.uGlobalAlpha.value  = globalAlpha;
      glowMat.opacity = globalAlpha;

      // Stream particle system (feeding animation)
      if (feedActive) {
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

      const posArr   = streamGeo.getAttribute("position").array as Float32Array;
      const colArr   = streamGeo.getAttribute("aStreamColor").array as Float32Array;
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

        posArr[i * 3]     = streamOriginX[i] * (1 - t) + Math.sin(t * Math.PI + i * 0.3) * 30;
        posArr[i * 3 + 1] = streamOriginY[i] * (1 - t);
        posArr[i * 3 + 2] = 0;

        let col: [number, number, number];
        if (t < 0.3)      col = lerpColor(colCyan, colAmber, t / 0.3);
        else if (t < 0.7) col = lerpColor(colAmber, colDeepRed, (t - 0.3) / 0.4);
        else              col = colDeepRed;

        colArr[i * 3]     = col[0];
        colArr[i * 3 + 1] = col[1];
        colArr[i * 3 + 2] = col[2];

        const fadeIn  = Math.min(1, t / 0.1);
        const fadeOut = Math.max(0, 1 - Math.max(0, (t - 0.8) / 0.2));
        alphaArr[i] = 0.6 * fadeIn * fadeOut;
      }

      (streamGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (streamGeo.getAttribute("aStreamColor") as BufferAttribute).needsUpdate = true;
      (streamGeo.getAttribute("aStreamAlpha") as BufferAttribute).needsUpdate = true;

      composer.render();
      animFrameRef.current = window.requestAnimationFrame(animate);
    }

    animFrameRef.current = window.requestAnimationFrame(animate);

    // ── Resize ────────────────────────────────────────────────────────────────

    function onResize() {
      width  = window.innerWidth;
      height = window.innerHeight;
      aspect = width / height;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      camera.left   = -visibleHalfH * aspect;
      camera.right  =  visibleHalfH * aspect;
      camera.top    =  visibleHalfH;
      camera.bottom = -visibleHalfH;
      camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", onResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize",                   onResize);
      window.removeEventListener("creature-start-feeding",   onStartFeeding);
      window.removeEventListener("creature-stop-feeding",    onStopFeeding);
      window.removeEventListener("creature-char-consumed",   onCharConsumed);
      window.removeEventListener("creature-dim",             handleDim);
      outerGeo.dispose();    outerMat.dispose();
      moatGeo.dispose();     moatMat.dispose();
      coreGeo.dispose();     coreMat.dispose();
      streamGeo.dispose();   streamMat.dispose();
      glowTexture.dispose(); glowMat.dispose();
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
