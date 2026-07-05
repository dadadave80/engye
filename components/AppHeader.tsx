"use client";
// The canonical site header (obol wordmark + primary nav + Connect + mobile hamburger). Used in
// AppShell (in-flow on app pages) and in LandingHeader (fixed, scroll-revealed on the landing).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { LivePill } from "./ui/primitives";
import { ConnectButton } from "./wallet/ConnectButton";

const NAV = [
  { label: "Hire", href: "/hire" },
  { label: "Agora", href: "/agora" },
  { label: "Post a Task", href: "/post" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Providers", href: "/providers" },
  { label: "Stake", href: "/stake" },
  { label: "Calibration", href: "/calibration" },
  { label: "Account", href: "/account" },
];

export function AppHeader({ settled }: { settled?: number }) {
  const pathname = usePathname();
  const [count, setCount] = useState(settled ?? 0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (settled !== undefined) return; // server page supplied it
    fetch("/api/status").then((r) => r.json()).then((s) => setCount(s?.totals?.matchesSettled ?? 0)).catch(() => {});
  }, [settled]);
  useEffect(() => { setMenuOpen(false); }, [pathname]); // close the mobile menu on navigation
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  return (
    <header className="container" style={{ minHeight: 56, display: "flex", alignItems: "center", gap: "clamp(10px, 3vw, 32px)", position: "relative" }}>
      <Link href="/" className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit", flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/obol-mark.svg" width={24} height={24} alt="" />
        <span className="r-hide-xs" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.12em" }}>ENGYE</span>
      </Link>
      <nav className="nav-desktop" aria-label="Primary" style={{ flex: 1 }}>
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className="focus-ring" aria-current={active ? "page" : undefined} style={{
              padding: "8px 12px", borderRadius: "var(--radius)", textDecoration: "none", fontSize: 14,
              fontWeight: active ? 600 : 400,
              color: active ? "var(--foreground)" : "var(--muted-foreground)",
              background: active ? "var(--secondary)" : "transparent",
              transition: "color var(--dur) var(--ease), background-color var(--dur) var(--ease)",
            }}>{item.label}</Link>
          );
        })}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: "auto" }}>
        <span className="r-hide-sm"><LivePill count={settled ?? count} /></span>
        <ConnectButton />
        <button type="button" className="nav-hamburger focus-ring"
          aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="mobile-nav"
          onClick={() => setMenuOpen((o) => !o)}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", flexShrink: 0 }}>
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="nav-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <nav id="mobile-nav" className="nav-panel" aria-label="Primary">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} className="focus-ring" aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", minHeight: 44, padding: "10px 12px",
                    borderRadius: "var(--radius)", textDecoration: "none", fontSize: 15,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--foreground)" : "var(--muted-foreground)",
                    background: active ? "var(--secondary)" : "transparent",
                  }}>{item.label}</Link>
              );
            })}
          </nav>
        </>
      )}
    </header>
  );
}
