"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const PIXEL = 5; // Each "pixel" is 5x5 real pixels for chunky retro look
const CREATURE_RADIUS = 72;   // fills ~70% of viewport height
const CORE_RADIUS = 14;       // core stays tight — the moat needs to dominate
const MOAT_WIDTH = 18;        // deep, wide darkness between core and shell
const SPIKE_COUNT = 9;

// ── Color palette (JRPG crystal orb) ──────────────────────────────────────────

const COL_OUTER_DARK = "#0a1a55";
const COL_OUTER_MID = "#1144cc";
const COL_OUTER_BRIGHT = "#3377ff";
const COL_OUTER_TIP = "#66aaff";
const COL_SHELL_HIGHLIGHT = "#cce8ff";

const COL_CORE_WHITE = "#ffffff";
const COL_CORE_YELLOW = "#ffdd44";
const COL_CORE_ORANGE = "#ff6600";
const COL_CORE_RED = "#dd1100";
const COL_CORE_DARK_RED = "#880000";

const COL_STREAM_CYAN = "#00ccff";
const COL_STREAM_AMBER = "#ffaa00";
const COL_STREAM_RED = "#ff2800";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 0xff, ((v >> 8) & 0xff), (v & 0xff)];
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// Simple seeded pseudo-random for deterministic pixel patterns
function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
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

// ── Stream particle type ──────────────────────────────────────────────────────

interface StreamParticle {
  alive: boolean;
  t: number;
  originX: number;
  originY: number;
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

    // ── Dynamic state ─────────────────────────────────────────────────────────

    let feedActive = false;
    let coreBrightness = 1.0;
    let coreBrightnessTarget = 1.0;
    let globalAlpha = 1.0;
    let globalAlphaTarget = 1.0;

    const STREAM_COUNT = 40;
    const streamParticles: StreamParticle[] = Array.from(
      { length: STREAM_COUNT },
      () => ({ alive: false, t: 0, originX: 0, originY: 0 })
    );

    // ── Pre-compute pixel data for creature shape ─────────────────────────────
    // We generate a lookup of which pixels belong to the creature and their
    // color/alpha, then render them each frame with slight animation.

    interface CreaturePixel {
      gx: number; // grid x relative to center
      gy: number; // grid y relative to center
      layer: "outer" | "moat" | "core";
      baseColor: string;
      baseAlpha: number;
      seed: number;
    }

    const creaturePixels: CreaturePixel[] = [];
    const diameter = CREATURE_RADIUS * 2 + 2;

    const outerDarkRgb = hexToRgb(COL_OUTER_DARK);
    const outerMidRgb = hexToRgb(COL_OUTER_MID);
    const outerBrightRgb = hexToRgb(COL_OUTER_BRIGHT);
    const outerTipRgb = hexToRgb(COL_OUTER_TIP);
    const shellHighlightRgb = hexToRgb(COL_SHELL_HIGHLIGHT);

    const coreWhiteRgb = hexToRgb(COL_CORE_WHITE);
    const coreYellowRgb = hexToRgb(COL_CORE_YELLOW);
    const coreOrangeRgb = hexToRgb(COL_CORE_ORANGE);
    const coreRedRgb = hexToRgb(COL_CORE_RED);
    const coreDarkRedRgb = hexToRgb(COL_CORE_DARK_RED);

    for (let gy = -CREATURE_RADIUS - 1; gy <= CREATURE_RADIUS + 1; gy++) {
      for (let gx = -CREATURE_RADIUS - 1; gx <= CREATURE_RADIUS + 1; gx++) {
        const dist = Math.sqrt(gx * gx + gy * gy);
        const seed = seededRand(gx * 1000 + gy);

        // Noise-like displacement for organic edge
        const angle = Math.atan2(gy, gx);
        // Three frequency layers: large spikes + medium jagged + fine texture
        const noiseDisp =
          Math.sin(angle * SPIKE_COUNT + seed * 6.28) * 10 +
          Math.sin(angle * (SPIKE_COUNT * 2.7) + seed * 4.1) * 5 +
          Math.sin(angle * (SPIKE_COUNT * 4.5) + seed * 9.3) * 2;
        const effectiveRadius = CREATURE_RADIUS + noiseDisp;

        if (dist > effectiveRadius + 1) continue;

        const t = dist / effectiveRadius; // 0=center, 1=edge

        if (dist <= CORE_RADIUS) {
          // Core region
          const ct = dist / CORE_RADIUS;
          let col: string;
          if (ct < 0.2) {
            col = lerpColor(coreWhiteRgb, coreYellowRgb, ct / 0.2);
          } else if (ct < 0.45) {
            col = lerpColor(coreYellowRgb, coreOrangeRgb, (ct - 0.2) / 0.25);
          } else if (ct < 0.7) {
            col = lerpColor(coreOrangeRgb, coreRedRgb, (ct - 0.45) / 0.25);
          } else {
            col = lerpColor(coreRedRgb, coreDarkRedRgb, (ct - 0.7) / 0.3);
          }
          creaturePixels.push({
            gx, gy, layer: "core",
            baseColor: col,
            baseAlpha: 0.85 + seed * 0.15,
            seed,
          });
        } else if (dist <= CORE_RADIUS + MOAT_WIDTH) {
          // Moat (sparse dark zone between core and shell)
          // Aggressive spike voids — wide dark claws radiating outward
          const spikeHalf = 0.22 + ((dist - CORE_RADIUS) / MOAT_WIDTH) * 0.18;
          const withinSpike = Math.abs(
            ((angle + Math.PI) % (Math.PI * 2 / SPIKE_COUNT)) - Math.PI / SPIKE_COUNT
          ) < spikeHalf;
          if (withinSpike) continue;   // hard void — no particles in claw direction
          if (seed > 0.04) continue;   // 4% survival — near-empty moat
          creaturePixels.push({
            gx, gy, layer: "moat",
            baseColor: COL_OUTER_DARK,
            baseAlpha: 0.15 + seed * 0.1,
            seed,
          });
        } else {
          // Outer shell
          const shellT = (dist - CORE_RADIUS - MOAT_WIDTH) / (effectiveRadius - CORE_RADIUS - MOAT_WIDTH);
          let col: string;
          if (shellT > 0.85) {
            col = lerpColor(outerTipRgb, shellHighlightRgb, (shellT - 0.85) / 0.15);
          } else if (shellT > 0.6) {
            col = lerpColor(outerBrightRgb, outerTipRgb, (shellT - 0.6) / 0.25);
          } else if (shellT > 0.3) {
            col = lerpColor(outerMidRgb, outerBrightRgb, (shellT - 0.3) / 0.3);
          } else {
            col = lerpColor(outerDarkRgb, outerMidRgb, shellT / 0.3);
          }

          // Sparkle stars - some brighter pixels
          const isStar = seed > 0.92;
          const alpha = isStar
            ? 0.6 + seed * 0.35
            : 0.2 + shellT * 0.5 + seed * 0.15;

          // Edge fade for anti-aliased-ish look (pixelated but not harsh cutoff)
          const edgeFade = dist > effectiveRadius ? Math.max(0, 1 - (dist - effectiveRadius)) : 1;

          creaturePixels.push({
            gx, gy, layer: "outer",
            baseColor: col,
            baseAlpha: Math.min(1, alpha) * edgeFade,
            seed,
          });
        }
      }
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    const onStartFeeding = () => {
      feedActive = true;
      coreBrightnessTarget = 1.4;
    };

    const onStopFeeding = () => {
      feedActive = false;
      coreBrightnessTarget = 1.0;
      for (const p of streamParticles) {
        p.alive = false;
      }
    };

    const handleDim = (e: Event) => {
      const dim = (e as CustomEvent<boolean>).detail;
      globalAlphaTarget = dim ? 0.12 : 1.0;
    };

    window.addEventListener("creature-start-feeding", onStartFeeding);
    window.addEventListener("creature-stop-feeding", onStopFeeding);
    window.addEventListener("creature-dim", handleDim);

    // ── Animation loop ────────────────────────────────────────────────────────

    let time = 0;

    function animate() {
      time += 0.016;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      // Slow breathing
      const breathe = 1.0 + Math.sin(time * 0.32) * 0.04;

      // Core brightness
      const bLerp = coreBrightness < coreBrightnessTarget ? 0.05 : 0.015;
      coreBrightness += (coreBrightnessTarget - coreBrightness) * bLerp;

      // Global alpha
      const aLerp = globalAlphaTarget < globalAlpha ? 0.05 : 0.04;
      globalAlpha += (globalAlphaTarget - globalAlpha) * aLerp;

      // Center of creature
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);

      // Slow rotation effect via shifting pixel selection
      const rotAngle = time * 0.08;

      // ── Dark corruption aura ─────────────────────────────────────────────
      // Pulsing black-purple shadow — drawn under everything
      const auraSize = CREATURE_RADIUS * PIXEL * (2.2 + Math.sin(time * 0.6) * 0.15);
      const auraGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraSize);
      auraGrad.addColorStop(0,    "rgba(0,0,0,0)");
      auraGrad.addColorStop(0.35, "rgba(0,0,0,0)");
      auraGrad.addColorStop(0.55, "rgba(20,0,40,0.35)");   // deep violet
      auraGrad.addColorStop(0.72, "rgba(40,0,20,0.55)");   // dark crimson
      auraGrad.addColorStop(0.85, "rgba(10,0,10,0.7)");
      auraGrad.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.globalAlpha = globalAlpha;
      ctx.fillStyle = auraGrad;
      ctx.fillRect(cx - auraSize, cy - auraSize, auraSize * 2, auraSize * 2);

      ctx.globalAlpha = globalAlpha;

      // ── Draw creature pixels ──────────────────────────────────────────────

      for (const px of creaturePixels) {
        // Spike layer gets independent radial writhe
        // Each outer pixel pulses based on its angle + seed — organic claw motion
        let scale = breathe;
        if (px.layer === "outer") {
          const pxAngle = Math.atan2(px.gy, px.gx);
          const writhe = 1.0 + Math.sin(time * 1.8 + pxAngle * SPIKE_COUNT * 0.5 + px.seed * 12) * 0.04;
          scale = breathe * writhe;
        }
        const sx = px.gx * scale;
        const sy = px.gy * scale;

        // Apply subtle rotation
        const cos = Math.cos(rotAngle);
        const sin = Math.sin(rotAngle);
        const rx = sx * cos - sy * sin;
        const ry = sx * sin + sy * cos;

        // Snap to pixel grid for that crunchy retro look
        const drawX = cx + Math.round(rx) * PIXEL;
        const drawY = cy + Math.round(ry) * PIXEL;

        // Twinkle effect for stars
        let alpha = px.baseAlpha;
        if (px.layer === "outer" && px.seed > 0.88) {
          alpha *= 0.6 + 0.4 * Math.sin(time * 2.5 + px.seed * 50);
        }

        // Core brightness boost
        if (px.layer === "core") {
          alpha = Math.min(1, alpha * coreBrightness);
        }

        ctx.globalAlpha = globalAlpha * alpha;
        ctx.fillStyle = px.baseColor;
        ctx.fillRect(drawX, drawY, PIXEL, PIXEL);
      }

      // ── Core glow (simple radial) ──────────────────────────────────────────

      ctx.globalAlpha = globalAlpha * 0.3 * coreBrightness;
      const glowSize = CORE_RADIUS * PIXEL * 2.5 * breathe;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
      gradient.addColorStop(0, "rgba(255,240,120,0.8)");
      gradient.addColorStop(0.3, "rgba(255,120,10,0.4)");
      gradient.addColorStop(0.6, "rgba(200,20,0,0.15)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(cx - glowSize, cy - glowSize, glowSize * 2, glowSize * 2);

      // ── Outer glow haze ────────────────────────────────────────────────────

      ctx.globalAlpha = globalAlpha * 0.12;
      const outerGlow = CREATURE_RADIUS * PIXEL * 1.8 * breathe;
      const outerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerGlow);
      outerGrad.addColorStop(0, "rgba(51,119,255,0.3)");
      outerGrad.addColorStop(0.5, "rgba(10,26,85,0.15)");
      outerGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = outerGrad;
      ctx.fillRect(cx - outerGlow, cy - outerGlow, outerGlow * 2, outerGlow * 2);

      // ── Feed stream particles ──────────────────────────────────────────────

      if (feedActive) {
        let emitted = 0;
        for (const p of streamParticles) {
          if (!p.alive && emitted < 2) {
            p.alive = true;
            p.t = 0;
            p.originX = cx + (Math.random() - 0.5) * 120;
            p.originY = cy - height * 0.35;
            emitted++;
          }
        }
      }

      const streamCyanRgb = hexToRgb(COL_STREAM_CYAN);
      const streamAmberRgb = hexToRgb(COL_STREAM_AMBER);
      const streamRedRgb = hexToRgb(COL_STREAM_RED);

      for (const p of streamParticles) {
        if (!p.alive) continue;
        p.t += 0.008 + Math.random() * 0.003;
        if (p.t >= 1.0) {
          p.alive = false;
          continue;
        }

        const px = p.originX * (1 - p.t) + cx * p.t + Math.sin(p.t * Math.PI * 3) * 8;
        const py = p.originY * (1 - p.t) + cy * p.t;

        let col: string;
        if (p.t < 0.3) col = lerpColor(streamCyanRgb, streamAmberRgb, p.t / 0.3);
        else if (p.t < 0.7) col = lerpColor(streamAmberRgb, streamRedRgb, (p.t - 0.3) / 0.4);
        else col = `rgb(${streamRedRgb[0]},${streamRedRgb[1]},${streamRedRgb[2]})`;

        const fadeIn = Math.min(1, p.t / 0.1);
        const fadeOut = Math.max(0, 1 - Math.max(0, (p.t - 0.8) / 0.2));

        ctx.globalAlpha = globalAlpha * 0.7 * fadeIn * fadeOut;
        ctx.fillStyle = col;
        // Stream particles are also pixelated
        const spx = Math.round(px / PIXEL) * PIXEL;
        const spy = Math.round(py / PIXEL) * PIXEL;
        ctx.fillRect(spx, spy, PIXEL * 2, PIXEL * 2);
      }

      ctx.globalAlpha = 1;
      animFrameRef.current = window.requestAnimationFrame(animate);
    }

    animFrameRef.current = window.requestAnimationFrame(animate);

    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("creature-start-feeding", onStartFeeding);
      window.removeEventListener("creature-stop-feeding", onStopFeeding);
      window.removeEventListener("creature-dim", handleDim);
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
        imageRendering: "pixelated",
      }}
    />
  );
});

export default CreatureCanvas;
