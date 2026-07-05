"use client";
import { type CSSProperties } from "react";

/** Form input with label, hint, and directive error copy. Focus ring gold. */
export function Input({
  label, hint, error, mono = false, placeholder, value, onChange, type = "text", disabled, style,
}: {
  label?: string; hint?: string; error?: string; mono?: boolean; placeholder?: string;
  value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string; disabled?: boolean; style?: CSSProperties;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-body)", ...style }}>
      {label && <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>}
      <input
        type={type} placeholder={placeholder} value={value} onChange={onChange} disabled={disabled}
        className="focus-ring"
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-body)", fontSize: 14, padding: "10px 12px", minHeight: 22,
          background: "var(--card)", color: "var(--foreground)",
          border: `1px solid ${error ? "var(--destructive)" : "var(--input)"}`,
          borderRadius: "var(--radius)", outline: "none",
          transition: "border-color var(--dur) var(--ease)", opacity: disabled ? 0.55 : 1,
        }}
      />
      {error
        ? <span style={{ fontSize: 13, color: "var(--destructive)" }}>{error}</span>
        : hint && <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{hint}</span>}
    </label>
  );
}
