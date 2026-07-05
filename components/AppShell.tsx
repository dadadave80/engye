"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
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

export function AppShell({ settled, children }: { settled?: number; children: ReactNode }) {
  const pathname = usePathname();
  const [count, setCount] = useState(settled ?? 0);
  useEffect(() => {
    if (settled !== undefined) return; // server page supplied it
    fetch("/api/status").then((r) => r.json()).then((s) => setCount(s?.totals?.matchesSettled ?? 0)).catch(() => {});
  }, [settled]);
  return (
    <div className="dark" style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-body)", colorScheme: "dark" }}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="container" style={{ minHeight: 56, display: "flex", alignItems: "center", gap: "clamp(10px, 3vw, 32px)" }}>
        <Link href="/" className="focus-ring" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/obol-mark.svg" width={24} height={24} alt="" />
          <span className="r-hide-xs" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.12em" }}>ENGYE</span>
        </Link>
        <nav className="r-nav" style={{ flex: 1 }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span className="r-hide-sm"><LivePill count={settled ?? count} /></span>
          <ConnectButton />
        </div>
      </header>
      <div className="meander-hairline" />
      <main id="main-content" tabIndex={-1} className="container" style={{ paddingBlock: 24, outline: "none" }}>{children}</main>
    </div>
  );
}
