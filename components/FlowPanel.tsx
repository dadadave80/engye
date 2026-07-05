import { Card } from "./ui/primitives";
import type { Totals } from "@/lib/queries";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Flow panel — the requester → broker → provider money flow (design §5 dashboard rail). */
export function FlowPanel({ totals }: { totals: Totals }) {
  const rows = [
    { label: "requesters → broker", value: `${totals.openCount} open`, color: undefined },
    { label: "broker → providers", value: `${totals.paidCount} paid`, color: undefined },
    { label: "bonds escrowed", value: usd(totals.bondsAtRisk), color: "var(--gold-lifted)" },
    { label: "slashed → requesters", value: usd(totals.slashesCompensated), color: "var(--oxblood-badge)" },
  ];
  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)", marginBottom: 12 }}>Flow</div>
      <div style={{ ...mono, fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", color: r.color }}>
            <span className="min-w-0">{r.label}</span><span>{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
