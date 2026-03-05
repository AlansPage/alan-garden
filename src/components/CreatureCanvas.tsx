"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";

const TOTAL_PARTICLES = 20000;
const BLOOD_PARTICLES = 800;
const POD_PARTICLES = 2000;
const ORGAN_PARTICLES = TOTAL_PARTICLES - BLOOD_PARTICLES - POD_PARTICLES; // 17,200

interface Organ {
  center: Vector3;
  baseRadius: number;
  pulseSpeed: number;
  pulseAmplitude: number;
  phase: number;
  growth: number;
  growthPhase: "none" | "grow" | "decay";
  growthStartMs: number;
  growthFrom: number;
  growthTo: number;
  growthDurationMs: number;
}

function makeParticleMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: 1 },
      uGlobalAlpha: { value: 1 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      uniform float uGlobalAlpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vAlpha = aAlpha * uGlobalAlpha;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        float mask = 1.0 - smoothstep(0.45, 0.5, d);
        gl_FragColor = vec4(vColor, vAlpha * mask);
      }
    `,
  });
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
        growth: 1,
        growthPhase: "none",
        growthStartMs: 0,
        growthFrom: 1,
        growthTo: 1,
        growthDurationMs: 0,
      });
    }

    // Organs
    const organGeometry = new BufferGeometry();
    const organPositions = new Float32Array(ORGAN_PARTICLES * 3);
    const organColors = new Float32Array(ORGAN_PARTICLES * 3);
    const organBaseColors = new Float32Array(ORGAN_PARTICLES * 3);
    const organSizes = new Float32Array(ORGAN_PARTICLES);
    const organAlpha = new Float32Array(ORGAN_PARTICLES);
    const organIndex = new Uint8Array(ORGAN_PARTICLES);
    const organOffsets = new Float32Array(ORGAN_PARTICLES * 3);
    const organParticleLists: number[][] = Array.from(
      { length: organCount },
      () => []
    );

    // Bloodstream
    const bloodGeometry = new BufferGeometry();
    const bloodPositions = new Float32Array(BLOOD_PARTICLES * 3);
    const bloodColors = new Float32Array(BLOOD_PARTICLES * 3);
    const bloodSizes = new Float32Array(BLOOD_PARTICLES);
    const bloodAlpha = new Float32Array(BLOOD_PARTICLES);
    const streamData: {
      from: number;
      to: number;
      t: number;
      speed: number;
    }[] = [];

    // Pseudopod
    const podGeometry = new BufferGeometry();
    const podPositions = new Float32Array(POD_PARTICLES * 3);
    const podColors = new Float32Array(POD_PARTICLES * 3);
    const podSizes = new Float32Array(POD_PARTICLES);
    const podAlpha = new Float32Array(POD_PARTICLES);
    const podT = new Float32Array(POD_PARTICLES);
    const podSpeed = new Float32Array(POD_PARTICLES);
    const podReturning = new Uint8Array(POD_PARTICLES);
    const podVelocity = new Float32Array(POD_PARTICLES * 3);

    // Bloodstream initialization
    for (let i = 0; i < BLOOD_PARTICLES; i++) {
      const from = Math.floor(Math.random() * organCount);
      let to = Math.floor(Math.random() * organCount);
      if (to === from) to = (to + 1) % organCount;
      streamData.push({
        from,
        to,
        t: Math.random(),
        speed: 0.003 + Math.random() * 0.005,
      });

      const idx3 = i * 3;
      bloodPositions[idx3] = organs[from].center.x;
      bloodPositions[idx3 + 1] = organs[from].center.y;
      bloodPositions[idx3 + 2] = 0;
      bloodColors[idx3] = 1;
      bloodColors[idx3 + 1] = 1;
      bloodColors[idx3 + 2] = 1;
      bloodAlpha[i] = 0.3;
      bloodSizes[i] = 1.0 + Math.random() * 0.8;
    }

    // Organ initialization
    for (let i = 0; i < ORGAN_PARTICLES; i++) {
      const oIndex = Math.floor(Math.random() * organCount);
      organIndex[i] = oIndex;
      organParticleLists[oIndex].push(i);
      const organ = organs[oIndex];

      const theta = Math.random() * Math.PI * 2;
      const r = organ.baseRadius * (0.3 + Math.random() * 0.7);
      const ex = Math.cos(theta) * r;
      const ey = Math.sin(theta) * (r * (0.6 + Math.random() * 0.4));

      const idx3 = i * 3;
      organOffsets[idx3] = ex;
      organOffsets[idx3 + 1] = ey;
      organOffsets[idx3 + 2] = 0;

      const edgeFactor = Math.min(
        1,
        Math.max(0, Math.sqrt((ex * ex + ey * ey) / (organ.baseRadius * organ.baseRadius)))
      );

      const mixed = new Color(0x00ffd1).lerp(new Color(0xffffff), edgeFactor);
      organColors[idx3] = mixed.r;
      organColors[idx3 + 1] = mixed.g;
      organColors[idx3 + 2] = mixed.b;
      organBaseColors[idx3] = mixed.r;
      organBaseColors[idx3 + 1] = mixed.g;
      organBaseColors[idx3 + 2] = mixed.b;

      organPositions[idx3] = organ.center.x + ex;
      organPositions[idx3 + 1] = organ.center.y + ey;
      organPositions[idx3 + 2] = 0;

      organAlpha[i] = 1.0;
      organSizes[i] = 1.0 + Math.random() * 0.8;
    }

    // Pod initialization (hidden until feeding)
    for (let i = 0; i < POD_PARTICLES; i++) {
      const idx3 = i * 3;
      podPositions[idx3] = -10000;
      podPositions[idx3 + 1] = -10000;
      podPositions[idx3 + 2] = 0;
      podColors[idx3] = 1;
      podColors[idx3 + 1] = 1;
      podColors[idx3 + 2] = 1;
      podAlpha[i] = 0;
      podSizes[i] = 1.0 + Math.random() * 0.8;
      podT[i] = Math.random();
      podSpeed[i] = 0.003 + Math.random() * 0.005;
      podReturning[i] = 0;
      podVelocity[idx3] = 0;
      podVelocity[idx3 + 1] = 0;
      podVelocity[idx3 + 2] = 0;
    }

    organGeometry.setAttribute("position", new BufferAttribute(organPositions, 3));
    organGeometry.setAttribute("color", new BufferAttribute(organColors, 3));
    organGeometry.setAttribute("aSize", new BufferAttribute(organSizes, 1));
    organGeometry.setAttribute("aAlpha", new BufferAttribute(organAlpha, 1));

    bloodGeometry.setAttribute("position", new BufferAttribute(bloodPositions, 3));
    bloodGeometry.setAttribute("color", new BufferAttribute(bloodColors, 3));
    bloodGeometry.setAttribute("aSize", new BufferAttribute(bloodSizes, 1));
    bloodGeometry.setAttribute("aAlpha", new BufferAttribute(bloodAlpha, 1));

    podGeometry.setAttribute("position", new BufferAttribute(podPositions, 3));
    podGeometry.setAttribute("color", new BufferAttribute(podColors, 3));
    podGeometry.setAttribute("aSize", new BufferAttribute(podSizes, 1));
    podGeometry.setAttribute("aAlpha", new BufferAttribute(podAlpha, 1));

    const organMaterial = makeParticleMaterial();
    const bloodMaterial = makeParticleMaterial();
    const podMaterial = makeParticleMaterial();
    const pixelRatio = window.devicePixelRatio || 1;
    organMaterial.uniforms.uPixelRatio.value = pixelRatio;
    bloodMaterial.uniforms.uPixelRatio.value = pixelRatio;
    podMaterial.uniforms.uPixelRatio.value = pixelRatio;

    const organPoints = new Points(organGeometry, organMaterial);
    const bloodPoints = new Points(bloodGeometry, bloodMaterial);
    const podPoints = new Points(podGeometry, podMaterial);
    scene.add(organPoints);
    scene.add(bloodPoints);
    scene.add(podPoints);

    const drift = new Vector3(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      0
    );

    let feeding = false;
    let feedingOrgan = 0;
    let feedingTarget = new Vector3(width / 2, height / 2, 0);
    let feedingStartMs = 0;
    let lastFeedingOrgan: number | null = null;

    let dimTarget = 1;
    let dimCurrent = 1;

    const onStartFeeding = (event: Event) => {
      const now = performance.now();
      const custom = event as CustomEvent<{ targetRect?: DOMRect | null }>;
      const rect = custom.detail?.targetRect ?? null;
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
      const center = new Vector3(width / 2, height / 2, 0);
      for (let i = 0; i < organs.length; i++) {
        const d = organs[i].center.distanceToSquared(center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }

      feedingOrgan = best;
      lastFeedingOrgan = best;
      feeding = true;
      feedingStartMs = now;

      for (let i = 0; i < POD_PARTICLES; i++) {
        podAlpha[i] = 0.3;
        podReturning[i] = 0;
      }
      (podGeometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
    };

    const onStopFeeding = () => {
      feeding = false;

      for (let i = 0; i < POD_PARTICLES; i++) {
        podAlpha[i] = 0;
        podReturning[i] = 0;
      }
      (podGeometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;

      if (lastFeedingOrgan !== null) {
        const organ = organs[lastFeedingOrgan];
        organ.growthPhase = "grow";
        organ.growthStartMs = performance.now();
        organ.growthFrom = organ.growth;
        organ.growthTo = 1.15;
        organ.growthDurationMs = 4000;
      }
    };

    const onCharConsumed = (event: Event) => {
      if (!feeding) return;
      const custom = event as CustomEvent<{ x: number; y: number }>;
      const { x, y } = custom.detail;
      const organ = organs[feedingOrgan];

      const births = 8 + Math.floor(Math.random() * 5); // 8–12
      for (let k = 0; k < births; k++) {
        const i = Math.floor(Math.random() * POD_PARTICLES);
        const idx3 = i * 3;

        podReturning[i] = 1;
        podPositions[idx3] = x;
        podPositions[idx3 + 1] = y;
        podPositions[idx3 + 2] = 0;

        const dir = new Vector3(organ.center.x - x, organ.center.y - y, 0);
        const len = Math.max(1, dir.length());
        dir.multiplyScalar(1 / len);
        const speed = 5 + Math.random() * 7;
        podVelocity[idx3] = dir.x * speed;
        podVelocity[idx3 + 1] = dir.y * speed;
        podVelocity[idx3 + 2] = 0;
      }
    };

    const handleDim = (event: Event) => {
      const custom = event as CustomEvent<boolean>;
      dimTarget = Boolean(custom.detail) ? 0.15 : 1;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.left = 0;
      camera.right = width;
      camera.top = height;
      camera.bottom = 0;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("creature-dim", handleDim as EventListener);
    window.addEventListener("creature-start-feeding", onStartFeeding as EventListener);
    window.addEventListener("creature-stop-feeding", onStopFeeding as EventListener);
    window.addEventListener("creature-char-consumed", onCharConsumed as EventListener);

    let frame = 0;
    let animationFrameId = 0;

    const redPulse = new Color(0xff3a1a);

    const animate = () => {
      frame += 1;
      const now = performance.now();

      dimCurrent += (dimTarget - dimCurrent) * 0.06;
      organMaterial.uniforms.uGlobalAlpha.value = dimCurrent;
      bloodMaterial.uniforms.uGlobalAlpha.value = dimCurrent;
      podMaterial.uniforms.uGlobalAlpha.value = dimCurrent;

      // Drift + edge avoidance (slow)
      for (const organ of organs) {
        organ.center.x += drift.x;
        organ.center.y += drift.y;
        if (organ.center.x < edgeMargin || organ.center.x > width - edgeMargin) {
          drift.x *= -1;
        }
        if (organ.center.y < edgeMargin || organ.center.y > height - edgeMargin) {
          drift.y *= -1;
        }

        if (organ.growthPhase !== "none") {
          const t = Math.min(
            1,
            (now - organ.growthStartMs) / Math.max(1, organ.growthDurationMs)
          );
          organ.growth = organ.growthFrom + (organ.growthTo - organ.growthFrom) * t;
          if (t >= 1) {
            if (organ.growthPhase === "grow") {
              organ.growthPhase = "decay";
              organ.growthStartMs = now;
              organ.growthFrom = organ.growth;
              organ.growthTo = 1;
              organ.growthDurationMs = 20000;
            } else {
              organ.growthPhase = "none";
            }
          }
        }
      }

      const time = frame / 60;

      // Organ feeding color pulse
      if (feeding) {
        const pulseRed = Math.floor((now - feedingStartMs) / 500) % 2 === 1;
        const list = organParticleLists[feedingOrgan] ?? [];
        for (const i of list) {
          const idx3 = i * 3;
          if (pulseRed) {
            organColors[idx3] = organBaseColors[idx3] * 0.35 + redPulse.r * 0.65;
            organColors[idx3 + 1] = organBaseColors[idx3 + 1] * 0.35 + redPulse.g * 0.65;
            organColors[idx3 + 2] = organBaseColors[idx3 + 2] * 0.35 + redPulse.b * 0.65;
          } else {
            organColors[idx3] = organBaseColors[idx3];
            organColors[idx3 + 1] = organBaseColors[idx3 + 1];
            organColors[idx3 + 2] = organBaseColors[idx3 + 2];
          }
        }
        (organGeometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
      } else if (lastFeedingOrgan !== null) {
        const list = organParticleLists[lastFeedingOrgan] ?? [];
        for (const i of list) {
          const idx3 = i * 3;
          organColors[idx3] = organBaseColors[idx3];
          organColors[idx3 + 1] = organBaseColors[idx3 + 1];
          organColors[idx3 + 2] = organBaseColors[idx3 + 2];
        }
        (organGeometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
        lastFeedingOrgan = null;
      }

      // Update organ particle positions
      for (let i = 0; i < ORGAN_PARTICLES; i++) {
        const organ = organs[organIndex[i]];
        const idx3 = i * 3;
        const ex = organOffsets[idx3];
        const ey = organOffsets[idx3 + 1];
        const pulse =
          1 + organ.pulseAmplitude * Math.sin(time * organ.pulseSpeed + organ.phase);
        const s = pulse * organ.growth;
        organPositions[idx3] = organ.center.x + ex * s;
        organPositions[idx3 + 1] = organ.center.y + ey * s;
        organPositions[idx3 + 2] = 0;
      }

      // Update bloodstream positions
      for (let i = 0; i < BLOOD_PARTICLES; i++) {
        const s = streamData[i];
        const from = organs[s.from].center;
        const to = organs[s.to].center;
        s.t += s.speed;
        if (s.t > 1) {
          s.t = 0;
          s.from = s.to;
          let next = Math.floor(Math.random() * organCount);
          if (next === s.from) next = (next + 1) % organCount;
          s.to = next;
        }
        const t = s.t;
        const idx3 = i * 3;
        bloodPositions[idx3] = from.x + (to.x - from.x) * t;
        bloodPositions[idx3 + 1] = from.y + (to.y - from.y) * t;
        bloodPositions[idx3 + 2] = 0;
      }

      // Update pod
      if (feeding) {
        const organ = organs[feedingOrgan];
        const reach = Math.min(1, (now - feedingStartMs) / 1200);
        const dx = (feedingTarget.x - organ.center.x) * reach;
        const dy = (feedingTarget.y - organ.center.y) * reach;

        for (let i = 0; i < POD_PARTICLES; i++) {
          const idx3 = i * 3;
          if (podReturning[i] === 1) {
            podPositions[idx3] += podVelocity[idx3];
            podPositions[idx3 + 1] += podVelocity[idx3 + 1];

            const dirX = organ.center.x - podPositions[idx3];
            const dirY = organ.center.y - podPositions[idx3 + 1];
            const len = Math.max(1, Math.hypot(dirX, dirY));
            const ax = (dirX / len) * 0.8;
            const ay = (dirY / len) * 0.8;

            podVelocity[idx3] = podVelocity[idx3] * 0.92 + ax;
            podVelocity[idx3 + 1] = podVelocity[idx3 + 1] * 0.92 + ay;

            if (len < 24) {
              podReturning[i] = 0;
              podT[i] = Math.random();
            }
          } else {
            podT[i] = (podT[i] + podSpeed[i]) % 1;
            const t = podT[i] * reach;
            podPositions[idx3] = organ.center.x + dx * t;
            podPositions[idx3 + 1] = organ.center.y + dy * t;
            podPositions[idx3 + 2] = 0;
          }
        }
      } else {
        for (let i = 0; i < POD_PARTICLES; i++) {
          const idx3 = i * 3;
          podPositions[idx3] = -10000;
          podPositions[idx3 + 1] = -10000;
          podPositions[idx3 + 2] = 0;
        }
      }

      (organGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (bloodGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (podGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;

      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("creature-dim", handleDim as EventListener);
      window.removeEventListener("creature-start-feeding", onStartFeeding as EventListener);
      window.removeEventListener("creature-stop-feeding", onStopFeeding as EventListener);
      window.removeEventListener("creature-char-consumed", onCharConsumed as EventListener);

      scene.remove(organPoints);
      scene.remove(bloodPoints);
      scene.remove(podPoints);
      organGeometry.dispose();
      bloodGeometry.dispose();
      podGeometry.dispose();
      organMaterial.dispose();
      bloodMaterial.dispose();
      podMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} />;
}

