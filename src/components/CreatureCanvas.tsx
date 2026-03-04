"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

const TOTAL_PARTICLES = 20000;
const STREAM_PARTICLES = 800;
const FEED_PARTICLES = 2000;


interface Organ {
  center: Vector3;
  baseRadius: number;
  pulseSpeed: number;
  pulseAmplitude: number;
  phase: number;
}

export default function CreatureCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new Scene();
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
    });

    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 1);

    const container = containerRef.current;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add("creature-canvas");

    let width = window.innerWidth;
    let height = window.innerHeight;

    const camera = new OrthographicCamera(0, width, height, 0, -1000, 1000);
    camera.position.z = 1;

    const geometry = new BufferGeometry();
    const positions = new Float32Array(TOTAL_PARTICLES * 3);
    const colors = new Float32Array(TOTAL_PARTICLES * 3);

    const organs: Organ[] = [];
    const organCount = Math.floor(Math.random() * 4) + 4; // 4–7 organs

    const edgeMargin = 220;

    for (let i = 0; i < organCount; i++) {
      const cx =
        edgeMargin +
        Math.random() * Math.max(1, width - edgeMargin * 2);
      const cy =
        edgeMargin +
        Math.random() * Math.max(1, height - edgeMargin * 2);

      organs.push({
        center: new Vector3(cx, cy, 0),
        baseRadius: 100 + Math.random() * 100, // 200–400px diameter
        pulseSpeed: 0.2 + Math.random() * 0.2,
        pulseAmplitude: 0.15 + Math.random() * 0.1,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const organIndex = new Uint8Array(TOTAL_PARTICLES);
    const baseOffset = new Float32Array(TOTAL_PARTICLES * 3);
    const streamData: {
      from: number;
      to: number;
      t: number;
      speed: number;
    }[] = [];

    // Initialize stream particles that move between organ centers
    for (let i = 0; i < STREAM_PARTICLES; i++) {
      const from = Math.floor(Math.random() * organCount);
      let to = Math.floor(Math.random() * organCount);
      if (to === from) {
        to = (to + 1) % organCount;
      }
      streamData.push({
        from,
        to,
        t: Math.random(),
        speed: 0.003 + Math.random() * 0.005, // 0.3–0.8 units/frame scaled
      });

      const idx3 = i * 3;
      positions[idx3] = organs[from].center.x;
      positions[idx3 + 1] = organs[from].center.y;
      positions[idx3 + 2] = 0;

      // Streams: soft white
      colors[idx3] = 1.0;
      colors[idx3 + 1] = 1.0;
      colors[idx3 + 2] = 1.0;
    }

    // Initialize organ particles clustered around organ centers
    for (let i = STREAM_PARTICLES; i < TOTAL_PARTICLES; i++) {
      const oIndex = Math.floor(Math.random() * organCount);
      organIndex[i] = oIndex;
      const organ = organs[oIndex];

      const theta = Math.random() * Math.PI * 2;
      const r = organ.baseRadius * (0.3 + Math.random() * 0.7);
      const ex = Math.cos(theta) * r;
      const ey = Math.sin(theta) * (r * (0.6 + Math.random() * 0.4));

      const bIdx3 = i * 3;
      baseOffset[bIdx3] = ex;
      baseOffset[bIdx3 + 1] = ey;
      baseOffset[bIdx3 + 2] = 0;

      const edgeFactor = Math.min(
        1,
        Math.max(0, Math.sqrt((ex * ex + ey * ey) / (organ.baseRadius * organ.baseRadius)))
      );

      const core = new Color(0x00ffd1);
      const edge = new Color(0xffffff);
      const mixed = core.clone().lerp(edge, edgeFactor);

      colors[bIdx3] = mixed.r;
      colors[bIdx3 + 1] = mixed.g;
      colors[bIdx3 + 2] = mixed.b;

      positions[bIdx3] = organ.center.x + ex;
      positions[bIdx3 + 1] = organ.center.y + ey;
      positions[bIdx3 + 2] = 0;
    }

    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));

    const material = new PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    const points = new Points(geometry, material);
    scene.add(points);

    let drift = new Vector3(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      0
    );

    let feeding = false;
    let feedingOrgan = 0;
    let feedingTarget = new Vector3(width / 2, height / 2, 0);
    let feedingStartFrame = 0;

    const onStartFeeding = (event: Event) => {
      const custom = event as CustomEvent<{ targetRect?: DOMRect | null }>;
      const rect = custom.detail?.targetRect;
      if (rect) {
        feedingTarget.set(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          0
        );
      } else {
        feedingTarget.set(width / 2, height / 2, 0);
      }

      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < organs.length; i++) {
        const d = organs[i].center.distanceToSquared(
          new Vector3(width / 2, height / 2, 0)
        );
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      feedingOrgan = best;
      feeding = true;
      feedingStartFrame = frame;
    };

    const onStopFeeding = () => {
      feeding = false;
    };

    const onCharConsumed = (event: Event) => {
      if (!feeding) return;
      const custom = event as CustomEvent<{ x: number; y: number }>;
      const { x, y } = custom.detail;
      const organ = organs[feedingOrgan];

      for (let k = 0; k < 10; k++) {
        const pIndex =
          STREAM_PARTICLES +
          (Math.floor(Math.random() * FEED_PARTICLES) % FEED_PARTICLES);
        const idx3 = pIndex * 3;
        positions[idx3] = x;
        positions[idx3 + 1] = y;
        positions[idx3 + 2] = 0;

        const vx = organ.center.x - x;
        const vy = organ.center.y - y;
        positions[idx3] += vx * 0.05;
        positions[idx3 + 1] += vy * 0.05;
      }
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.left = 0;
      camera.right = width;
      camera.top = 0;
      camera.bottom = height;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);

    const handleDim = (event: Event) => {
      const custom = event as CustomEvent<boolean>;
      const dim = Boolean(custom.detail);
      material.opacity = dim ? 0.15 : 0.9;
      material.needsUpdate = true;
    };

    window.addEventListener("creature-dim", handleDim as EventListener);
    window.addEventListener(
      "creature-start-feeding",
      onStartFeeding as EventListener
    );
    window.addEventListener(
      "creature-stop-feeding",
      onStopFeeding as EventListener
    );
    window.addEventListener(
      "creature-char-consumed",
      onCharConsumed as EventListener
    );

    let frame = 0;
    let animationFrameId: number;

    const animate = () => {
      frame += 1;

      // Gentle drift of whole system with edge avoidance
      for (const organ of organs) {
        organ.center.add(drift);
        if (
          organ.center.x < edgeMargin ||
          organ.center.x > width - edgeMargin
        ) {
          drift.x *= -1;
        }
        if (
          organ.center.y < edgeMargin ||
          organ.center.y > height - edgeMargin
        ) {
          drift.y *= -1;
        }
      }

      const time = frame / 60;

      // Update organ-cluster particles
      for (let i = STREAM_PARTICLES; i < TOTAL_PARTICLES; i++) {
        const organ = organs[organIndex[i]];
        const idx3 = i * 3;
        const bIdx3 = i * 3;

        const ex = baseOffset[bIdx3];
        const ey = baseOffset[bIdx3 + 1];

        const pulse =
          1 +
          organ.pulseAmplitude *
            Math.sin(time * organ.pulseSpeed + organ.phase);

        positions[idx3] = organ.center.x + ex * pulse;
        positions[idx3 + 1] = organ.center.y + ey * pulse;
        positions[idx3 + 2 = 0;
      }

      if (feeding) {
        const organ = organs[feedingOrgan];
        const feedElapsed = (frame - feedingStartFrame) / 60;
        const reach = Math.min(1, feedElapsed / 1.2);
        const dir = new Vector3()
          .subVectors(feedingTarget, organ.center)
          .multiplyScalar(reach);

        for (let i = 0; i < FEED_PARTICLES; i++) {
          const pIndex = STREAM_PARTICLES + i;
          const idx3 = pIndex * 3;
          const t = i / FEED_PARTICLES;
          positions[idx3] = organ.center.x + dir.x * t;
          positions[idx3 + 1] = organ.center.y + dir.y * t;
          positions[idx3 + 2] = 0;
        }
      }

      // Update stream particles flowing organ-to-organ
      for (let i = 0; i < STREAM_PARTICLES; i++) {
        const s = streamData[i];
        const from = organs[s.from].center;
        const to = organs[s.to].center;
        s.t += s.speed;
        if (s.t > 1) {
          s.t = 0;
          s.from = s.to;
          let next = Math.floor(Math.random() * organCount);
          if (next === s.from) {
            next = (next + 1) % organCount;
          }
          s.to = next;
        }
        const t = s.t;
        const idx3 = i * 3;
        positions[idx3] = from.x + (to.x - from.x) * t;
        positions[idx3 + 1] = from.y + (to.y - from.y) * t;
        positions[idx3 + 2] = 0;
      }

      (geometry.attributes.position as BufferAttribute).needsUpdate = true;

      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("creature-dim", handleDim as EventListener);
      window.removeEventListener(
        "creature-start-feeding",
        onStartFeeding as EventListener
      );
      window.removeEventListener(
        "creature-stop-feeding",
        onStopFeeding as EventListener
      );
      window.removeEventListener(
        "creature-char-consumed",
        onCharConsumed as EventListener
      );
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} />;
}

