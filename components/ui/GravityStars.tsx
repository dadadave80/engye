"use client";
// Adapted from animate-ui @animate-ui/components-backgrounds-gravity-stars (canvas + rAF; its
// listed `motion` dep is unused). Changes for use as a hero backdrop: pointer-events:none +
// window-level mouse tracking (so buttons under it stay clickable), ENGYE `color` prop, and a
// prefers-reduced-motion guard that renders a static star field instead of animating.
import * as React from "react";

type Particle = { x: number; y: number; vx: number; vy: number; size: number; opacity: number; baseOpacity: number; mass: number; glow: number };

export function GravityStars({
  color = "var(--gold)", starsCount = 70, starsSize = 2, starsOpacity = 0.5,
  glowIntensity = 12, movementSpeed = 0.25, mouseInfluence = 140, gravityStrength = 70,
  className, style,
}: {
  color?: string; starsCount?: number; starsSize?: number; starsOpacity?: number;
  glowIntensity?: number; movementSpeed?: number; mouseInfluence?: number; gravityStrength?: number;
  className?: string; style?: React.CSSProperties;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const starsRef = React.useRef<Particle[]>([]);
  const mouseRef = React.useRef({ x: -9999, y: -9999 });
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      w = rect.width; h = rect.height;
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      if (starsRef.current.length === 0) {
        starsRef.current = Array.from({ length: starsCount }, () => {
          const a = Math.random() * Math.PI * 2;
          const s = movementSpeed * (0.5 + Math.random() * 0.5);
          return { x: Math.random() * w, y: Math.random() * h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: Math.random() * starsSize + 1, opacity: starsOpacity, baseOpacity: starsOpacity, mass: Math.random() * 0.5 + 0.5, glow: 1 };
        });
      } else {
        starsRef.current.forEach((p) => { p.x = Math.random() * w; p.y = Math.random() * h; });
      }
    };
    resize();

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of starsRef.current) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = glowIntensity * p.glow * 2;
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x * dpr, p.y * dpr, p.size * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    if (reduce) { draw(); return; } // static field, no animation

    const tick = () => {
      const m = mouseRef.current;
      for (const p of starsRef.current) {
        const dx = m.x - p.x, dy = m.y - p.y, dist = Math.hypot(dx, dy);
        if (dist < mouseInfluence && dist > 0) {
          const force = (mouseInfluence - dist) / mouseInfluence;
          p.vx += (dx / dist) * force * (gravityStrength * 0.001);
          p.vy += (dy / dist) * force * (gravityStrength * 0.001);
          p.opacity = Math.min(1, p.baseOpacity + force * 0.4);
          p.glow += (1 + force * 2 - p.glow) * 0.15;
        } else {
          p.opacity = Math.max(p.baseOpacity * 0.35, p.opacity - 0.02);
          p.glow = Math.max(1, p.glow + (1 - p.glow) * 0.08);
        }
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.999; p.vy *= 0.999;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("resize", resize);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", resize);
    };
  }, [color, starsCount, starsSize, starsOpacity, glowIntensity, movementSpeed, mouseInfluence, gravityStrength]);

  return (
    <div ref={wrapRef} aria-hidden="true" className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", ...style }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
