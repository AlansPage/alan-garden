"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
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

  // If note has tags, hash the first tag into the palette
  if (tags.length > 0) {
    const tag = tags[0];
    const hash = tag.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return new Color(TAG_COLORS[hash % TAG_COLORS.length]);
  }

  return new Color(STATUS_COLORS[status] ?? "#5B6FD4");
}

// ── Node sizing by backlink count ─────────────────────────────────────────────

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
  scaleTarget: number;
  scaleCurrent: number;
}

interface EdgeVisual {
  sourceIndex: number;
  targetIndex: number;
  line: Line;
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

    // ── Label overlay (canvas 2D for hover text) ──────────────────────────────

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

    // ── Nodes ─────────────────────────────────────────────────────────────────

    const nodes: NodeVisual[] = [];
    const edges: EdgeVisual[] = [];
    const slugToIdx = new Map<string, number>();
    const sphereGeo = new SphereGeometry(1, 12, 12);

    // Count connections per node for edge opacity
    const connectionCount = new Map<string, number>();
    for (const e of graph.edges) {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
    }

    // Initial positions: spread out by type/status
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
      // Seedling — outer ring
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
      const baseOpacity = node.type === "essay" ? 1.0 : 0.85;

      const mat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: baseOpacity,
      });
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
        title: node.title,
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
        scaleTarget: r,
        scaleCurrent: r,
      });
      slugToIdx.set(node.slug, i);
    });

    // ── Edges ─────────────────────────────────────────────────────────────────

    graph.edges.forEach((edge) => {
      const si = slugToIdx.get(edge.source);
      const ti = slugToIdx.get(edge.target);
      if (si === undefined || ti === undefined || si === ti) return;

      // Count shared connections for opacity
      const srcConns = connectionCount.get(edge.source) ?? 0;
      const tgtConns = connectionCount.get(edge.target) ?? 0;
      const shared = Math.min(srcConns, tgtConns);

      const positions = new Float32Array(2 * 3);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(positions, 3));

      const opacity = shared >= 3 ? 0.15 : 0.05;
      const mat = new LineBasicMaterial({
        color: new Color("#ffffff"),
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        linewidth: 0.5,
      });

      const line = new Line(geo, mat);
      rootGroup.add(line);
      edges.push({ sourceIndex: si, targetIndex: ti, line, sharedConnections: shared });
    });

    // ── Runtime state ─────────────────────────────────────────────────────────

    const raycaster = new Raycaster();
    const mouse = new Vector2(-9999, -9999);
    const nodeMeshes = nodes.map((n) => n.mesh);

    let hoveredIdx: number | null = null;
    let flash: { idx: number; frame: number } | null = null;

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
          (nodes[idx].mesh.material as MeshBasicMaterial).color.set(0xffffff);
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

    // ── Force simulation (FIX 4: tighter clusters) ────────────────────────────

    const simulate = () => {
      for (const n of nodes) n.acceleration.set(0, 0, 0);

      // Repulsion: 40% stronger than original (1800 * 1.4 = 2520)
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

      // Link attraction: 25% shorter rest length (220 * 0.75 = 165)
      for (const e of edges) {
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

      // Verlet integration
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
        const attr = e.line.geometry.getAttribute("position") as BufferAttribute;
        attr.setXYZ(0, a.x, a.y, a.z);
        attr.setXYZ(1, b.x, b.y, b.z);
        attr.needsUpdate = true;
      }
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
      simulate();
      updateEdges();

      // ── Hover detection ───────────────────────────────────────────────────
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      const newHovered =
        hits.length > 0
          ? nodes.findIndex((n) => n.mesh === hits[0].object)
          : null;

      if (newHovered !== hoveredIdx) {
        // Restore previous
        if (hoveredIdx !== null) {
          nodes[hoveredIdx].haloTarget = nodes[hoveredIdx].radius * 2.5;
          nodes[hoveredIdx].scaleTarget = nodes[hoveredIdx].radius;
          const m = nodes[hoveredIdx].mesh.material as MeshBasicMaterial;
          m.opacity = nodes[hoveredIdx].mesh.userData.baseOpacity as number;
          m.needsUpdate = true;
        }

        hoveredIdx = newHovered;

        if (hoveredIdx !== null) {
          nodes[hoveredIdx].haloTarget = nodes[hoveredIdx].radius * 4.0;
          nodes[hoveredIdx].scaleTarget = nodes[hoveredIdx].radius * 1.4;
          const m = nodes[hoveredIdx].mesh.material as MeshBasicMaterial;
          m.opacity = 1.0;
          m.needsUpdate = true;
        }

        // Edge highlight on hover
        for (const e of edges) {
          const m = e.line.material as LineBasicMaterial;
          if (
            hoveredIdx !== null &&
            (e.sourceIndex === hoveredIdx || e.targetIndex === hoveredIdx)
          ) {
            m.opacity = 0.4;
          } else {
            m.opacity = e.sharedConnections >= 3 ? 0.15 : 0.05;
          }
          m.needsUpdate = true;
        }
      }

      // ── Scale + halo lerp ──────────────────────────────────────────────────
      for (const n of nodes) {
        n.haloCurrent += (n.haloTarget - n.haloCurrent) * 0.1;
        n.haloMesh.scale.setScalar(n.haloCurrent);
        n.scaleCurrent += (n.scaleTarget - n.scaleCurrent) * 0.2;
        n.mesh.scale.setScalar(n.scaleCurrent);
      }

      // ── Click flash ────────────────────────────────────────────────────────
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

      // ── Label rendering (hover only) ───────────────────────────────────────
      labelCtx.clearRect(0, 0, width, height);
      if (hoveredIdx !== null) {
        const n = nodes[hoveredIdx];
        const [sx, sy] = projectToScreen(n.position);
        const screenR = (n.radius * 1.4 * height) / (2 * CAM_Z * Math.tan(((FOV_DEG * Math.PI) / 180) / 2));
        labelCtx.font = '10px "IBM Plex Mono", monospace';
        labelCtx.fillStyle = "rgba(255,255,255,0.85)";
        labelCtx.fillText(n.title, sx + screenR + 6, sy + 3);
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
