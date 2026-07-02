"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LivePill } from "./ui/primitives";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Providers", href: "/providers" },
  { label: "Calibration", href: "/calibration" },
];

export function AppShell({ settled, children }: { settled: number; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="dark" style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-body)" }}>
      <header style={{ height: 56, display: "flex", alignItems: "center", gap: 32, padding: "0 24px", maxWidth: 1280, margin: "0 auto", boxSizing: "border-box" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/obol-mark.svg" width={24} height={24} alt="" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.12em" }}>ENGYE</span>
        </Link>
        <nav style={{ display: "flex", gap: 4, flex: 1 }}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} style={{
                padding: "8px 12px", borderRadius: "var(--radius)", textDecoration: "none", fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--foreground)" : "var(--muted-foreground)",
                background: active ? "var(--secondary)" : "transparent",
                transition: "color var(--dur) var(--ease), background-color var(--dur) var(--ease)",
              }}>{item.label}</Link>
            );
          })}
        </nav>
        <LivePill count={settled} />
      </header>
      <div className="meander-hairline" />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: 24, boxSizing: "border-box" }}>{children}</main>
    </div>
  );
}
