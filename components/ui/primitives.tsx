// ENGYE core components — ported verbatim from the ENGYE Design System ("The Agora").
// Flat surfaces, 6px radius, 1px 14% borders, no shadows (stele = inset double-rule),
// hover = color only, Geist Mono + tabular-nums for data, Lucide icons only.
import type { CSSProperties, ReactNode } from "react";
import { BadgeCheck, BadgeX, Landmark, ExternalLink, type LucideIcon } from "lucide-react";
import { CopyButton } from "./CopyButton";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

/* ---------- Eyebrow ---------- */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span className="eyebrow" style={style}>{children}</span>;
}

/* ---------- Card (stele = double top rule via inset shadow, squared top corners) ---------- */
export function Card({
  stele = false, padding = 16, children, style,
}: { stele?: boolean; padding?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: "var(--card)", color: "var(--card-foreground)",
      border: "1px solid var(--border)", borderRadius: "var(--radius)", padding,
      ...(stele ? {
        borderTop: "1px solid var(--foreground)",
        boxShadow: "inset 0 3px 0 -2px var(--foreground)",
        borderTopLeftRadius: 0, borderTopRightRadius: 0,
      } : {}),
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ---------- Badge (icon + color always paired — color-blind safe) ---------- */
type Status = "PASS" | "SLASHED" | "OPEN";
const STATUS: Record<Status, { icon: LucideIcon; bg: string; fg: string }> = {
  PASS: { icon: BadgeCheck, bg: "color-mix(in oklab, var(--laurel) 20%, transparent)", fg: "var(--laurel-badge)" },
  SLASHED: { icon: BadgeX, bg: "color-mix(in oklab, var(--oxblood) 20%, transparent)", fg: "var(--oxblood-badge)" },
  OPEN: { icon: Landmark, bg: "color-mix(in oklab, var(--gold) 20%, transparent)", fg: "var(--gold-lifted)" },
};
export function Badge({ status = "OPEN", label }: { status?: Status; label?: string }) {
  const spec = STATUS[status] ?? STATUS.OPEN;
  const I = spec.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px",
      borderRadius: "var(--radius)", background: spec.bg, color: spec.fg,
      fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600,
      letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: "18px",
    }}>
      <I size={13} strokeWidth={2.25} />
      {label ?? status}
    </span>
  );
}

/* ---------- StatCard (stele Card, eyebrow-style label, tabular value) ---------- */
const TONES: Record<string, string> = {
  default: "var(--foreground)", gold: "var(--ring)", oxblood: "var(--destructive)", laurel: "var(--success)",
};
export function StatCard({
  label, value, unit, tone = "default", caption,
}: { label: string; value: string; unit?: string; tone?: string; caption?: string }) {
  return (
    <Card stele padding={20}>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)", marginBottom: 10 }}>{label}</div>
      <div style={{ ...mono, fontSize: 32, fontWeight: 500, lineHeight: 1.1, color: TONES[tone] ?? TONES.default, display: "flex", alignItems: "baseline", gap: 6 }}>
        {value}
        {unit && <span style={{ fontSize: 14, color: "var(--muted-foreground)", fontWeight: 400 }}>{unit}</span>}
      </div>
      {caption && <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 8 }}>{caption}</div>}
    </Card>
  );
}

/* ---------- LivePill (only rounded-full + only pulse in the product) ---------- */
export function LivePill({ count = 0, label = "settled" }: { count?: number; label?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 999,
      border: "1px solid var(--border)", ...mono, fontSize: 12, color: "var(--foreground)",
    }}>
      <span style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--success)", animation: "engye-live-pulse 2s var(--ease) infinite" }} />
      </span>
      live · {count.toLocaleString()} {label}
    </span>
  );
}

/* ---------- AddressChip (middle-truncate + copy + Arcscan link) ---------- */
const truncate = (a = "") => (a.length > 13 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export function AddressChip({ address = "", href }: { address?: string; href?: string }) {
  const btn: CSSProperties = { display: "inline-flex", alignItems: "center", padding: 3, background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", borderRadius: 3 };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, ...mono, fontSize: 13, color: "var(--foreground)", whiteSpace: "nowrap" }}>
      <span title={address}>{truncate(address)}</span>
      <CopyButton text={address} style={btn} />
      {href && (
        <a href={href} target="_blank" rel="noreferrer" title="View on Arcscan" style={{ ...btn, color: "var(--link)" }}>
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}

/* ---------- EmptyState (single-stroke amphora + directive line + actions) ---------- */
export function EmptyState({
  title = "The agora is quiet.", description = "Run the demand agent or register a provider.", children,
}: { title?: string; description?: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 24px", textAlign: "center", color: "var(--muted-foreground)", fontFamily: "var(--font-body)" }}>
      <svg viewBox="0 0 48 64" width="40" height="53" aria-hidden="true" style={{ color: "var(--muted-foreground)" }}>
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 17 6 H 31" />
          <path d="M 19 6 V 12 C 19 15 15 17 15 22 C 15 34 12 38 12 44 C 12 53 17 58 24 58 C 31 58 36 53 36 44 C 36 38 33 34 33 22 C 33 17 29 15 29 12 V 6" />
          <path d="M 19 12 C 12 13 9 17 10 21 C 10.8 24 13 25 15 24.5" />
          <path d="M 29 12 C 36 13 39 17 38 21 C 37.2 24 35 25 33 24.5" />
          <path d="M 18 58 H 30" />
        </g>
      </svg>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--foreground)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>{description}</div>
      </div>
      {children && <div style={{ display: "flex", gap: 12, marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export { Button } from "./Button";
export { Input } from "./Input";
