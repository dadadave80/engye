"use client";
// Landing sticky header — no header while you're in the hero; once you scroll past #hero it slides
// in as the canonical AppHeader (dark bar, full-bleed background, centered content). Replaces the
// old "Live on Arc testnet" pencil bar. Reveal animation respects prefers-reduced-motion via the
// app-wide <MotionConfig reducedMotion="user">.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AppHeader } from "./AppHeader";

export function LandingHeader({ settled }: { settled?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById("hero");
      const threshold = hero ? hero.offsetTop + hero.offsetHeight - 72 : 480;
      setShown(window.scrollY > threshold);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.div
      className="dark"
      initial={false}
      animate={shown ? { y: 0, opacity: 1 } : { y: "-100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      aria-hidden={!shown}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        background: "var(--background)", color: "var(--foreground)", colorScheme: "dark",
        borderBottom: "1px solid var(--border)", boxShadow: "var(--shadow-popover)",
        pointerEvents: shown ? "auto" : "none",
      }}
    >
      <AppHeader settled={settled} />
    </motion.div>
  );
}
