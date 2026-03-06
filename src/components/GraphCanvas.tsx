"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  Raycaster,
} from "three";
import type { GraphData } from "@/lib/vault";

// ── Helpers ───────────────────────────────────────────────────────────────────

function gauss(sigma: number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── Organ data (mirrors CreatureCanvas) ──────────────────────────────────────

// [vw_fraction, vh_fraction] from screen center — same as CreatureCanvas
const VP_OFFSETS: [number, number][] = [
  [-0.28, +0.22], // 0 — top left
  [+0.31, +0.18], // 1 — top right
  [-0.35, -0.20], // 2 — bottom left
  [+0.25, -0.28], // 3 — bottom right
  [+0.04, -0.05], // 4 — near center (THE CORE)
];

const ORGAN_COLORS: [[number, number, number], [number, number, number]][] = [
  [[0, 1, 0.82], [1, 1, 1]],
  [[0, 1, 0.82], [0.541, 0.706, 0.973]],
  [[0, 1, 0.667], [1, 1, 1]],
  [[0, 1, 0.82], [0.667, 1, 0.933]],
  [[1, 0.227, 0.102], [1, 0.549, 0.412]],
];

const ORGAN_PHASES = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);
const PARTICLES_PER_ORGAN = 2500;
const POD_PER_ORGAN = 400; // pseudopod particles per active organ
const CAM_Z = 900;
const FOV_DEG = 45;
const ORBIT_SPEED = (2 * Math.PI) / 3; // rad/sec — 1 full rotation per 3 seconds

// Organ world positions derived from camera geometry + VP_OFFSETS
function computeOrganCenters(w: number, h: number): Vector3[] {
  const halfH = CAM_Z * Math.tan(((FOV_DEG * Math.PI) / 180) / 2);
  const halfW = halfH * (w / h);
  return VP_OFFSETS.map(([vx, vy]) => new Vector3(vx * halfW * 2, vy * halfH * 2, 0));
}

// ── Particle shader ───────────────────────────────────────────────────────────

function makeParticleMat(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uPR: { value: window.devicePixelRatio || 1 },
      uAlpha: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float aSize;
      uniform float uPR;
      uniform float uAlpha;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vColor = color;
        vA = uAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float mask = 1.0 - smoothstep(0.45, 0.5, d);
        gl_FragColor = vec4(vColor, vA * mask);
      }
    `,
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphCanvasProps {
  graph: GraphData;
  selectedSlug: string | null;
  onSelectNode(slug: string | null): void;
  isLinkHovered: boolean;
}

interface NodeVisual {
  slug: string;
  mesh: Mesh;
  haloMesh: Mesh;
  baseColor: Color;
  position: Vector3;
  previous: Vector3;
  acceleration: Vector3;
  radius: number;
  idx: number;
  status: string;
  type: string;
  haloTarget: number;
  haloCurrent: number;
}

interface EdgeVisual {
  sourceIndex: number;
  targetIndex: number;
  line: Line;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GraphCanvas({
  graph,
  onSelectNode,
  isLinkHovered,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  // Stable refs so main setup effect never re-runs on callback/prop changes
  const onSelectRef = useRef(onSelectNode);
  useEffect(() => {
    onSelectRef.current = onSelectNode;
  }, [onSelectNode]);

  const linkHoveredRef = useRef(isLinkHovered);
  useEffect(() => {
    linkHoveredRef.current = isLinkHovered;
  }, [isLinkHovered]);

  useEffect(() => {
    if (!containerRef.current || !inputRef.current) return;

    // ── Three.js core ─────────────────────────────────────────────────────────

    const scene = new Scene();
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 1);

    const container = containerRef.current;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add("creature-canvas");

    let width = window.innerWidth;
    let height = window.innerHeight;

    const camera = new PerspectiveCamera(FOV_DEG, width / height, 0.1, 5000);
    camera.position.set(0, 0, CAM_Z);

    // Graph nodes/edges live here — no rotation, stable like the creature's body
    const rootGroup = new Group();
    scene.add(rootGroup);

    // ── Dormant organs (5 × 2500 particles, 18% brightness) ──────────────────

    let organCenters = computeOrganCenters(width, height);

    const organAlpha = new Float32Array(5).fill(0.18);
    const organAlphaTarget = new Float32Array(5).fill(0.18);

    const organGeos: BufferGeometry[] = [];
    const organMats: ShaderMaterial[] = [];
    const organOffsets: Float32Array[] = [];

    for (let o = 0; o < 5; o++) {
      const center = organCenters[o];
      const sigmaX = 90 + Math.random() * 30;
      const sigmaY = 70 + Math.random() * 30;
      const [core, edge] = ORGAN_COLORS[o];

      const positions = new Float32Array(PARTICLES_PER_ORGAN * 3);
      const colors = new Float32Array(PARTICLES_PER_ORGAN * 3);
      const sizes = new Float32Array(PARTICLES_PER_ORGAN);
      const offsets = new Float32Array(PARTICLES_PER_ORGAN * 3);

      for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
        const ox = gauss(sigmaX);
        const oy = gauss(sigmaY);
        offsets[i * 3] = ox;
        offsets[i * 3 + 1] = oy;
        positions[i * 3] = center.x + ox;
        positions[i * 3 + 1] = center.y + oy;
        positions[i * 3 + 2] = 0;

        const life = Math.min(1, Math.sqrt((ox / sigmaX) ** 2 + (oy / sigmaY) ** 2));
        colors[i * 3] = core[0] + (edge[0] - core[0]) * life;
        colors[i * 3 + 1] = core[1] + (edge[1] - core[1]) * life;
        colors[i * 3 + 2] = core[2] + (edge[2] - core[2]) * life;
        sizes[i] = 1.2 + Math.random() * 0.5;
      }

      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));
      geo.setAttribute("color", new BufferAttribute(colors, 3));
      geo.setAttribute("aSize", new BufferAttribute(sizes, 1));

      const mat = makeParticleMat();
      mat.uniforms.uAlpha.value = 0.18;

      scene.add(new Points(geo, mat));
      organGeos.push(geo);
      organMats.push(mat);
      organOffsets.push(offsets);
    }

    // ── Nodes ─────────────────────────────────────────────────────────────────

    const nodes: NodeVisual[] = [];
    const edges: EdgeVisual[] = [];
    const slugToIdx = new Map<string, number>();
    const sphereGeo = new SphereGeometry(1, 12, 12);

    let minBL = Infinity,
      maxBL = -Infinity;
    for (const n of graph.nodes) {
      minBL = Math.min(minBL, n.backlinkCount);
      maxBL = Math.max(maxBL, n.backlinkCount);
    }
    if (!Number.isFinite(minBL)) {
      minBL = 0;
      maxBL = 1;
    }

    const mapR = (count: number) =>
      maxBL === minBL ? 10 : 3 + ((count - minBL) / (maxBL - minBL)) * 15;

    const nodeColor = (status: string, type: string): Color => {
      if (type === "essay") return new Color("#e8ff00");
      if (status === "evergreen") return new Color("#00ffd1");
      if (status === "budding") return new Color("#ffffff").multiplyScalar(0.7);
      return new Color("#ffffff").multiplyScalar(0.35);
    };

    // Start nodes near their conceptual organ — force sim drifts from there
    const initPos = (type: string, status: string, i: number): Vector3 => {
      if (type === "essay") {
        return organCenters[4].clone().add(new Vector3(gauss(60), gauss(60), gauss(15)));
      }
      if (status === "evergreen") {
        const o = Math.random() < 0.5 ? 0 : 1;
        return organCenters[o].clone().add(new Vector3(gauss(80), gauss(80), gauss(20)));
      }
      if (status === "budding") {
        const o = Math.random() < 0.5 ? 2 : 3;
        return organCenters[o].clone().add(new Vector3(gauss(80), gauss(80), gauss(20)));
      }
      // Seedling — outer ring
      const angle =
        (i / Math.max(1, graph.nodes.length)) * Math.PI * 2 +
        (Math.random() - 0.5) * 0.8;
      const r = 480 + Math.random() * 220;
      return new Vector3(
        Math.cos(angle) * r,
        Math.sin(angle) * r * 0.6,
        (Math.random() - 0.5) * 40
      );
    };

    graph.nodes.forEach((node, i) => {
      const r = mapR(node.backlinkCount);
      const color = nodeColor(node.status, node.type);
      const baseOpacity =
        node.type === "essay"
          ? 1.0
          : node.status === "evergreen"
          ? 0.9
          : node.status === "budding"
          ? 0.7
          : 0.3; // seedling will flicker

      const mat = new MeshBasicMaterial({ color, transparent: true, opacity: baseOpacity });
      const mesh = new Mesh(sphereGeo, mat);
      mesh.userData.baseOpacity = baseOpacity;

      // Halo: 2.5× radius, same color, 6% opacity
      const haloMat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      });
      const haloMesh = new Mesh(sphereGeo, haloMat);

      const pos = initPos(node.type, node.status, i);
      mesh.position.copy(pos);
      mesh.scale.setScalar(r);
      haloMesh.position.copy(pos);
      haloMesh.scale.setScalar(r * 2.5);

      rootGroup.add(mesh);
      rootGroup.add(haloMesh);

      nodes.push({
        slug: node.slug,
        mesh,
        haloMesh,
        baseColor: color.clone(),
        position: pos.clone(),
        previous: pos.clone(),
        acceleration: new Vector3(),
        radius: r,
        idx: i,
        status: node.status,
        type: node.type,
        haloTarget: r * 2.5,
        haloCurrent: r * 2.5,
      });
      slugToIdx.set(node.slug, i);
    });

    // ── Edges ─────────────────────────────────────────────────────────────────

    const edgeSamples = 16;
    graph.edges.forEach((edge) => {
      const si = slugToIdx.get(edge.source);
      const ti = slugToIdx.get(edge.target);
      if (si === undefined || ti === undefined || si === ti) return;

      const positions = new Float32Array(edgeSamples * 3);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));

      const mat = new LineBasicMaterial({
        color: new Color("#ffffff"),
        transparent: true,
        opacity: 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
      });

      const line = new Line(geo, mat);
      rootGroup.add(line);
      edges.push({ sourceIndex: si, targetIndex: ti, line });
    });

    // ── Pseudopod geometry (2 organs × 400 particles) ─────────────────────────

    const podTotal = POD_PER_ORGAN * 2;
    const podPos = new Float32Array(podTotal * 3);
    const podCol = new Float32Array(podTotal * 3);
    const podSz = new Float32Array(podTotal);
    for (let i = 0; i < podTotal; i++) {
      podPos[i * 3] = -1e6;
      podPos[i * 3 + 1] = -1e6;
      podPos[i * 3 + 2] = 0;
      podCol[i * 3] = 1;
      podCol[i * 3 + 1] = 1;
      podCol[i * 3 + 2] = 1;
      podSz[i] = 1.0 + Math.random() * 0.6;
    }
    const podGeo = new BufferGeometry();
    podGeo.setAttribute("position", new BufferAttribute(podPos, 3));
    podGeo.setAttribute("color", new BufferAttribute(podCol, 3));
    podGeo.setAttribute("aSize", new BufferAttribute(podSz, 1));
    const podMat = makeParticleMat();
    podMat.uniforms.uAlpha.value = 0;
    scene.add(new Points(podGeo, podMat));

    // ── Runtime state ─────────────────────────────────────────────────────────

    const raycaster = new Raycaster();
    const mouse = new Vector2(-9999, -9999);
    const nodeMeshes = nodes.map((n) => n.mesh);

    let hoveredIdx: number | null = null;
    let activeOrgans: [number, number] = [0, 1];
    let podWake = 0;
    let podWakeTarget = 0;
    let flash: { idx: number; frame: number } | null = null;
    let rush: { frame: number; target: Vector3 } | null = null;

    const nearestTwo = (pos: Vector3): [number, number] => {
      const sorted = organCenters
        .map((c, i) => ({ i, d: c.distanceToSquared(pos) }))
        .sort((a, b) => a.d - b.d);
      return [sorted[0].i, sorted[1].i];
    };

    // ── Input ─────────────────────────────────────────────────────────────────

    const input = inputRef.current!;

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        ),
        camera
      );
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      if (hits.length > 0) {
        const idx = nodes.findIndex((n) => n.mesh === hits[0].object);
        if (idx >= 0) {
          // Flash white, rush pods, open panel after visual beat
          (nodes[idx].mesh.material as MeshBasicMaterial).color.set(0xffffff);
          flash = { idx, frame: 0 };
          rush = { frame: 0, target: nodes[idx].position.clone() };
          const slug = nodes[idx].slug;
          setTimeout(() => onSelectRef.current(slug), 300);
          return;
        }
      }
      onSelectRef.current(null);
    };

    input.addEventListener("pointermove", onPointerMove);
    input.addEventListener("click", onClick);

    // ── Force simulation ───────────────────────────────────────────────────────

    const simulate = () => {
      for (const n of nodes) n.acceleration.set(0, 0, 0);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          const delta = new Vector3().subVectors(a.position, b.position);
          const distSq = Math.max(50, delta.lengthSq());
          delta.normalize().multiplyScalar(1800 / distSq);
          a.acceleration.add(delta);
          b.acceleration.sub(delta);
        }
      }

      for (const e of edges) {
        const a = nodes[e.sourceIndex],
          b = nodes[e.targetIndex];
        const delta = new Vector3().subVectors(b.position, a.position);
        const dist = Math.max(10, delta.length());
        delta.normalize().multiplyScalar(0.01 * (dist - 220));
        a.acceleration.add(delta);
        b.acceleration.sub(delta);
      }

      for (const n of nodes) {
        n.acceleration.add(n.position.clone().multiplyScalar(-0.002));
      }

      const dt2 = 0.016 * 0.016;
      for (const n of nodes) {
        const cur = n.position.clone();
        const vel = cur.clone().sub(n.previous).multiplyScalar(0.9);
        n.position.copy(
          cur.clone().add(vel).add(n.acceleration.clone().multiplyScalar(dt2))
        );
        n.previous.copy(cur);
        n.mesh.position.copy(n.position);
        n.haloMesh.position.copy(n.position);
      }
    };

    const updateEdges = () => {
      for (const e of edges) {
        const a = nodes[e.sourceIndex].position;
        const b = nodes[e.targetIndex].position;
        const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
        const dir = new Vector3().subVectors(b, a);
        const perp = new Vector3(-dir.z, 0, dir.x).normalize();
        const curve = new CatmullRomCurve3([
          a,
          mid.clone().add(perp.clone().multiplyScalar(40)),
          mid.clone().add(perp.clone().multiplyScalar(-40)),
          b,
        ]);
        const attr = e.line.geometry.getAttribute("position") as BufferAttribute;
        for (let i = 0; i < edgeSamples; i++) {
          const pt = curve.getPoint(i / (edgeSamples - 1));
          attr.setXYZ(i, pt.x, pt.y, pt.z);
        }
        attr.needsUpdate = true;
      }
    };

    // ── Animation loop ────────────────────────────────────────────────────────

    let frame = 0;
    let animId: number;

    const animate = () => {
      frame++;
      const t = frame / 60; // seconds

      simulate();
      updateEdges();

      // ── Organ breathing: 18% brightness, 0.1× normal speed ───────────────
      for (let o = 0; o < 5; o++) {
        const center = organCenters[o];
        const pulse = 1 + 0.04 * Math.sin(t * 0.06 + ORGAN_PHASES[o]);
        const offs = organOffsets[o];
        const posAttr = organGeos[o].getAttribute("position") as BufferAttribute;
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < PARTICLES_PER_ORGAN; i++) {
          arr[i * 3] = center.x + offs[i * 3] * pulse;
          arr[i * 3 + 1] = center.y + offs[i * 3 + 1] * pulse;
          arr[i * 3 + 2] = 0;
        }
        posAttr.needsUpdate = true;

        // Lerp alpha toward target (~0.5 s)
        organAlpha[o] += (organAlphaTarget[o] - organAlpha[o]) * 0.05;
        organMats[o].uniforms.uAlpha.value = organAlpha[o];
      }

      // ── Organ alpha targets (recomputed each frame) ───────────────────────
      organAlphaTarget.fill(0.18);
      if (hoveredIdx !== null) {
        organAlphaTarget[activeOrgans[0]] = 0.6;
        organAlphaTarget[activeOrgans[1]] = 0.6;
      } else if (linkHoveredRef.current) {
        organAlphaTarget[2] = 0.5; // organ 2 = bottom left, near RETURN TO VOID
      }

      // ── Hover detection ───────────────────────────────────────────────────
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      const newHovered = hits.length > 0
        ? nodes.findIndex((n) => n.mesh === hits[0].object)
        : null;

      if (newHovered !== hoveredIdx) {
        // Restore previous node appearance
        if (hoveredIdx !== null) {
          nodes[hoveredIdx].haloTarget = nodes[hoveredIdx].radius * 2.5;
          const m = nodes[hoveredIdx].mesh.material as MeshBasicMaterial;
          m.opacity = nodes[hoveredIdx].mesh.userData.baseOpacity as number;
          m.needsUpdate = true;
        }

        hoveredIdx = newHovered;
        podWakeTarget = hoveredIdx !== null ? 1 : 0;

        if (hoveredIdx !== null) {
          activeOrgans = nearestTwo(nodes[hoveredIdx].position);
          nodes[hoveredIdx].haloTarget = nodes[hoveredIdx].radius * 4.0;
          const m = nodes[hoveredIdx].mesh.material as MeshBasicMaterial;
          m.opacity = 1.0;
          m.needsUpdate = true;
        }

        // Edge highlight
        for (const e of edges) {
          const m = e.line.material as LineBasicMaterial;
          m.opacity =
            hoveredIdx !== null &&
            (e.sourceIndex === hoveredIdx || e.targetIndex === hoveredIdx)
              ? 0.4
              : 0.08;
          m.needsUpdate = true;
        }
      }

      // ── Halo scale lerp (~0.3 s) ──────────────────────────────────────────
      for (const n of nodes) {
        n.haloCurrent += (n.haloTarget - n.haloCurrent) * 0.1;
        n.haloMesh.scale.setScalar(n.haloCurrent);
      }

      // ── Seedling opacity flicker ──────────────────────────────────────────
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.status !== "seedling" || i === hoveredIdx) continue;
        const m = n.mesh.material as MeshBasicMaterial;
        m.opacity = Math.max(0.05, 0.3 + Math.sin(t * 2.0 + i) * 0.15);
        m.needsUpdate = true;
      }

      // ── Click flash: white → base color over 24 frames ───────────────────
      if (flash) {
        flash.frame++;
        const n = nodes[flash.idx];
        const m = n.mesh.material as MeshBasicMaterial;
        m.color.lerpColors(
          new Color(0xffffff),
          n.baseColor,
          Math.min(1, flash.frame / 24)
        );
        m.needsUpdate = true;
        if (flash.frame >= 24) flash = null;
      }

      // ── Pseudopod wake ────────────────────────────────────────────────────
      podWake += (podWakeTarget - podWake) * 0.08;

      if (rush) {
        rush.frame++;
        const rT = Math.min(1, rush.frame / 24);
        podMat.uniforms.uAlpha.value = podWake * (1 - rT);
        if (rush.frame >= 24) {
          rush = null;
          podWakeTarget = 0;
        }
      } else {
        podMat.uniforms.uAlpha.value = podWake;
      }

      // ── Pseudopod position update ─────────────────────────────────────────
      if (hoveredIdx !== null && !rush) {
        const nodePos = nodes[hoveredIdx].position;
        const orbitR = nodes[hoveredIdx].radius + 8;

        for (let side = 0; side < 2; side++) {
          const oCenter = organCenters[activeOrgans[side]];
          const base = side * POD_PER_ORGAN;
          const dir = new Vector3().subVectors(nodePos, oCenter).normalize();
          const perp = new Vector3(-dir.y, dir.x, 0).normalize();

          for (let i = 0; i < POD_PER_ORGAN; i++) {
            const flowPhase = ((i / POD_PER_ORGAN + frame * 0.004) % 1 + 1) % 1;
            const idx3 = (base + i) * 3;
            let px: number, py: number;

            if (flowPhase < 0.82) {
              // Stream: organ center → orbit boundary
              const lT = flowPhase / 0.82;
              const nearX = nodePos.x - dir.x * orbitR;
              const nearY = nodePos.y - dir.y * orbitR;
              px = oCenter.x + (nearX - oCenter.x) * lT;
              py = oCenter.y + (nearY - oCenter.y) * lT;
              // Tapered organic waviness
              const wave = Math.sin(flowPhase * 4 * Math.PI * 2) * 12 * (1 - lT);
              px += perp.x * wave;
              py += perp.y * wave;
            } else {
              // Orbit: circle the node
              const orbitFrac = (flowPhase - 0.82) / 0.18;
              const angle = t * ORBIT_SPEED + orbitFrac * 2 * Math.PI + side * Math.PI;
              px = nodePos.x + Math.cos(angle) * orbitR;
              py = nodePos.y + Math.sin(angle) * orbitR;
            }

            podPos[idx3] = px;
            podPos[idx3 + 1] = py;
            podPos[idx3 + 2] = 0;
          }
        }
      } else {
        // Park off-screen when no hover
        for (let i = 0; i < podTotal; i++) {
          podPos[i * 3] = -1e6;
          podPos[i * 3 + 1] = -1e6;
          podPos[i * 3 + 2] = 0;
        }
      }
      (podGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;

      renderer.render(scene, camera);
      animId = window.requestAnimationFrame(animate);
    };

    animate();

    // ── Resize ────────────────────────────────────────────────────────────────

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      organCenters = computeOrganCenters(width, height);
    };

    resize();
    window.addEventListener("resize", resize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      input.removeEventListener("pointermove", onPointerMove);
      input.removeEventListener("click", onClick);
      organGeos.forEach((g) => g.dispose());
      organMats.forEach((m) => m.dispose());
      sphereGeo.dispose();
      podGeo.dispose();
      podMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [graph]); // stable: callbacks accessed via refs

  return (
    <>
      <div ref={containerRef} />
      <div ref={inputRef} className="graph-input-layer" />
    </>
  );
}
