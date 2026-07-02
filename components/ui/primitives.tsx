// ENGYE core components (ported from the ENGYE Design System, "The Agora").
// Rules honored: flat surfaces, 6px radius, 1px 14% borders, no shadows, hover = color only,
// Geist Mono + tabular-nums for all data, Lucide icons only, stele rule on stat cards.
import type { CSSProperties, ReactNode } from "react";
import {
  BadgeCheck, BadgeX, Landmark, Copy, Check, ExternalLink,
  type LucideIcon,
} from "lucide-react";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

/* ---------- Eyebrow ---------- */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span className="eyebrow" style={style}>{children}</span>;
}

/* ---------- Card ---------- */
export function Card({
  children, padding = 16, stele = false, style, className,
}: { children: ReactNode; padding?: number; stele?: boolean; style?: CSSProperties; className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: "var(--card)", color: "var(--card-foreground)",
        border: "1px solid var(--border)", borderRadius: "var(--radius)",
        padding, ...(stele ? { borderTop: "none" } : {}), ...style,
      }}
    >
      {stele ? <div className="stele" style={{ margin: `-${padding}px -${padding}px ${padding}px`, padding: `${padding}px ${padding}px 0`, color: "var(--border)" }}><div style={{ color: "var(--card-foreground)" }}>{children}</div></div> : children}
    </div>
  );
}

/* ---------- Button ---------- */
type BtnVariant = "primary" | "outline" | "ghost";
type BtnSize = "sm" | "md" | "lg";
const SIZES: Record<BtnSize, CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 13 },
  md: { padding: "9px 16px", fontSize: 14 },
  lg: { padding: "13px 24px", fontSize: 16 },
};
export function Button({
  children, variant = "primary", size = "md", style, ...rest
}: { children: ReactNode; variant?: BtnVariant; size?: BtnSize } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<BtnVariant, CSSProperties> = {
    primary: { background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid var(--primary)" },
    outline: { background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)" },
    ghost: { background: "transparent", color: "var(--foreground)", border: "1px solid transparent" },
  };
  return (
    <button
      style={{
        ...SIZES[size], ...variants[variant],
        borderRadius: "var(--radius)", fontFamily: "var(--font-body)", fontWeight: 500,
        cursor: "pointer", transition: "background-color var(--dur) var(--ease), color var(--dur) var(--ease)",
        display: "inline-flex", alignItems: "center", gap: 8, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Badge (status: PASS / SLASHED / OPEN — icon + color always paired) ---------- */
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

/* ---------- StatCard (stele top rule, tabular value, tone) ---------- */
const TONES: Record<string, string> = {
  default: "var(--foreground)", gold: "var(--ring)", oxblood: "var(--destructive)", laurel: "var(--success)",
};
export function StatCard({
  label, value, unit, tone = "default", caption,
}: { label: string; value: string; unit?: string; tone?: keyof typeof TONES | string; caption?: string }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 20 }}>
      <div className="stele" style={{ color: "var(--border)", marginBottom: 10, paddingTop: 10 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)" }}>{label}</div>
      </div>
      <div style={{ ...mono, fontSize: 32, fontWeight: 500, lineHeight: 1.1, color: TONES[tone] ?? TONES.default, display: "flex", alignItems: "baseline", gap: 6 }}>
        {value}
        {unit && <span style={{ fontSize: 14, color: "var(--muted-foreground)", fontWeight: 400 }}>{unit}</span>}
      </div>
      {caption && <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 8 }}>{caption}</div>}
    </div>
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

/* ---------- EmptyState (amphora) ---------- */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 24px", color: "var(--muted-foreground)", textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/amphora.svg" alt="" width={40} height={54} style={{ opacity: 0.5 }} />
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--foreground)" }}>{title}</div>
      {hint && <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

// CopyButton is a client island (below) — imported lazily to keep this file server-safe.
import { CopyButton } from "./CopyButton";
export { Check, Copy };
