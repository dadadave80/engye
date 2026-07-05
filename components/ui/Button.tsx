"use client";
import { useState, type CSSProperties, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "accent" | "destructive";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, CSSProperties> = {
  sm: { padding: "6px 14px", fontSize: 13, minHeight: 32 },
  md: { padding: "10px 20px", fontSize: 14, minHeight: 44 }, // ≥44px touch target
  lg: { padding: "14px 28px", fontSize: 16, minHeight: 52 },
};

/** ENGYE button — hover = bg/color shift only (never scale/shadow); focus ring gold. */
export function Button({
  variant = "primary", size = "md", disabled = false, children, onClick, style, type = "button",
}: {
  variant?: Variant; size?: Size; disabled?: boolean; children: ReactNode;
  onClick?: () => void; style?: CSSProperties; type?: "button" | "submit";
}) {
  const [hover, setHover] = useState(false);
  const variants: Record<Variant, CSSProperties> = {
    primary: { background: hover ? "color-mix(in oklab, var(--primary) 88%, var(--background))" : "var(--primary)", color: "var(--primary-foreground)", border: "1px solid transparent" },
    secondary: { background: hover ? "color-mix(in oklab, var(--secondary) 92%, var(--foreground))" : "var(--secondary)", color: "var(--secondary-foreground)", border: "1px solid transparent" },
    outline: { background: hover ? "color-mix(in oklab, var(--foreground) 6%, transparent)" : "transparent", color: "var(--foreground)", border: "1px solid var(--border)" },
    ghost: { background: hover ? "color-mix(in oklab, var(--foreground) 6%, transparent)" : "transparent", color: "var(--foreground)", border: "1px solid transparent" },
    accent: { background: hover ? "color-mix(in oklab, var(--accent) 90%, var(--background))" : "var(--accent)", color: "var(--accent-foreground)", border: "1px solid transparent" },
    destructive: { background: hover ? "color-mix(in oklab, var(--destructive) 90%, var(--background))" : "var(--destructive)", color: "var(--destructive-foreground)", border: "1px solid transparent" },
  };
  return (
    <button
      type={type} disabled={disabled} onClick={onClick}
      className="focus-ring"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontFamily: "var(--font-body)", fontWeight: 500, lineHeight: 1,
        borderRadius: "var(--radius)", cursor: disabled ? "not-allowed" : "pointer",
        transition: "background-color var(--dur) var(--ease), color var(--dur) var(--ease)",
        opacity: disabled ? 0.55 : 1, outline: "none",
        ...SIZES[size], ...variants[variant], ...style,
      }}
    >
      {children}
    </button>
  );
}
