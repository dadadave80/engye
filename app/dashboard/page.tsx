import { AppShell } from "@/components/AppShell";
import { LiveFeed } from "@/components/LiveFeed";
import { DecisionsRail } from "@/components/DecisionsRail";
import { FlowPanel } from "@/components/FlowPanel";
import { StatCard, Card } from "@/components/ui/primitives";
import { getFeed, getTotals, getRecentDecisions } from "@/lib/queries";
import { Check } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function DashboardPage() {
  const [feed, totals, decisions] = await Promise.all([getFeed(), getTotals(), getRecentDecisions()]);
  return (
    <AppShell settled={totals.matchesSettled}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="r-stat-grid">
          <StatCard label="Matches settled" value={totals.matchesSettled.toLocaleString()} caption={`${totals.organic} organic · ${totals.demand} demand-agent`} />
          <StatCard label="USDC settled" value={usd(totals.usdcSettled)} unit="USDC" />
          <StatCard label="Bonds at risk" value={usd(totals.bondsAtRisk)} unit="USDC" tone="gold" />
          <StatCard label="Slashes compensated" value={usd(totals.slashesCompensated)} unit="USDC" tone="oxblood" />
        </div>

        <div className="r-split" style={{ alignItems: "start" }}>
          <Card padding={0}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Live match feed</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)" }}>realtime</span>
            </div>
            <LiveFeed initial={feed} />
            <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--success)", flexWrap: "wrap" }}>
              <Check size={14} />
              <span className="min-w-0">Ledger reconciles — Σ payments + bonds − slashes = balances</span>
            </div>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <DecisionsRail decisions={decisions} />
            </div>
            <FlowPanel totals={totals} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
