"use client";
// Two client islands for the otherwise server-rendered landing:
//  · LiveBond — the hero card, cycling through REAL recent bonds (task/amount/ĉ/provider/verdict/tx).
//  · Reveals  — IntersectionObserver scroll reveals + seal stamps + the slash-scene orchestration,
//    ported from the design's landing.js (no animation libraries). Renders nothing.
import { useEffect, useRef, useState } from "react";

const ARCSCAN = "https://testnet.arcscan.app";

export interface LiveBondItem {
  task: string;
  amt: string;        // formatted bond, e.g. "0.004"
  conf: string;       // "0.90"
  provider: string;
  tx: string | null;
  verdict: "PASS" | "SLASHED" | "OPEN";
}

const trunc = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function LiveBond({ bonds, floor }: { bonds: LiveBondItem[]; floor: string }) {
  const [idx, setIdx] = useState(0);
  const [swap, setSwap] = useState(false);
  useEffect(() => {
    if (bonds.length < 2) return;
    const t = setInterval(() => {
      setSwap(true);
      setTimeout(() => { setIdx((i) => (i + 1) % bonds.length); setSwap(false); }, 260);
    }, 4200);
    return () => clearInterval(t);
  }, [bonds.length]);

  if (!bonds.length) return null;
  const b = bonds[idx];
  const ok = b.verdict === "PASS";
  const open = b.verdict === "OPEN";

  return (
    <aside className="bond-live" aria-label="A live bond on Arc testnet">
      <div className={`bond-card${swap ? " swap" : ""}`}>
        <div className="bond-head">
          <span className="live-dot" aria-hidden="true" />
          <span className="bond-title">LIVE BOND</span>
          <span className="bond-net">ARC TESTNET</span>
        </div>
        <div className="bond-task mono">{b.task}</div>
        <div className="bond-stake">
          <span className="bond-stake-label">at stake</span>
          <span className="bond-amt mono">
            <svg className="obol obol--tick" viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg>
            {b.amt} <span className="unit">USDC</span>
          </span>
        </div>
        <dl className="bond-meta mono">
          <div><dt>broker ĉ</dt><dd>{b.conf}</dd></div>
          <div><dt>provider</dt><dd>{b.provider}</dd></div>
          <div><dt>verdict</dt><dd style={{ color: open ? "var(--ink-faint)" : ok ? "var(--verdigris-deep)" : "var(--cinnabar)" }}>{open ? "open" : ok ? "validated" : "slashed"}</dd></div>
        </dl>
        {b.tx
          ? <a className="tx mono" href={`${ARCSCAN}/tx/${b.tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">tx {trunc(b.tx)} ↗</a>
          : <span className="tx mono" style={{ opacity: 0.6 }}>awaiting tx…</span>}
        {!open && (
          <span key={idx} className={`seal ${ok ? "seal--ok" : "seal--slash"} bond-seal stamped`} aria-hidden="true">
            {ok ? "VALIDATED" : "SLASHED"}
          </span>
        )}
      </div>
      <p className="floor-strip mono">{floor}</p>
    </aside>
  );
}

export function Reveals() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasIO = "IntersectionObserver" in window;

    const addAll = (sel: string, cls: string) => document.querySelectorAll(sel).forEach((el) => el.classList.add(cls));
    const observe = (sel: string, cls: string, threshold: number) => {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } });
      }, { threshold });
      document.querySelectorAll(sel).forEach((el) => io.observe(el));
    };

    if (RM || !hasIO) { addAll("[data-reveal]", "in"); addAll("[data-stamp]", "stamped"); }
    else { observe("[data-reveal]", "in", 0.2); observe("[data-stamp]", "stamped", 0.6); }

    // the slash scene: play on reveal (or immediately under RM), replayable
    const scene = document.getElementById("slashScene");
    if (scene) {
      const amtEl = document.getElementById("compAmt");
      const from = Number(amtEl?.dataset.from ?? "0"), to = Number(amtEl?.dataset.to ?? "0");
      let timers: ReturnType<typeof setTimeout>[] = [];
      const count = () => {
        if (!amtEl) return;
        const dur = 900, t0 = performance.now();
        const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); amtEl.textContent = (from + (to - from) * p).toFixed(4); if (p < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      };
      const play = () => {
        timers.forEach(clearTimeout); timers = [];
        scene.classList.remove("play");
        if (RM) { if (amtEl) amtEl.textContent = to.toFixed(4); scene.classList.add("play"); return; }
        if (amtEl) amtEl.textContent = from.toFixed(4);
        void scene.offsetWidth; // reflow so animations restart
        scene.classList.add("play");
        timers.push(setTimeout(count, 1600));
        timers.push(setTimeout(() => { if (amtEl) amtEl.textContent = to.toFixed(4); }, 2620));
      };
      if (RM || !hasIO) play();
      else {
        const io = new IntersectionObserver((entries) => { entries.forEach((e) => { if (e.isIntersecting) { play(); io.unobserve(scene); } }); }, { threshold: 0.45 });
        io.observe(scene);
      }
      document.getElementById("replayBtn")?.addEventListener("click", play);
    }
  }, []);
  return null;
}
