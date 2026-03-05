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
const PARTICLES_PER_ORGAN = 3000;
const STREAM_COUNT = 5;
const PARTICLES_PER_STREAM = 150;
const SIGMA = 60;

// Normalized screen positions [x, y] — 0=left/top, 1=right/bottom
const ORGAN_NORM: [number, number][] = [
  [0.25, 0.3],
  [0.7, 0.25],
  [0.15, 0.7],
  [0.75, 0.65],
  [0.5, 0.45],
];

// Adjacent pairs
const STREAM_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 0],
];

const ORGAN_VERT = /* glsl */ `
  attribute float life;
  varying float vLife;
  void main() {
    vLife = life;
    gl_PointSize = 1.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ORGAN_FRAG = /* glsl */ `
  varying float vLife;
  void main() {
    vec3 color = mix(vec3(0.0, 1.0, 0.82), vec3(1.0), vLife);
    gl_FragColor = vec4(color, 0.85);
  }
`;

const STREAM_VERT = /* glsl */ `
  void main() {
    gl_PointSize = 1.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STREAM_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 0.25);
  }
`;

export interface CreatureCanvasHandle {
  triggerFeed: (x: number, y: number) => void;
}

const CreatureCanvas = forwardRef<CreatureCanvasHandle>(
  function CreatureCanvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useImperativeHandle(ref, () => ({
      triggerFeed: (_x: number, _y: number) => {
        // no-op — will implement later
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let width = window.innerWidth;
      let height = window.innerHeight;

      const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(width, height);

      const scene = new Scene();

      // OrthographicCamera: top=0, bottom=height so pixel y matches screen y
      const camera = new OrthographicCamera(0, width, 0, height, -1000, 1000);
      camera.position.z = 1;

      // Organ centers in world/pixel space — recomputed on resize
      const organCenters: [number, number][] = ORGAN_NORM.map(([nx, ny]) => [
        nx * width,
        ny * height,
      ]);

      // ── Organs ──────────────────────────────────────────────────────────────

      const organGeos: BufferGeometry[] = [];
      const organMats: ShaderMaterial[] = [];
      // baseOffsets[o] = [ox0, oy0, 0, ox1, oy1, 0, ...] relative to center
      const organBaseOffsets: Float32Array[] = [];

      const organPulseSpeed = Array.from(
        { length: ORGAN_COUNT },
        () => 0.3 + Math.random() * 0.5
      );
      const organPulsePhase = Array.from(
        { length: ORGAN_COUNT },
        () => Math.random() * Math.PI * 2
      );

      for (let o = 0; o < ORGAN_COUNT; o++) {
        const [cx, cy] = organCenters[o];
        const positions = new Float32Array(PARTICLES_PER_ORGAN * 3);
        const lifeArr = new Float32Array(PARTICLES_PER_ORGAN);
        const offsets = new Float32Array(PARTICLES_PER_ORGAN * 3);

        for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
          const ox = gauss(SIGMA);
          const oy = gauss(SIGMA * 0.75); // slight vertical squash
          offsets[i * 3] = ox;
          offsets[i * 3 + 1] = oy;
          offsets[i * 3 + 2] = 0;

          positions[i * 3] = cx + ox;
          positions[i * 3 + 1] = cy + oy;
          positions[i * 3 + 2] = 0;

          lifeArr[i] = Math.min(1.0, Math.sqrt(ox * ox + oy * oy) / (3 * SIGMA));
        }

        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(positions, 3));
        geo.setAttribute("life", new BufferAttribute(lifeArr, 1));

        const mat = new ShaderMaterial({
          vertexShader: ORGAN_VERT,
          fragmentShader: ORGAN_FRAG,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        });

        scene.add(new Points(geo, mat));
        organGeos.push(geo);
        organMats.push(mat);
        organBaseOffsets.push(offsets);
      }

      // ── Streams ─────────────────────────────────────────────────────────────

      const streamGeos: BufferGeometry[] = [];
      const streamMats: ShaderMaterial[] = [];
      // Per-stream flow accumulator
      const streamTimes = new Float32Array(STREAM_COUNT);

      for (let s = 0; s < STREAM_COUNT; s++) {
        const positions = new Float32Array(PARTICLES_PER_STREAM * 3);
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(positions, 3));

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

      function updateStreams() {
        for (let s = 0; s < STREAM_COUNT; s++) {
          const [aIdx, bIdx] = STREAM_PAIRS[s];
          const [ax, ay] = organCenters[aIdx];
          const [bx, by] = organCenters[bIdx];
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          // Perpendicular unit vector
          const px = -dy / len;
          const py = dx / len;

          const posAttr = streamGeos[s].getAttribute(
            "position"
          ) as BufferAttribute;
          const arr = posAttr.array as Float32Array;

          for (let i = 0; i < PARTICLES_PER_STREAM; i++) {
            const t = ((streamTimes[s] + i / PARTICLES_PER_STREAM) % 1 + 1) % 1;
            const perp = Math.sin(t * 3 * Math.PI * 2) * 20;
            arr[i * 3] = ax + dx * t + px * perp;
            arr[i * 3 + 1] = ay + dy * t + py * perp;
            arr[i * 3 + 2] = 0;
          }
          posAttr.needsUpdate = true;
        }
      }

      updateStreams();

      // ── Animation loop ───────────────────────────────────────────────────────

      let time = 0;
      let rafId = 0;

      function animate() {
        time += 0.016;

        // Organ pulse
        for (let o = 0; o < ORGAN_COUNT; o++) {
          const [cx, cy] = organCenters[o];
          const pulse =
            Math.sin(time * organPulseSpeed[o] + organPulsePhase[o]) * 0.06 +
            1.0;
          const offsets = organBaseOffsets[o];
          const posAttr = organGeos[o].getAttribute(
            "position"
          ) as BufferAttribute;
          const arr = posAttr.array as Float32Array;

          for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
            arr[i * 3] = cx + offsets[i * 3] * pulse;
            arr[i * 3 + 1] = cy + offsets[i * 3 + 1] * pulse;
            arr[i * 3 + 2] = 0;
          }
          posAttr.needsUpdate = true;
        }

        // Stream flow
        for (let s = 0; s < STREAM_COUNT; s++) {
          streamTimes[s] = (streamTimes[s] + 0.003) % 1;
        }
        updateStreams();

        renderer.render(scene, camera);
        rafId = window.requestAnimationFrame(animate);
      }

      rafId = window.requestAnimationFrame(animate);

      // ── Resize ───────────────────────────────────────────────────────────────

      function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        renderer.setSize(width, height);
        camera.right = width;
        camera.bottom = height;
        camera.updateProjectionMatrix();
        for (let o = 0; o < ORGAN_COUNT; o++) {
          organCenters[o][0] = ORGAN_NORM[o][0] * width;
          organCenters[o][1] = ORGAN_NORM[o][1] * height;
        }
      }

      window.addEventListener("resize", onResize);

      return () => {
        window.cancelAnimationFrame(rafId);
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
  }
);

export default CreatureCanvas;
