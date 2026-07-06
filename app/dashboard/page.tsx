import { AppShell } from "@/components/AppShell";
import { LiveFeed } from "@/components/LiveFeed";
import { DecisionsRail } from "@/components/DecisionsRail";
import { FlowPanel } from "@/components/FlowPanel";
import { getFeed, getTotals, getRecentDecisions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// money never displays 0.00 — 3-decimal ledger voice keeps small real values visible.
const fx = (n: number) => n.toFixed(3);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function DashboardPage() {
  const [feed, totals, decisions] = await Promise.all([getFeed(), getTotals(), getRecentDecisions()]);
  const lastBonded = feed.find((r) => r.status === "PASS" && (r.bond ?? 0) > 0 && (r.price ?? 0) > 0);
  const last = lastBonded ? { price: lastBonded.price!, bond: lastBonded.bond! } : undefined;
  return (
    <AppShell settled={totals.matchesSettled}>
      <div className="page-head">
        <p className="kicker">The Ledger</p>
        <h1>The broker&apos;s book, open.</h1>
        <p className="lede">Every match, bond, and slash — reconciled against the chain while you watch.</p>
        <hr className="ledger-rule" />
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Matches settled</div>
          <div className="value">{totals.matchesSettled.toLocaleString()}</div>
          <div className="sub">{totals.organic} organic · {totals.demand} demand</div>
        </div>
        <div className="stat">
          <div className="label">USDC settled</div>
          <div className="value">{fx(totals.usdcSettled)}<span className="unit">USDC</span></div>
          <div className="sub">across {totals.matchesSettled} matches</div>
        </div>
        <div className="stat">
          <div className="label">Bonds at risk</div>
          <div className="value at-risk">{fx(totals.bondsAtRisk)}<span className="unit">USDC</span></div>
          <div className="sub">{plural(totals.openCount, "open bond", "open bonds")}</div>
        </div>
        <div className="stat">
          <div className="label">Slashes compensated</div>
          <div className="value slashed">{fx(totals.slashesCompensated)}<span className="unit">USDC</span></div>
          <div className="sub">{plural(totals.slashedCount, "slash", "slashes")} · all paid out</div>
        </div>
      </div>

      <section className="section">
        <LiveFeed initial={feed} />
      </section>

      <section className="section">
        <div className="section-title"><h2>Broker decisions</h2><span className="tag">why each match was priced</span></div>
        <DecisionsRail decisions={decisions} />
      </section>

      <section className="section">
        <div className="section-title"><h2>Money flow</h2><span className="tag">the last settled bonded match</span></div>
        <FlowPanel last={last} />
      </section>
    </AppShell>
  );
}
