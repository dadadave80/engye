"use client";
import { useState } from "react";
import type { DecisionItem } from "@/lib/queries";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

export function DecisionsRail({ decisions }: { decisions: DecisionItem[] }) {
  const [open, setOpen] = useState<string | null>(decisions[0]?.id ?? null);
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>Decisions</div>
      {decisions.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "var(--muted-foreground)" }}>No decisions yet.</div>}
      {decisions.map((d) => (
        <div key={d.id} style={{ borderBottom: "1px solid var(--border)" }}>
          <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)}
            style={{ width: "100%", textAlign: "left", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", color: "var(--foreground)", fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)", display: "flex", justifyContent: "space-between", gap: 8 }}>
            {d.headline}
            <span style={{ color: "var(--muted-foreground)" }}>{open === d.id ? "−" : "+"}</span>
          </button>
          {open === d.id && (
            <div style={{ padding: "0 16px 12px", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
              {d.body}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {d.chips.map((c, i) => (
                  <span key={i} style={{ ...mono, fontSize: 11, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
