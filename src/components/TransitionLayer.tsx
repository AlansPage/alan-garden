"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

interface TransitionContextValue {
  navigateWithZoom: (href: string, x: number, y: number) => void;
  isTransitioning: boolean;
}

const TransitionContext = createContext<TransitionContextValue>({
  navigateWithZoom: () => {},
  isTransitioning: false,
});

type OverlayPhase = "idle" | "expanding" | "fading";

interface OverlayState {
  phase: OverlayPhase;
  x: number;
  y: number;
}

export function TransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<OverlayState>({
    phase: "idle",
    x: 0,
    y: 0,
  });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const dispatchDim = (dim: boolean) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("creature-dim", { detail: dim }));
  };

  const navigateWithZoom = useCallback(
    (href: string, x: number, y: number) => {
      clearTimers();
      dispatchDim(true);

      // Start expanding from click point
      setOverlay({ phase: "expanding", x, y });

      // After 500ms fire navigation
      const t1 = setTimeout(() => {
        router.push(href);
      }, 500);

      // After 600ms start fading out
      const t2 = setTimeout(() => {
        setOverlay((prev) => ({ ...prev, phase: "fading" }));
      }, 600);

      // After 900ms reset to idle
      const t3 = setTimeout(() => {
        setOverlay({ phase: "idle", x: 0, y: 0 });
        dispatchDim(false);
      }, 900);

      timersRef.current = [t1, t2, t3];
    },
    [router]
  );

  // Compute overlay styles based on phase
  const isIdle = overlay.phase === "idle";
  const isExpanding = overlay.phase === "expanding";
  const isFading = overlay.phase === "fading";

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "#000000",
    pointerEvents: isIdle ? "none" : "all",
    opacity: isExpanding ? 1 : isFading ? 0 : 0,
    clipPath: isExpanding
      ? `circle(200vmax at ${overlay.x}px ${overlay.y}px)`
      : isFading
      ? `circle(200vmax at ${overlay.x}px ${overlay.y}px)`
      : `circle(0px at ${overlay.x}px ${overlay.y}px)`,
    transition: isExpanding
      ? "clip-path 420ms cubic-bezier(0.4,0,0.2,1), opacity 420ms ease"
      : isFading
      ? "opacity 300ms ease"
      : "none",
  };

  return (
    <TransitionContext.Provider
      value={{ navigateWithZoom, isTransitioning: !isIdle }}
    >
      {children}
      <div style={overlayStyle} aria-hidden="true" />
    </TransitionContext.Provider>
  );
}

export function useZoomNavigate() {
  const ctx = useContext(TransitionContext);
  return useCallback(
    (href: string, e: React.MouseEvent) => {
      ctx.navigateWithZoom(href, e.clientX, e.clientY);
    },
    [ctx]
  );
}
