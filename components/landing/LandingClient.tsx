"use client";
// Landing choreography — vanilla behaviors ported from the handoff landing.js (no animation
// libraries): IntersectionObserver reveals, stamp-on-reveal seals, the hero live-bond cycle
// (seeded from REAL recent bonds passed in), and the orchestrated slash scene. Renders null;
// the markup is server-rendered in app/page.tsx and this drives it imperatively.
import { useEffect } from "react";

export type HeroBond = { task: string; amt: string; conf: string; prov: string; tx: string | null; out: "ok" | "slash"; comp?: string };

const ARCSCAN = "https://testnet.arcscan.app";
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const short = (tx: string) => `${tx.slice(0, 6)}…${tx.slice(-4)}`;

export function LandingClient({ bonds }: { bonds: HeroBond[] }) {
  useEffect(() => {
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const $ = (id: string) => document.getElementById(id);
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const intervals: Array<ReturnType<typeof setInterval>> = [];
    const observers: IntersectionObserver[] = [];

    // ── scroll reveals ──
    const revealed = document.querySelectorAll("[data-reveal]");
    if (RM || !("IntersectionObserver" in window)) {
      revealed.forEach((el) => el.classList.add("in"));
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
      }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });
      revealed.forEach((el) => io.observe(el));
      observers.push(io);
    }

    // ── stamp-on-reveal seals ──
    const stamps = document.querySelectorAll("[data-stamp]");
    if (!RM && "IntersectionObserver" in window) {
      const so = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("stamped"); so.unobserve(e.target); } });
      }, { threshold: 0.6 });
      stamps.forEach((el) => so.observe(el));
      observers.push(so);
    } else {
      stamps.forEach((el) => el.classList.add("stamped"));
    }

    // ── hero: live bond ticking to a verdict, then cycling through the real bonds ──
    const card = $("bondCard");
    if (card && bonds.length > 0) {
      const SECS = [9, 7, 11];
      let idx = 0, left = SECS[0], timer: ReturnType<typeof setInterval> | null = null;
      const clockEl = $("bondClock");
      const clockRow = clockEl ? (clockEl.closest("div") as HTMLElement | null) : null;

      const render = (b: HeroBond) => {
        const set = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };
        set("bondTask", b.task);
        set("bondAmt", b.amt);
        set("bondConf", b.conf);
        set("bondProv", b.prov);
        set("bondClock", fmt(left));
        const tx = $("bondTx") as HTMLAnchorElement | null;
        if (tx) { tx.textContent = b.tx ? `tx ${short(b.tx)} ↗` : "off-chain"; tx.setAttribute("href", b.tx ? `${ARCSCAN}/tx/${b.tx}` : "#"); }
        if (clockRow) clockRow.style.visibility = "visible";
        const v = $("bondVerdict"); if (v) { v.hidden = true; v.className = "bond-verdict mono"; }
        $("bondSealOk")?.classList.remove("stamped");
        $("bondSealSlash")?.classList.remove("stamped");
      };

      const settle = (b: HeroBond) => {
        if (timer) clearInterval(timer);
        if (clockRow) clockRow.style.visibility = "hidden";
        const v = $("bondVerdict");
        if (v) {
          v.hidden = false;
          if (b.out === "slash") { v.classList.add("is-slash"); v.textContent = `slashed → buyer compensated ${b.comp ?? "0.000"} USDC`; $("bondSealSlash")?.classList.add("stamped"); }
          else { v.classList.add("is-ok"); v.textContent = "validated — bond released to the broker"; $("bondSealOk")?.classList.add("stamped"); }
        }
        timers.push(setTimeout(() => {
          card.classList.add("swap");
          timers.push(setTimeout(() => {
            idx = (idx + 1) % bonds.length;
            left = SECS[idx % SECS.length];
            render(bonds[idx]);
            card.classList.remove("swap");
            start();
          }, 260));
        }, 2600));
      };

      const start = () => {
        if (RM) { settle(bonds[idx]); return; } // reduced motion: skip the tick, show the verdict
        timer = setInterval(() => {
          left -= 1;
          if (left <= 0) { settle(bonds[idx]); return; }
          const c = $("bondClock"); if (c) c.textContent = fmt(left);
        }, 1000);
        if (timer) intervals.push(timer);
      };
      render(bonds[0]);
      start();
    }

    // ── the slash scene: orchestrated once on reveal, replayable ──
    const scene = $("slashScene");
    if (scene) {
      const el = $("compAmt");
      const to = el ? Number(el.getAttribute("data-to") ?? "0.034") : 0.034;
      let compTimers: Array<ReturnType<typeof setTimeout>> = [];
      const runCounter = () => {
        if (!el) return;
        const from = 0, dur = 900, t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur);
          el.textContent = (from + (to - from) * p).toFixed(3);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      const play = () => {
        compTimers.forEach(clearTimeout); compTimers = [];
        scene.classList.remove("play");
        if (RM) { if (el) el.textContent = to.toFixed(3); scene.classList.add("play"); return; }
        if (el) el.textContent = "0.000";
        void (scene as HTMLElement).offsetWidth; // reflow so animations restart
        scene.classList.add("play");
        const a = setTimeout(runCounter, 1600); compTimers.push(a); timers.push(a);
        const b = setTimeout(() => { if (el) el.textContent = to.toFixed(3); }, 2620); compTimers.push(b); timers.push(b);
      };
      if (RM || !("IntersectionObserver" in window)) {
        play();
      } else {
        const io2 = new IntersectionObserver((entries) => {
          entries.forEach((e) => { if (e.isIntersecting) { play(); io2.unobserve(scene); } });
        }, { threshold: 0.45 });
        io2.observe(scene);
        observers.push(io2);
      }
      const btn = $("replayBtn");
      if (btn) btn.addEventListener("click", play);
    }

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      observers.forEach((o) => o.disconnect());
    };
  }, [bonds]);

  return null;
}
