"use client";
// Stat-wall count-up: animates 0 → value once, when scrolled into view. Uses motion's imperative
// animate(); honors prefers-reduced-motion (snaps to final). Formats int vs usd client-side so the
// server can pass raw numbers.
import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

const fmt = (n: number, format: "int" | "usd") =>
  format === "usd"
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString("en-US");

export function CountUp({
  value, format = "int", duration = 1.1, className, style,
}: { value: number; format?: "int" | "usd"; duration?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) { setDisplay(value); return; }
    const controls = animate(0, value, { duration, ease: [0.2, 0, 0, 1], onUpdate: setDisplay });
    return () => controls.stop();
  }, [inView, value, reduce, duration]);

  return <span ref={ref} className={className} style={style}>{fmt(display, format)}</span>;
}
