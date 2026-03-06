"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
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

// ── Color system ──────────────────────────────────────────────────────────────

const TAG_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
];

const STATUS_COLORS: Record<string, string> = {
  seedling: "#5B6FD4",
  budding: "#3CAF7A",
  evergreen: "#00FFD1",
};

function nodeColor(status: string, type: string, tags: string[]): Color {
  if (type === "essay") return new Color("#E8FF00");
  if (tags.length > 0) {
    const tag = tags[0];
    const hash = tag.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return new Color(TAG_COLORS[hash % TAG_COLORS.length]);
  }
  return new Color(STATUS_COLORS[status] ?? "#5B6FD4");
}

function nodeRadius(backlinkCount: number): number {
  if (backlinkCount === 0) return 3;
  if (backlinkCount <= 2) return 5;
  if (backlinkCount <= 5) return 9;
  if (backlinkCount <= 10) return 14;
  return 22;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAM_Z = 900;
const FOV_DEG = 45;
const PARTICLES_PER_EDGE = 60;

// ── Particle shaders ──────────────────────────────────────────────────────────

const PARTICLE_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAG = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float fade = 1.0 - smoothstep(0.4, 1.0, d);
    gl_FragColor = vec4(vColor * vAlpha * fade, 1.0);
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphCanvasProps {
  graph: GraphData;
  selectedSlug: string | null;
  onSelectNode(slug: string | null): void;
  isLinkHovered: boolean;
}

interface NodeVisual {
  slug: string;
  title: string;
  mesh: Mesh; // invisible sphere, raycasting only
  baseColor: Color;
  position: Vector3;
  previous: Vector3;
  acceleration: Vector3;
  radius: number;
  idx: number;
  status: string;
  type: string;
}

interface EdgeInfo {
  sourceIndex: number;
  targetIndex: number;
  sharedConnections: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GraphCanvas({
  graph,
  onSelectNode,
  isLinkHovered: _isLinkHovered,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  const onSelectRef = useRef(onSelectNode);
  useEffect(() => {
    onSelectRef.current = onSelectNode;
  }, [onSelectNode]);

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

    const rootGroup = new Group();
    scene.add(rootGroup);

    // ── Label overlay (canvas 2D, hover-only) ─────────────────────────────────

    const labelCanvas = document.createElement("canvas");
    labelCanvas.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:15;pointer-events:none";
    document.body.appendChild(labelCanvas);
    const labelCtx = labelCanvas.getContext("2d")!;

    function resizeLabelCanvas() {
      labelCanvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      labelCanvas.height = window.innerHeight * (window.devicePixelRatio || 1);
      labelCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    resizeLabelCanvas();

    // ── Particle shader material (shared) ─────────────────────────────────────

    const particleMat = new ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    // ── Nodes ─────────────────────────────────────────────────────────────────

    const nodes: NodeVisual[] = [];
    const edgeInfos: EdgeInfo[] = [];
    const slugToIdx = new Map<string, number>();
    const sphereGeo = new SphereGeometry(1, 12, 12);

    const connectionCount = new Map<string, number>();
    for (const e of graph.edges) {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
    }

    const initPos = (type: string, status: string, i: number): Vector3 => {
      if (type === "essay") {
        return new Vector3(gauss(80), gauss(80), gauss(15));
      }
      if (status === "evergreen") {
        return new Vector3(gauss(180), gauss(180), gauss(20));
      }
      if (status === "budding") {
        return new Vector3(gauss(300), gauss(300), gauss(20));
      }
      const angle =
        (i / Math.max(1, graph.nodes.length)) * Math.PI * 2 +
        (Math.random() - 0.5) * 0.8;
      const r = 400 + Math.random() * 200;
      return new Vector3(
        Math.cos(angle) * r,
        Math.sin(angle) * r * 0.6,
        (Math.random() - 0.5) * 40
      );
    };

    graph.nodes.forEach((node, i) => {
      const r = nodeRadius(node.backlinkCount);
      const color = nodeColor(node.status, node.type, node.tags);

      // Invisible sphere — raycasting only, never renders
      const mat = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new Mesh(sphereGeo, mat);
      const pos = initPos(node.type, node.status, i);
      mesh.position.copy(pos);
      mesh.scale.setScalar(r);
      rootGroup.add(mesh);

      nodes.push({
        slug: node.slug,
        title: node.title,
        mesh,
        baseColor: color.clone(),
        position: pos.clone(),
        previous: pos.clone(),
        acceleration: new Vector3(),
        radius: r,
        idx: i,
        status: node.status,
        type: node.type,
      });
      slugToIdx.set(node.slug, i);
    });

    // ── Edge info ─────────────────────────────────────────────────────────────

    graph.edges.forEach((edge) => {
      const si = slugToIdx.get(edge.source);
      const ti = slugToIdx.get(edge.target);
      if (si === undefined || ti === undefined || si === ti) return;

      const srcConns = connectionCount.get(edge.source) ?? 0;
      const tgtConns = connectionCount.get(edge.target) ?? 0;
      edgeInfos.push({
        sourceIndex: si,
        targetIndex: ti,
        sharedConnections: Math.min(srcConns, tgtConns),
      });
    });

    // ── Edge particle system (single BufferGeometry for all edges) ────────────

    const edgeParticleCount = edgeInfos.length * PARTICLES_PER_EDGE;
    const edgePosArr = new Float32Array(edgeParticleCount * 3);
    const edgeColArr = new Float32Array(edgeParticleCount * 3);
    const edgeAlphaArr = new Float32Array(edgeParticleCount);
    const edgeSizeArr = new Float32Array(edgeParticleCount).fill(1.5);

    const edgeGeo = new BufferGeometry();
    edgeGeo.setAttribute("position", new BufferAttribute(edgePosArr, 3));
    edgeGeo.setAttribute("aColor", new BufferAttribute(edgeColArr, 3));
    edgeGeo.setAttribute("aAlpha", new BufferAttribute(edgeAlphaArr, 1));
    edgeGeo.setAttribute("aSize", new BufferAttribute(edgeSizeArr, 1));

    const edgePoints = new Points(edgeGeo, particleMat);
    rootGroup.add(edgePoints);

    // Per-edge highlight factor: 0.25 base, 1.0 when connected to hovered node
    const edgeHighlight = new Float32Array(edgeInfos.length).fill(0.25);

    // Per-edge wobble seeds (pre-compute once, consistent per session)
    const edgeWobbleX = new Float32Array(edgeInfos.length);
    const edgeWobbleY = new Float32Array(edgeInfos.length);
    for (let ei = 0; ei < edgeInfos.length; ei++) {
      edgeWobbleX[ei] = Math.sin(ei * 7.3 + 1.4) * 8;
      edgeWobbleY[ei] = Math.cos(ei * 3.1 + 2.7) * 8;
    }

    // ── Node particle system ──────────────────────────────────────────────────

    const nodeParticleCount = nodes.length * 2; // core + halo per node
    const nodePosArr = new Float32Array(nodeParticleCount * 3);
    const nodeColArr = new Float32Array(nodeParticleCount * 3);
    const nodeAlphaArr = new Float32Array(nodeParticleCount);
    const nodeSizeArr = new Float32Array(nodeParticleCount);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const hi = nodes.length + i;
      // Core
      nodeSizeArr[i] = n.radius * 2.5;
      nodeAlphaArr[i] = 0.9;
      nodeColArr[i * 3 + 0] = n.baseColor.r;
      nodeColArr[i * 3 + 1] = n.baseColor.g;
      nodeColArr[i * 3 + 2] = n.baseColor.b;
      // Halo
      nodeSizeArr[hi] = Math.min(n.radius * 5.0, 60);
      nodeAlphaArr[hi] = 0.25;
      nodeColArr[hi * 3 + 0] = n.baseColor.r;
      nodeColArr[hi * 3 + 1] = n.baseColor.g;
      nodeColArr[hi * 3 + 2] = n.baseColor.b;
    }

    const nodeGeo = new BufferGeometry();
    nodeGeo.setAttribute("position", new BufferAttribute(nodePosArr, 3));
    nodeGeo.setAttribute("aColor", new BufferAttribute(nodeColArr, 3));
    nodeGeo.setAttribute("aAlpha", new BufferAttribute(nodeAlphaArr, 1));
    nodeGeo.setAttribute("aSize", new BufferAttribute(nodeSizeArr, 1));

    const nodePoints = new Points(nodeGeo, particleMat);
    rootGroup.add(nodePoints);

    // ── Runtime state ─────────────────────────────────────────────────────────

    const raycaster = new Raycaster();
    const mouse = new Vector2(-9999, -9999);
    const nodeMeshes = nodes.map((n) => n.mesh);

    let hoveredIdx: number | null = null;
    let flash: { idx: number; frame: number } | null = null;
    let time = 0;

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
          flash = { idx, frame: 0 };
          const slug = nodes[idx].slug;
          setTimeout(() => onSelectRef.current(slug), 300);
          return;
        }
      }
      onSelectRef.current(null);
    };

    input.addEventListener("pointermove", onPointerMove);
    input.addEventListener("click", onClick);

    // ── Force simulation ──────────────────────────────────────────────────────

    const simulate = () => {
      for (const n of nodes) n.acceleration.set(0, 0, 0);

      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          const delta = new Vector3().subVectors(a.position, b.position);
          const distSq = Math.max(50, delta.lengthSq());
          delta.normalize().multiplyScalar(2520 / distSq);
          a.acceleration.add(delta);
          b.acceleration.sub(delta);
        }
      }

      // Link attraction
      for (const e of edgeInfos) {
        const a = nodes[e.sourceIndex],
          b = nodes[e.targetIndex];
        const delta = new Vector3().subVectors(b.position, a.position);
        const dist = Math.max(10, delta.length());
        delta.normalize().multiplyScalar(0.01 * (dist - 165));
        a.acceleration.add(delta);
        b.acceleration.sub(delta);
      }

      // Center gravity
      for (const n of nodes) {
        n.acceleration.add(n.position.clone().multiplyScalar(-0.002));
      }

      // Verlet integration + slow organic drift
      const dt2 = 0.016 * 0.016;
      for (const n of nodes) {
        const cur = n.position.clone();
        const vel = cur.clone().sub(n.previous).multiplyScalar(0.9);
        n.position.copy(
          cur.clone().add(vel).add(n.acceleration.clone().multiplyScalar(dt2))
        );
        // Slow per-node sine drift — barely perceptible, makes graph feel alive
        n.position.x += Math.sin(time * 0.3 + n.idx * 1.7) * 0.08;
        n.position.y += Math.cos(time * 0.25 + n.idx * 2.3) * 0.08;
        n.previous.copy(cur);
        // Keep invisible raycasting sphere in sync
        n.mesh.position.copy(n.position);
      }
    };

    // ── Update all particle buffers (called every frame) ──────────────────────

    const updateParticles = () => {
      // ── Edge particles ────────────────────────────────────────────────────
      for (let ei = 0; ei < edgeInfos.length; ei++) {
        const e = edgeInfos[ei];
        const src = nodes[e.sourceIndex].position;
        const tgt = nodes[e.targetIndex].position;
        const srcCol = nodes[e.sourceIndex].baseColor;
        const tgtCol = nodes[e.targetIndex].baseColor;
        const wx = edgeWobbleX[ei];
        const wy = edgeWobbleY[ei];
        const baseAlpha = edgeHighlight[ei];

        for (let p = 0; p < PARTICLES_PER_EDGE; p++) {
          const t = p / (PARTICLES_PER_EDGE - 1);
          const pidx = ei * PARTICLES_PER_EDGE + p;
          const b3 = pidx * 3;
          const wobble = Math.sin(t * Math.PI);

          // Position: lerp + perpendicular organic wobble
          edgePosArr[b3 + 0] = src.x + (tgt.x - src.x) * t + wx * wobble;
          edgePosArr[b3 + 1] = src.y + (tgt.y - src.y) * t + wy * wobble;
          edgePosArr[b3 + 2] = src.z + (tgt.z - src.z) * t;

          // Color: lerp source → target
          edgeColArr[b3 + 0] = srcCol.r + (tgtCol.r - srcCol.r) * t;
          edgeColArr[b3 + 1] = srcCol.g + (tgtCol.g - srcCol.g) * t;
          edgeColArr[b3 + 2] = srcCol.b + (tgtCol.b - srcCol.b) * t;

          // Alpha: fade at both ends, bright in middle
          edgeAlphaArr[pidx] = baseAlpha * wobble;
        }
      }

      (edgeGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (edgeGeo.getAttribute("aColor") as BufferAttribute).needsUpdate = true;
      (edgeGeo.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;

      // ── Node particles ────────────────────────────────────────────────────
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const b3 = i * 3;
        const hi = nodes.length + i;
        const hb3 = hi * 3;

        // Position (core + halo follow node)
        nodePosArr[b3 + 0] = n.position.x;
        nodePosArr[b3 + 1] = n.position.y;
        nodePosArr[b3 + 2] = n.position.z;
        nodePosArr[hb3 + 0] = n.position.x;
        nodePosArr[hb3 + 1] = n.position.y;
        nodePosArr[hb3 + 2] = n.position.z;

        // Size + alpha per state
        if (flash && flash.idx === i) {
          const flashFrac = Math.min(1, flash.frame / 24);
          const boost = 1 - flashFrac;
          nodeAlphaArr[i] = 0.9 + boost * 0.5;
          nodeSizeArr[i] = n.radius * 2.5 * (1 + boost * 0.6);
          // Flash color: white → base
          const fr = 1.0 - flashFrac + n.baseColor.r * flashFrac;
          const fg = 1.0 - flashFrac + n.baseColor.g * flashFrac;
          const fb = 1.0 - flashFrac + n.baseColor.b * flashFrac;
          nodeColArr[b3 + 0] = fr;
          nodeColArr[b3 + 1] = fg;
          nodeColArr[b3 + 2] = fb;
        } else if (hoveredIdx === i) {
          nodeAlphaArr[i] = 1.0;
          nodeSizeArr[i] = n.radius * 2.5 * 1.4;
          nodeAlphaArr[hi] = 0.4;
          nodeSizeArr[hi] = Math.min(n.radius * 7.0, 80);
          nodeColArr[b3 + 0] = n.baseColor.r;
          nodeColArr[b3 + 1] = n.baseColor.g;
          nodeColArr[b3 + 2] = n.baseColor.b;
        } else {
          nodeAlphaArr[i] = 0.9;
          nodeSizeArr[i] = n.radius * 2.5;
          nodeAlphaArr[hi] = 0.25;
          nodeSizeArr[hi] = Math.min(n.radius * 5.0, 60);
          nodeColArr[b3 + 0] = n.baseColor.r;
          nodeColArr[b3 + 1] = n.baseColor.g;
          nodeColArr[b3 + 2] = n.baseColor.b;
        }
      }

      (nodeGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (nodeGeo.getAttribute("aColor") as BufferAttribute).needsUpdate = true;
      (nodeGeo.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
      (nodeGeo.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
    };

    // ── Project world pos to screen ───────────────────────────────────────────

    const projectToScreen = (pos: Vector3): [number, number] => {
      const v = pos.clone().project(camera);
      return [
        (v.x * 0.5 + 0.5) * width,
        (-v.y * 0.5 + 0.5) * height,
      ];
    };

    // ── Animation loop ────────────────────────────────────────────────────────

    let animId: number;

    const animate = () => {
      time += 0.016;

      simulate();

      // Hover detection
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      const newHovered =
        hits.length > 0
          ? nodes.findIndex((n) => n.mesh === hits[0].object)
          : null;

      if (newHovered !== hoveredIdx) {
        hoveredIdx = newHovered;
        // Update edge highlight factors
        for (let ei = 0; ei < edgeInfos.length; ei++) {
          const e = edgeInfos[ei];
          if (
            hoveredIdx !== null &&
            (e.sourceIndex === hoveredIdx || e.targetIndex === hoveredIdx)
          ) {
            edgeHighlight[ei] = 1.0;
          } else {
            edgeHighlight[ei] = e.sharedConnections >= 3 ? 0.3 : 0.18;
          }
        }
      }

      // Advance flash
      if (flash) {
        flash.frame++;
        if (flash.frame >= 24) flash = null;
      }

      updateParticles();

      // Label (hover-only, canvas-2D)
      labelCtx.clearRect(0, 0, width, height);
      if (hoveredIdx !== null) {
        const n = nodes[hoveredIdx];
        const [sx, sy] = projectToScreen(n.position);
        const screenR =
          (n.radius * 1.4 * height) /
          (2 * CAM_Z * Math.tan(((FOV_DEG * Math.PI) / 180) / 2));
        labelCtx.font = '10px "IBM Plex Mono", monospace';
        labelCtx.fillStyle = "rgba(255,255,255,0.75)";
        labelCtx.fillText(n.title, sx + screenR + 8, sy + 3);
      }

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
      resizeLabelCanvas();
    };

    resize();
    window.addEventListener("resize", resize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      input.removeEventListener("pointermove", onPointerMove);
      input.removeEventListener("click", onClick);
      sphereGeo.dispose();
      edgeGeo.dispose();
      nodeGeo.dispose();
      particleMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      if (labelCanvas.parentNode) {
        labelCanvas.parentNode.removeChild(labelCanvas);
      }
    };
  }, [graph]);

  return (
    <>
      <div ref={containerRef} />
      <div ref={inputRef} className="graph-input-layer" />
      <Link href="/" className="return-to-void">
        ← RETURN TO VOID
      </Link>
    </>
  );
}
