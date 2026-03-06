"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";

// Box-Muller gaussian random
function gauss(sigma: number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const ORGAN_COUNT = 5;
const PARTICLES_PER_ORGAN = 2500;
const STREAM_COUNT = 5;
const PARTICLES_PER_STREAM = 150;

// Viewport-relative offsets from screen center [vw_fraction, vh_fraction]
// +vw = right, +vh = up (world y is screen-down so we invert vh)
const VP_OFFSETS: [number, number][] = [
  [-0.28, +0.22], // Organ 0 — top left cluster
  [+0.31, +0.18], // Organ 1 — top right
  [-0.35, -0.20], // Organ 2 — bottom left
  [+0.25, -0.28], // Organ 3 — bottom right
  [+0.04, -0.05], // Organ 4 — near center (THE CORE)
];

// Adjacent pairs for connecting streams
const STREAM_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 0],
];

// Per-organ [coreRGB, edgeRGB]
const ORGAN_COLORS: [[number, number, number], [number, number, number]][] = [
  [
    [0, 1, 0.82],
    [1, 1, 1],
  ], // 0: #00FFD1 → #FFFFFF
  [
    [0, 1, 0.82],
    [0.541, 0.706, 0.973],
  ], // 1: #00FFD1 → #8ab4f8
  [
    [0, 1, 0.667],
    [1, 1, 1],
  ], // 2: #00FFAA → #FFFFFF
  [
    [0, 1, 0.82],
    [0.667, 1, 0.933],
  ], // 3: #00FFD1 → #aaffee
  [
    [1, 0.227, 0.102],
    [1, 0.549, 0.412],
  ], // 4: #FF3A1A → #FF8C69 (THE CORE)
];

// Organ pulse speeds — organ 4 (the core) is always faster
const ORGAN_BASE_SPEEDS = [
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  1.4, // THE CORE
];

// ── Shaders ──────────────────────────────────────────────────────────────────

// Organs: per-particle size + color attributes
const ORGAN_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ORGAN_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = 1.0 - (d * 2.0);
    alpha = pow(alpha, 1.4);
    gl_FragColor = vec4(vColor, alpha * 0.88);
  }
`;

// Core organ gets a brightness uniform that oscillates
const CORE_FRAG = /* glsl */ `
  uniform float brightness;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = 1.0 - (d * 2.0);
    alpha = pow(alpha, 1.4);
    gl_FragColor = vec4(vColor * brightness, alpha * 0.88);
  }
`;

// Streams: only size attribute, always white
const STREAM_VERT = /* glsl */ `
  attribute float size;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STREAM_FRAG = /* glsl */ `
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = 1.0 - (d * 2.0);
    alpha = pow(alpha, 1.4);
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.22);
  }
`;

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
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);

  useImperativeHandle(ref, () => ({
    triggerFeed: (
      _x: number,
      _y: number,
      _noteData: { wordCount: number; tags: string[] }
    ) => {
      // no-op — will implement in PART B
    },
    triggerSeek: (_query: string) => {
      // no-op — will implement in PART C
    },
    setDimmed: (_dimmed: boolean) => {
      // no-op — will implement in PART C
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    // ── Three.js core ─────────────────────────────────────────────────────────

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    const scene = new Scene();
    sceneRef.current = scene;

    // OrthographicCamera: left=0, right=width, top=0, bottom=height
    // → world origin at top-left, y increases downward (screen convention)
    const camera = new OrthographicCamera(0, width, 0, height, -1000, 1000);
    camera.position.z = 1;
    cameraRef.current = camera;

    // Convert VP_OFFSET to world [x, y]
    function computeCenter(o: number): [number, number] {
      const [vx, vy] = VP_OFFSETS[o];
      return [
        width / 2 + vx * width,
        height / 2 - vy * height, // invert: +vh = up = smaller world-y
      ];
    }

    const organCenters: [number, number][] = Array.from(
      { length: ORGAN_COUNT },
      (_, o) => computeCenter(o)
    );

    // ── Organs ────────────────────────────────────────────────────────────────

    const organGeos: BufferGeometry[] = [];
    const organMats: ShaderMaterial[] = [];
    const organBaseOffsets: Float32Array[] = [];

    const organPulsePhase = Array.from(
      { length: ORGAN_COUNT },
      () => Math.random() * Math.PI * 2
    );

    for (let o = 0; o < ORGAN_COUNT; o++) {
      const [cx, cy] = organCenters[o];
      const sigmaX = 55 + Math.random() * 20;
      const sigmaY = 45 + Math.random() * 20;
      const [coreColor, edgeColor] = ORGAN_COLORS[o];

      const positions = new Float32Array(PARTICLES_PER_ORGAN * 3);
      const colors = new Float32Array(PARTICLES_PER_ORGAN * 3);
      const sizes = new Float32Array(PARTICLES_PER_ORGAN);
      const offsets = new Float32Array(PARTICLES_PER_ORGAN * 3);

      for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
        const ox = gauss(sigmaX);
        const oy = gauss(sigmaY);

        offsets[i * 3] = ox;
        offsets[i * 3 + 1] = oy;
        offsets[i * 3 + 2] = 0;

        positions[i * 3] = cx + ox;
        positions[i * 3 + 1] = cy + oy;
        positions[i * 3 + 2] = 0;

        // life: 0 at core, 1 at edge, clamped
        const life = Math.min(
          1.0,
          Math.sqrt((ox / sigmaX) ** 2 + (oy / sigmaY) ** 2)
        );
        colors[i * 3] = coreColor[0] + (edgeColor[0] - coreColor[0]) * life;
        colors[i * 3 + 1] =
          coreColor[1] + (edgeColor[1] - coreColor[1]) * life;
        colors[i * 3 + 2] =
          coreColor[2] + (edgeColor[2] - coreColor[2]) * life;

        sizes[i] = 1.2 + Math.random() * 0.6;
      }

      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));
      geo.setAttribute("color", new BufferAttribute(colors, 3));
      geo.setAttribute("size", new BufferAttribute(sizes, 1));

      const isCore = o === 4;
      const mat = new ShaderMaterial({
        vertexShader: ORGAN_VERT,
        fragmentShader: isCore ? CORE_FRAG : ORGAN_FRAG,
        uniforms: isCore ? { brightness: { value: 1.0 } } : {},
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      scene.add(new Points(geo, mat));
      organGeos.push(geo);
      organMats.push(mat);
      organBaseOffsets.push(offsets);
    }

    // ── Streams ───────────────────────────────────────────────────────────────

    const streamGeos: BufferGeometry[] = [];
    const streamMats: ShaderMaterial[] = [];

    for (let s = 0; s < STREAM_COUNT; s++) {
      const positions = new Float32Array(PARTICLES_PER_STREAM * 3);
      // All stream particles the same size (0.9) per spec
      const sizes = new Float32Array(PARTICLES_PER_STREAM).fill(0.9);

      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));
      geo.setAttribute("size", new BufferAttribute(sizes, 1));

      const mat = new ShaderMaterial({
        vertexShader: STREAM_VERT,
        fragmentShader: STREAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      scene.add(new Points(geo, mat));
      streamGeos.push(geo);
      streamMats.push(mat);
    }

    function updateStreams(time: number) {
      for (let s = 0; s < STREAM_COUNT; s++) {
        const [aIdx, bIdx] = STREAM_PAIRS[s];
        const [ax, ay] = organCenters[aIdx];
        const [bx, by] = organCenters[bIdx];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Perpendicular direction
        const px = -dy / len;
        const py = dx / len;

        const posAttr = streamGeos[s].getAttribute(
          "position"
        ) as BufferAttribute;
        const arr = posAttr.array as Float32Array;

        for (let i = 0; i < PARTICLES_PER_STREAM; i++) {
          const phase = i / PARTICLES_PER_STREAM;
          const t = ((phase + time * 0.004) % 1 + 1) % 1;
          // Organic waviness tapered at ends: sin(t*PI) envelope
          const perpOffset =
            Math.sin(t * Math.PI * 3) * 18 * Math.sin(t * Math.PI);
          arr[i * 3] = ax + dx * t + px * perpOffset;
          arr[i * 3 + 1] = ay + dy * t + py * perpOffset;
          arr[i * 3 + 2] = 0;
        }
        posAttr.needsUpdate = true;
      }
    }

    updateStreams(0);

    // ── Animation loop ─────────────────────────────────────────────────────────

    let time = 0;

    function animate() {
      time += 0.016;

      // Organ pulse: scale offsets around each organ center
      for (let o = 0; o < ORGAN_COUNT; o++) {
        const [cx, cy] = organCenters[o];
        const scale =
          Math.sin(time * ORGAN_BASE_SPEEDS[o] + organPulsePhase[o]) * 0.055 +
          1.0;
        const offsets = organBaseOffsets[o];
        const posAttr = organGeos[o].getAttribute(
          "position"
        ) as BufferAttribute;
        const arr = posAttr.array as Float32Array;

        for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
          arr[i * 3] = cx + offsets[i * 3] * scale;
          arr[i * 3 + 1] = cy + offsets[i * 3 + 1] * scale;
          arr[i * 3 + 2] = 0;
        }
        posAttr.needsUpdate = true;
      }

      // Core brightness oscillation
      const coreMat = organMats[4];
      coreMat.uniforms.brightness.value = Math.sin(time * 1.4) * 0.3 + 1.0;

      updateStreams(time);

      renderer.render(scene, camera);
      animFrameRef.current = window.requestAnimationFrame(animate);
    }

    animFrameRef.current = window.requestAnimationFrame(animate);

    // ── Resize ────────────────────────────────────────────────────────────────

    function onResize() {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.right = width;
      camera.bottom = height;
      camera.updateProjectionMatrix();
      for (let o = 0; o < ORGAN_COUNT; o++) {
        const [cx, cy] = computeCenter(o);
        organCenters[o][0] = cx;
        organCenters[o][1] = cy;
      }
    }

    window.addEventListener("resize", onResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", onResize);
      for (let o = 0; o < ORGAN_COUNT; o++) {
        organGeos[o].dispose();
        organMats[o].dispose();
      }
      for (let s = 0; s < STREAM_COUNT; s++) {
        streamGeos[s].dispose();
        streamMats[s].dispose();
      }
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
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
