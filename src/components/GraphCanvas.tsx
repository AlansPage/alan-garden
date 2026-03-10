"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { GraphData } from "@/lib/vault";

// ── Helpers ───────────────────────────────────────────────────────────────────

function gauss(sigma: number): number {
  let u = 0, v = 0;
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

function nodeColor(status: string, type: string, tags: string[]): string {
  if (type === "essay") return "#E8FF00";
  if (tags.length > 0) {
    const tag = tags[0];
    const hash = tag.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return TAG_COLORS[hash % TAG_COLORS.length];
  }
  return STATUS_COLORS[status] ?? "#5B6FD4";
}

function nodeRadius(backlinkCount: number): number {
  if (backlinkCount === 0) return 3;
  if (backlinkCount <= 2) return 5;
  if (backlinkCount <= 5) return 9;
  if (backlinkCount <= 10) return 14;
  return 22;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 0xff, ((v >> 8) & 0xff), (v & 0xff)];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PIXEL = 3; // Pixel size for chunky retro look

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
  color: string;
  colorRgb: [number, number, number];
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  ax: number;
  ay: number;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  const onSelectRef = useRef(onSelectNode);
  useEffect(() => {
    onSelectRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const input = inputRef.current;
    if (!canvas || !input) return;

    const ctx = canvas.getContext("2d")!;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    // ── Build nodes ───────────────────────────────────────────────────────────

    const nodes: NodeVisual[] = [];
    const edgeInfos: EdgeInfo[] = [];
    const slugToIdx = new Map<string, number>();

    const connectionCount = new Map<string, number>();
    for (const e of graph.edges) {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
    }

    graph.nodes.forEach((node, i) => {
      const r = nodeRadius(node.backlinkCount);
      const col = nodeColor(node.status, node.type, node.tags);

      let x: number, y: number;
      if (node.type === "essay") {
        x = gauss(80); y = gauss(80);
      } else if (node.status === "evergreen") {
        x = gauss(180); y = gauss(180);
      } else if (node.status === "budding") {
        x = gauss(300); y = gauss(300);
      } else {
        const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const rad = 400 + Math.random() * 200;
        x = Math.cos(angle) * rad;
        y = Math.sin(angle) * rad * 0.6;
      }

      nodes.push({
        slug: node.slug,
        title: node.title,
        color: col,
        colorRgb: hexToRgb(col),
        x, y,
        prevX: x, prevY: y,
        ax: 0, ay: 0,
        radius: r,
        idx: i,
        status: node.status,
        type: node.type,
      });
      slugToIdx.set(node.slug, i);
    });

    // ── Build edges ───────────────────────────────────────────────────────────

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

    // ── Camera ────────────────────────────────────────────────────────────────

    let camX = 0, camY = 0, camZoom = 1.0;

    const worldToScreen = (wx: number, wy: number): [number, number] => [
      (wx - camX) * camZoom + width / 2,
      (wy - camY) * camZoom + height / 2,
    ];

    const screenToWorld = (sx: number, sy: number): [number, number] => [
      (sx - width / 2) / camZoom + camX,
      (sy - height / 2) / camZoom + camY,
    ];

    // ── State ─────────────────────────────────────────────────────────────────

    let hoveredIdx: number | null = null;
    let mouseX = -9999, mouseY = -9999;
    let flash: { idx: number; frame: number } | null = null;
    let time = 0;

    // Edge highlight
    const edgeHighlight = new Float32Array(edgeInfos.length).fill(0.25);

    // ── Input ─────────────────────────────────────────────────────────────────

    const onPointerMove = (e: PointerEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const onClick = (e: MouseEvent) => {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      // Find closest node within click radius
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = n.x - wx;
        const dy = n.y - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(n.radius * 1.5, 12);
        if (dist < hitR && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        flash = { idx: bestIdx, frame: 0 };
        const slug = nodes[bestIdx].slug;
        setTimeout(() => onSelectRef.current(slug), 300);
      } else {
        onSelectRef.current(null);
      }
    };

    // Pan & zoom
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let panStartCamX = 0, panStartCamY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartCamX = camX;
      panStartCamY = camY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      camX = panStartCamX - dx / camZoom;
      camY = panStartCamY - dy / camZoom;
    };

    const onMouseUp = () => { isPanning = false; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      camZoom = Math.max(0.2, Math.min(5, camZoom * factor));
    };

    input.addEventListener("pointermove", onPointerMove);
    input.addEventListener("click", onClick);
    input.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    input.addEventListener("wheel", onWheel, { passive: false });

    // ── Pixel drawing helpers ─────────────────────────────────────────────────

    const drawPixelRect = (x: number, y: number, w: number, h: number, color: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      // Snap to pixel grid
      const sx = Math.round(x / PIXEL) * PIXEL;
      const sy = Math.round(y / PIXEL) * PIXEL;
      const sw = Math.max(PIXEL, Math.round(w / PIXEL) * PIXEL);
      const sh = Math.max(PIXEL, Math.round(h / PIXEL) * PIXEL);
      ctx.fillRect(sx, sy, sw, sh);
    };

    const drawPixelCircle = (cx: number, cy: number, radius: number, color: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      const r = Math.max(1, Math.round(radius / PIXEL));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            ctx.fillRect(
              Math.round(cx / PIXEL) * PIXEL + dx * PIXEL,
              Math.round(cy / PIXEL) * PIXEL + dy * PIXEL,
              PIXEL, PIXEL
            );
          }
        }
      }
    };

    // ── Bresenham pixelated line ───────────────────────────────────────────────

    const drawPixelLine = (
      x0: number, y0: number, x1: number, y1: number,
      colSrc: [number, number, number], colTgt: [number, number, number],
      alpha: number
    ) => {
      // Snap to pixel grid
      let px0 = Math.round(x0 / PIXEL);
      let py0 = Math.round(y0 / PIXEL);
      const px1 = Math.round(x1 / PIXEL);
      const py1 = Math.round(y1 / PIXEL);

      const dx = Math.abs(px1 - px0);
      const dy = Math.abs(py1 - py0);
      const sx = px0 < px1 ? 1 : -1;
      const sy = py0 < py1 ? 1 : -1;
      let err = dx - dy;
      const totalSteps = Math.max(dx, dy);
      let step = 0;

      ctx.globalAlpha = alpha;

      while (true) {
        const t = totalSteps > 0 ? step / totalSteps : 0;
        const r = Math.round(colSrc[0] + (colTgt[0] - colSrc[0]) * t);
        const g = Math.round(colSrc[1] + (colTgt[1] - colSrc[1]) * t);
        const b = Math.round(colSrc[2] + (colTgt[2] - colSrc[2]) * t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px0 * PIXEL, py0 * PIXEL, PIXEL, PIXEL);

        if (px0 === px1 && py0 === py1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; px0 += sx; }
        if (e2 < dx) { err += dx; py0 += sy; }
        step++;
        if (step > 2000) break; // safety
      }
    };

    // ── Force simulation ──────────────────────────────────────────────────────

    const simulate = () => {
      for (const n of nodes) { n.ax = 0; n.ay = 0; }

      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = Math.max(50, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const force = 2520 / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.ax += fx; a.ay += fy;
          b.ax -= fx; b.ay -= fy;
        }
      }

      // Link attraction
      for (const e of edgeInfos) {
        const a = nodes[e.sourceIndex], b = nodes[e.targetIndex];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy));
        const force = 0.01 * (dist - 165);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.ax += fx; a.ay += fy;
        b.ax -= fx; b.ay -= fy;
      }

      // Center gravity
      for (const n of nodes) {
        n.ax -= n.x * 0.002;
        n.ay -= n.y * 0.002;
      }

      // Verlet integration
      const dt2 = 0.016 * 0.016;
      for (const n of nodes) {
        const curX = n.x, curY = n.y;
        const vx = (curX - n.prevX) * 0.9;
        const vy = (curY - n.prevY) * 0.9;
        n.x = curX + vx + n.ax * dt2;
        n.y = curY + vy + n.ay * dt2;
        // Subtle drift
        n.x += Math.sin(time * 0.3 + n.idx * 1.7) * 0.08;
        n.y += Math.cos(time * 0.25 + n.idx * 2.3) * 0.08;
        n.prevX = curX;
        n.prevY = curY;
      }
    };

    // ── Animation loop ────────────────────────────────────────────────────────

    let animId: number;

    const animate = () => {
      time += 0.016;
      simulate();

      // ── Hover detection ────────────────────────────────────────────────────
      const [wmx, wmy] = screenToWorld(mouseX, mouseY);
      let newHovered: number | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = n.x - wmx;
        const dy = n.y - wmy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(n.radius * 1.5, 12);
        if (dist < hitR && dist < bestDist) {
          bestDist = dist;
          newHovered = i;
        }
      }

      if (newHovered !== hoveredIdx) {
        hoveredIdx = newHovered;
        for (let ei = 0; ei < edgeInfos.length; ei++) {
          const e = edgeInfos[ei];
          if (hoveredIdx !== null && (e.sourceIndex === hoveredIdx || e.targetIndex === hoveredIdx)) {
            edgeHighlight[ei] = 1.0;
          } else {
            edgeHighlight[ei] = e.sharedConnections >= 3 ? 0.3 : 0.18;
          }
        }
      }

      // Flash
      if (flash) {
        flash.frame++;
        if (flash.frame >= 24) flash = null;
      }

      // ── Render ─────────────────────────────────────────────────────────────

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      // Draw edges
      for (let ei = 0; ei < edgeInfos.length; ei++) {
        const e = edgeInfos[ei];
        const src = nodes[e.sourceIndex];
        const tgt = nodes[e.targetIndex];
        const [sx, sy] = worldToScreen(src.x, src.y);
        const [tx, ty] = worldToScreen(tgt.x, tgt.y);
        drawPixelLine(sx, sy, tx, ty, src.colorRgb, tgt.colorRgb, edgeHighlight[ei] * 0.6);
      }

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const [sx, sy] = worldToScreen(n.x, n.y);
        const screenR = n.radius * camZoom;

        // Halo
        let haloAlpha = 0.15;
        let sizeMultiplier = 1.0;

        if (flash && flash.idx === i) {
          const frac = Math.min(1, flash.frame / 24);
          haloAlpha = 0.4 * (1 - frac) + 0.15 * frac;
          sizeMultiplier = 1 + (1 - frac) * 0.6;
          // Flash color: white -> base
          const r = Math.round(255 * (1 - frac) + n.colorRgb[0] * frac);
          const g = Math.round(255 * (1 - frac) + n.colorRgb[1] * frac);
          const b = Math.round(255 * (1 - frac) + n.colorRgb[2] * frac);
          drawPixelCircle(sx, sy, screenR * 2.5 * sizeMultiplier, `rgb(${r},${g},${b})`, haloAlpha);
          drawPixelCircle(sx, sy, screenR * sizeMultiplier, `rgb(${r},${g},${b})`, 0.9);
        } else if (hoveredIdx === i) {
          drawPixelCircle(sx, sy, screenR * 3.0, n.color, 0.3);
          drawPixelCircle(sx, sy, screenR * 1.4, n.color, 1.0);
        } else {
          drawPixelCircle(sx, sy, screenR * 2.0, n.color, haloAlpha);
          drawPixelCircle(sx, sy, screenR, n.color, 0.9);
        }
      }

      // Draw label on hover
      if (hoveredIdx !== null) {
        const n = nodes[hoveredIdx];
        const [sx, sy] = worldToScreen(n.x, n.y);
        const screenR = n.radius * camZoom;
        ctx.globalAlpha = 0.85;
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.fillStyle = "rgba(255,255,255,0.9)";

        // Pixelated text background
        const textWidth = ctx.measureText(n.title).width;
        const labelX = sx + screenR + 10;
        const labelY = sy + 3;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#000000";
        ctx.fillRect(labelX - 2, labelY - 10, textWidth + 4, 14);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(n.title, labelX, labelY);
      }

      // Cursor style
      input.style.cursor = hoveredIdx !== null ? "pointer" : isPanning ? "grabbing" : "grab";

      ctx.globalAlpha = 1;
      animId = window.requestAnimationFrame(animate);
    };

    animate();

    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      input.removeEventListener("pointermove", onPointerMove);
      input.removeEventListener("click", onClick);
      input.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      input.removeEventListener("wheel", onWheel);
    };
  }, [graph]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 0,
          imageRendering: "pixelated",
        }}
      />
      <div ref={inputRef} className="graph-input-layer" />
      <Link href="/" className="return-to-void">
        &larr; RETURN TO VOID
      </Link>
    </>
  );
}
