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

// ── Helpers ───────────────────────────────────────────────────────────────────

function gauss(sigma: number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ORGAN_COUNT = 5;
const PARTICLES_PER_ORGAN = 800;
const STREAM_COUNT = 5;
const PARTICLES_PER_STREAM = 60;
const PSEUDOPOD_COUNT = 1800;
const FEED_PARTICLE_MAX = 1000;

// Phase 1 duration in animation frames (≈1200ms at 60fps)
const PSEUDOPOD_FRAMES = 72;

// Viewport-relative offsets from screen center [vw_fraction, vh_fraction]
const VP_OFFSETS: [number, number][] = [
  [-0.28, +0.22], // 0 — top left
  [+0.31, +0.18], // 1 — top right
  [-0.35, -0.20], // 2 — bottom left
  [+0.25, -0.28], // 3 — bottom right
  [+0.04, -0.05], // 4 — near center (THE CORE)
];

const STREAM_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 0],
];

// [coreRGB, edgeRGB]
const ORGAN_COLORS: [[number, number, number], [number, number, number]][] = [
  [[0, 1, 0.82], [1, 1, 1]],
  [[0, 1, 0.82], [0.541, 0.706, 0.973]],
  [[0, 1, 0.667], [1, 1, 1]],
  [[0, 1, 0.82], [0.667, 1, 0.933]],
  [[1, 0.227, 0.102], [1, 0.549, 0.412]], // THE CORE
];

const ORGAN_BASE_SPEEDS = [
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  0.3 + Math.random() * 0.5,
  1.4, // THE CORE — always faster
];

// ── Shaders ───────────────────────────────────────────────────────────────────

// Organ / pseudopod / feed-particle: per-particle size + color
const ORGAN_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (150.0 / -mvPosition.z);
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
    gl_FragColor = vec4(vColor, alpha * 0.35);
  }
`;

// Core organ: same vertex, fragment adds brightness uniform
const CORE_FRAG = /* glsl */ `
  uniform float brightness;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = 1.0 - (d * 2.0);
    alpha = pow(alpha, 1.4);
    gl_FragColor = vec4(vColor * brightness, alpha * 0.35);
  }
`;

// Pseudopod: same vertex, fragment has alpha uniform for 70% opacity
const PSEUDOPOD_FRAG = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = 1.0 - (d * 2.0);
    alpha = pow(alpha, 1.4);
    gl_FragColor = vec4(vColor, alpha * uAlpha);
  }
`;

// Streams: size attribute only, always white
const STREAM_VERT = /* glsl */ `
  attribute float size;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (150.0 / -mvPosition.z);
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

// ── Internal state types ──────────────────────────────────────────────────────

interface FeedParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  targetR: number;
  targetG: number;
  targetB: number;
  life: number;
  maxLife: number;
  organ: number;
}

interface FeedState {
  organ: number;
  targetX: number;
  targetY: number;
  frame: number;
  phase: 1 | 2 | 3;
  pseudopodGeo: BufferGeometry;
  pseudopodMat: ShaderMaterial;
  pseudopodPoints: Points;
  growFrame: number;
  coreResonanceFrame: number;
}

// State exposed to useImperativeHandle callbacks
interface ThreeState {
  organCenters: [number, number][];
  scene: Scene;
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

  // Cross-boundary state (read by useImperativeHandle, written by useEffect)
  const threeRef = useRef<ThreeState | null>(null);
  const feedRef = useRef<FeedState | null>(null);
  const feedParticlesRef = useRef<FeedParticle[]>([]);
  const seekRef = useRef({ active: false, endRequested: false });

  useImperativeHandle(ref, () => ({
    triggerFeed(x, y, noteData) {
      const three = threeRef.current;
      if (!three) return;

      // Clear any previous feed
      if (feedRef.current) {
        const prev = feedRef.current;
        three.scene.remove(prev.pseudopodPoints);
        prev.pseudopodGeo.dispose();
        prev.pseudopodMat.dispose();
        feedRef.current = null;
      }
      feedParticlesRef.current = [];

      // Find nearest organ to target world position (screen coords = world coords)
      let nearestOrgan = 0;
      let minDist = Infinity;
      for (let o = 0; o < ORGAN_COUNT; o++) {
        const [ox, oy] = three.organCenters[o];
        const d = (ox - x) ** 2 + (oy - y) ** 2;
        if (d < minDist) {
          minDist = d;
          nearestOrgan = o;
        }
      }

      // Pseudopod geometry
      const positions = new Float32Array(PSEUDOPOD_COUNT * 3);
      const colors = new Float32Array(PSEUDOPOD_COUNT * 3);
      const sizes = new Float32Array(PSEUDOPOD_COUNT).fill(1.4);

      // Color = mix(organCoreColor, white, 0.3)
      const [cr, cg, cb] = ORGAN_COLORS[nearestOrgan][0];
      const pr = cr + (1 - cr) * 0.3;
      const pg = cg + (1 - cg) * 0.3;
      const pb = cb + (1 - cb) * 0.3;
      for (let i = 0; i < PSEUDOPOD_COUNT; i++) {
        colors[i * 3] = pr;
        colors[i * 3 + 1] = pg;
        colors[i * 3 + 2] = pb;
      }

      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));
      geo.setAttribute("color", new BufferAttribute(colors, 3));
      geo.setAttribute("size", new BufferAttribute(sizes, 1));

      const mat = new ShaderMaterial({
        vertexShader: ORGAN_VERT,
        fragmentShader: PSEUDOPOD_FRAG,
        uniforms: { uAlpha: { value: 0.7 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      const points = new Points(geo, mat);
      three.scene.add(points);

      feedRef.current = {
        organ: nearestOrgan,
        targetX: x,
        targetY: y,
        frame: 0,
        phase: 1,
        pseudopodGeo: geo,
        pseudopodMat: mat,
        pseudopodPoints: points,
        growFrame: 0,
        coreResonanceFrame: 0,
      };

      void noteData; // wordCount / tags available if needed later
    },

    triggerSeek(_query) {
      seekRef.current.active = true;
      seekRef.current.endRequested = false;
    },

    setDimmed(dimmed) {
      if (!dimmed && seekRef.current.active) {
        seekRef.current.active = false;
        seekRef.current.endRequested = true;
      }
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
    renderer.setClearColor(0x000000, 0); // alpha 0 = transparent, CSS black shows through

    const scene = new Scene();

    // Camera: world origin at top-left, y increases downward (screen convention)
    const camera = new OrthographicCamera(0, width, 0, height, -1000, 1000);
    camera.position.z = 1;

    function computeCenter(o: number): [number, number] {
      const [vx, vy] = VP_OFFSETS[o];
      return [
        width / 2 + vx * width,
        height / 2 - vy * height, // +vh = up = smaller world-y
      ];
    }

    const organCenters: [number, number][] = Array.from(
      { length: ORGAN_COUNT },
      (_, o) => computeCenter(o)
    );

    // Expose to triggerFeed
    threeRef.current = { organCenters, scene };

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
      const sigmaX = 35 + Math.random() * 10;
      const sigmaY = 28 + Math.random() * 10;
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
        positions[i * 3] = cx + ox;
        positions[i * 3 + 1] = cy + oy;

        const life = Math.min(
          1.0,
          Math.sqrt((ox / sigmaX) ** 2 + (oy / sigmaY) ** 2)
        );
        colors[i * 3] = coreColor[0] + (edgeColor[0] - coreColor[0]) * life;
        colors[i * 3 + 1] =
          coreColor[1] + (edgeColor[1] - coreColor[1]) * life;
        colors[i * 3 + 2] =
          coreColor[2] + (edgeColor[2] - coreColor[2]) * life;
        sizes[i] = 0.6 + Math.random() * 0.4;
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
      const sizes = new Float32Array(PARTICLES_PER_STREAM).fill(0.7);

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

    function updateStreams(time: number, speedMul: number) {
      for (let s = 0; s < STREAM_COUNT; s++) {
        const [aIdx, bIdx] = STREAM_PAIRS[s];
        const [ax, ay] = organCenters[aIdx];
        const [bx, by] = organCenters[bIdx];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / len;
        const perpY = dx / len;

        const posAttr = streamGeos[s].getAttribute(
          "position"
        ) as BufferAttribute;
        const arr = posAttr.array as Float32Array;

        for (let i = 0; i < PARTICLES_PER_STREAM; i++) {
          const phase = i / PARTICLES_PER_STREAM;
          const t = ((phase + time * 0.004 * speedMul) % 1 + 1) % 1;
          const perpOffset =
            Math.sin(t * Math.PI * 3) * 18 * Math.sin(t * Math.PI);
          arr[i * 3] = ax + dx * t + perpX * perpOffset;
          arr[i * 3 + 1] = ay + dy * t + perpY * perpOffset;
          arr[i * 3 + 2] = 0;
        }
        posAttr.needsUpdate = true;
      }
    }

    updateStreams(0, 1);

    // ── Feed particle mesh (pre-allocated) ────────────────────────────────────

    const feedPosArr = new Float32Array(FEED_PARTICLE_MAX * 3);
    const feedColArr = new Float32Array(FEED_PARTICLE_MAX * 3);
    const feedSzArr = new Float32Array(FEED_PARTICLE_MAX).fill(1.5);

    const feedGeo = new BufferGeometry();
    feedGeo.setAttribute("position", new BufferAttribute(feedPosArr, 3));
    feedGeo.setAttribute("color", new BufferAttribute(feedColArr, 3));
    feedGeo.setAttribute("size", new BufferAttribute(feedSzArr, 1));
    feedGeo.setDrawRange(0, 0);

    const feedMat = new ShaderMaterial({
      vertexShader: ORGAN_VERT,
      fragmentShader: ORGAN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    scene.add(new Points(feedGeo, feedMat));

    // ── Per-organ mutable state ───────────────────────────────────────────────

    // Size multipliers — modified by feeding (Phase 3) and seeking
    const organSizeMul = new Float32Array(ORGAN_COUNT).fill(1.0);

    // Seek animation state (mutable locals, driven by seekRef flags)
    let seekSpeedMul = 1.0; // organ pulse speed multiplier
    let seekStreamMul = 1.0; // stream flow speed multiplier
    let coreBrightExtra = 0.0; // extra brightness added to core oscillation
    let postSeekFrame = 0;
    let postSeekActive = false;

    // ── Event: char consumed ──────────────────────────────────────────────────

    function onCharConsumed(e: Event) {
      const feed = feedRef.current;
      if (!feed) return;

      const { x: sx, y: sy } = (e as CustomEvent<{ x: number; y: number }>)
        .detail;

      // Screen coords = world coords for this orthographic camera
      const wx = sx;
      const wy = sy;

      const [ox, oy] = organCenters[feed.organ];
      const ddx = ox - wx;
      const ddy = oy - wy;
      const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;

      const [targetR, targetG, targetB] = ORGAN_COLORS[feed.organ][0];
      const count = 6 + Math.floor(Math.random() * 5); // 6–10

      for (let i = 0; i < count; i++) {
        const speed = 1.5 + Math.random() * 2;
        const spread = (Math.random() - 0.5) * 30; // ±15 units perpendicular
        // Perpendicular to organ direction for spread
        const perpX = -ddy / dlen;
        const perpY = ddx / dlen;

        if (feedParticlesRef.current.length < FEED_PARTICLE_MAX) {
          feedParticlesRef.current.push({
            x: wx + perpX * spread * 0.3,
            y: wy + perpY * spread * 0.3,
            vx: (ddx / dlen) * speed + (Math.random() - 0.5) * 4,
            vy: (ddy / dlen) * speed + (Math.random() - 0.5) * 4,
            r: 1.0,
            g: 0.227,
            b: 0.102, // start #FF3A1A
            targetR,
            targetG,
            targetB,
            life: 0,
            maxLife: 60 + Math.floor(Math.random() * 31), // 60–90 frames
            organ: feed.organ,
          });
        }
      }
    }

    // ── Event: consumption finished ───────────────────────────────────────────

    function onStopFeeding() {
      const feed = feedRef.current;
      if (!feed || feed.phase !== 2) return;

      // Remove pseudopod — creature has finished reaching
      scene.remove(feed.pseudopodPoints);
      feed.pseudopodGeo.dispose();
      feed.pseudopodMat.dispose();

      feed.phase = 3;
      feed.growFrame = 0;
      feed.coreResonanceFrame = 0;
    }

    window.addEventListener("creature-char-consumed", onCharConsumed);
    window.addEventListener("creature-stop-feeding", onStopFeeding);

    // ── Animation loop ─────────────────────────────────────────────────────────

    let time = 0;

    function animate() {
      time += 0.016;

      // ── Seek state ──────────────────────────────────────────────────────────
      if (seekRef.current.active) {
        // Lerp toward contracted / stilled / brightened seek state
        seekSpeedMul = lerp(seekSpeedMul, 0.1, 0.1);
        seekStreamMul = lerp(seekStreamMul, 0.2, 0.1);
        coreBrightExtra = lerp(coreBrightExtra, 1.2, 0.1); // → 2.2 total
        for (let o = 0; o < ORGAN_COUNT; o++) {
          organSizeMul[o] = lerp(organSizeMul[o], 0.88, 1 / 30);
        }
        postSeekActive = false;
        postSeekFrame = 0;
      } else if (seekRef.current.endRequested) {
        seekRef.current.endRequested = false;
        postSeekActive = true;
        postSeekFrame = 0;
      }

      if (postSeekActive) {
        postSeekFrame++;
        seekSpeedMul = lerp(seekSpeedMul, 1.0, 1 / 60);
        seekStreamMul = lerp(seekStreamMul, 1.0, 1 / 60);
        coreBrightExtra = lerp(coreBrightExtra, 0.0, 1 / 60);

        // Staggered ripple: each organ pulses outward once
        for (let o = 0; o < ORGAN_COUNT; o++) {
          const rf = postSeekFrame - o * 8; // 8-frame stagger
          if (rf >= 0 && rf <= 40) {
            organSizeMul[o] = 1.0 + Math.sin((rf / 40) * Math.PI) * 0.15;
          } else if (rf > 40) {
            organSizeMul[o] = lerp(organSizeMul[o], 1.0, 1 / 30);
          }
        }

        if (postSeekFrame > 40 + 8 * (ORGAN_COUNT - 1) + 30) {
          postSeekActive = false;
        }
      }

      // ── Feed state ──────────────────────────────────────────────────────────
      const feed = feedRef.current;
      if (feed) {
        feed.frame++;

        if (feed.phase === 1) {
          // Phase 1: pseudopod extends from organ toward target over 72 frames
          const progress = Math.min(1, feed.frame / PSEUDOPOD_FRAMES);
          const ext = easeOutCubic(progress); // 0→1 with deceleration

          const [ox, oy] = organCenters[feed.organ];
          const ddx = feed.targetX - ox;
          const ddy = feed.targetY - oy;
          const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const perpX = -ddy / dlen;
          const perpY = ddx / dlen;

          const posAttr = feed.pseudopodGeo.getAttribute(
            "position"
          ) as BufferAttribute;
          const arr = posAttr.array as Float32Array;

          for (let i = 0; i < PSEUDOPOD_COUNT; i++) {
            const phase = i / PSEUDOPOD_COUNT; // 0=base, 1=tip
            // Particles flow within the extended portion
            const flowPhase =
              ((phase + feed.frame * 0.008) % 1 + 1) % 1;
            const t = flowPhase * ext; // actual position along line
            // Taper waviness to 0 near the tip
            const tipTaper = 1 - flowPhase;
            const perpOffset =
              Math.sin(flowPhase * 4 * Math.PI * 2) * 12 * tipTaper;
            arr[i * 3] = ox + ddx * t + perpX * perpOffset;
            arr[i * 3 + 1] = oy + ddy * t + perpY * perpOffset;
            arr[i * 3 + 2] = 0;
          }
          posAttr.needsUpdate = true;

          if (progress >= 1) {
            feed.phase = 2;
          }
        } else if (feed.phase === 2) {
          // Phase 2: pseudopod fully extended, held in place while chars consumed
          const [ox, oy] = organCenters[feed.organ];
          const ddx = feed.targetX - ox;
          const ddy = feed.targetY - oy;
          const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const perpX = -ddy / dlen;
          const perpY = ddx / dlen;

          const posAttr = feed.pseudopodGeo.getAttribute(
            "position"
          ) as BufferAttribute;
          const arr = posAttr.array as Float32Array;

          for (let i = 0; i < PSEUDOPOD_COUNT; i++) {
            const phase = i / PSEUDOPOD_COUNT;
            const flowPhase =
              ((phase + feed.frame * 0.008) % 1 + 1) % 1;
            const tipTaper = 1 - flowPhase;
            const perpOffset =
              Math.sin(flowPhase * 4 * Math.PI * 2) * 12 * tipTaper;
            arr[i * 3] = ox + ddx * flowPhase + perpX * perpOffset;
            arr[i * 3 + 1] = oy + ddy * flowPhase + perpY * perpOffset;
            arr[i * 3 + 2] = 0;
          }
          posAttr.needsUpdate = true;
        } else if (feed.phase === 3) {
          // Phase 3: organ growth + core resonance pulse
          feed.growFrame++;

          const go = feed.organ;
          if (feed.growFrame <= 80) {
            // Grow to 1.18
            organSizeMul[go] = 1.0 + 0.18 * (feed.growFrame / 80);
          } else if (feed.growFrame <= 480) {
            // Lerp back to 1.0 over 400 frames
            const t = (feed.growFrame - 80) / 400;
            organSizeMul[go] = 1.18 - 0.18 * t;
          } else {
            organSizeMul[go] = 1.0;
          }

          // Sympathetic resonance: core (organ 4) pulses regardless of which organ fed
          if (go !== 4) {
            feed.coreResonanceFrame++;
            if (feed.coreResonanceFrame <= 120) {
              const t = feed.coreResonanceFrame / 120;
              organSizeMul[4] = 1.0 + Math.sin(t * Math.PI) * 0.12;
            } else {
              organSizeMul[4] = lerp(organSizeMul[4], 1.0, 0.05);
            }
          }

          // Also brighten core during growth (+0.4 extra), then return
          const growT = Math.min(1, feed.growFrame / 480);
          const brightPeak =
            growT < 0.5 ? growT * 2 * 0.4 : (1 - growT) * 2 * 0.4;
          coreBrightExtra = Math.max(coreBrightExtra, brightPeak);

          if (feed.growFrame > 480 && feed.coreResonanceFrame >= 120) {
            feedRef.current = null;
          }
        }
      }

      // ── Organ pulse ──────────────────────────────────────────────────────────
      for (let o = 0; o < ORGAN_COUNT; o++) {
        const [cx, cy] = organCenters[o];
        const speed = ORGAN_BASE_SPEEDS[o] * seekSpeedMul;
        const pulse =
          Math.sin(time * speed + organPulsePhase[o]) * 0.055 + 1.0;
        const scale = pulse * organSizeMul[o];
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

      // Core brightness: base oscillation + seek/feed extra
      const coreMat = organMats[4];
      coreMat.uniforms.brightness.value =
        Math.sin(time * 1.4) * 0.3 + 1.0 + coreBrightExtra;

      // ── Streams ──────────────────────────────────────────────────────────────
      updateStreams(time, seekStreamMul);

      // ── Feed particles ────────────────────────────────────────────────────────
      const particles = feedParticlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        // Lerp color from #FF3A1A toward organ core color
        const ct = p.life / p.maxLife;
        p.r = lerp(1.0, p.targetR, ct);
        p.g = lerp(0.227, p.targetG, ct);
        p.b = lerp(0.102, p.targetB, ct);

        // Home toward organ center
        const [ox, oy] = organCenters[p.organ];
        const ddx = ox - p.x;
        const ddy = oy - p.y;
        const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        p.vx += (ddx / dlen) * 1.5;
        p.vy += (ddy / dlen) * 1.5;
        p.vx *= 0.9; // dampen
        p.vy *= 0.9;
        p.x += p.vx;
        p.y += p.vy;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
        }
      }

      // Write feed particles to pre-allocated geometry
      const pCount = Math.min(particles.length, FEED_PARTICLE_MAX);
      feedGeo.setDrawRange(0, pCount);
      if (pCount > 0) {
        for (let i = 0; i < pCount; i++) {
          const p = particles[i];
          const fadeAlpha = 1 - p.life / p.maxLife;
          feedPosArr[i * 3] = p.x;
          feedPosArr[i * 3 + 1] = p.y;
          feedPosArr[i * 3 + 2] = 0;
          // Bake fade into color (additive blending: darker = more transparent)
          feedColArr[i * 3] = p.r * fadeAlpha;
          feedColArr[i * 3 + 1] = p.g * fadeAlpha;
          feedColArr[i * 3 + 2] = p.b * fadeAlpha;
        }
        (feedGeo.getAttribute("position") as BufferAttribute).needsUpdate =
          true;
        (feedGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
      }

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
      window.removeEventListener("creature-char-consumed", onCharConsumed);
      window.removeEventListener("creature-stop-feeding", onStopFeeding);

      // Dispose pseudopod if still alive
      const feed = feedRef.current;
      if (feed) {
        scene.remove(feed.pseudopodPoints);
        feed.pseudopodGeo.dispose();
        feed.pseudopodMat.dispose();
        feedRef.current = null;
      }

      for (let o = 0; o < ORGAN_COUNT; o++) {
        organGeos[o].dispose();
        organMats[o].dispose();
      }
      for (let s = 0; s < STREAM_COUNT; s++) {
        streamGeos[s].dispose();
        streamMats[s].dispose();
      }
      feedGeo.dispose();
      feedMat.dispose();
      renderer.dispose();
      threeRef.current = null;
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
