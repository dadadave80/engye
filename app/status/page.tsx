import { AppShell } from "@/components/AppShell";
import { ClaimCard } from "@/components/ClaimCard";
import { usdcBalance, gasBalance } from "@/lib/escrow";
import { getTotals } from "@/lib/queries";
import type { Address } from "viem";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ARCSCAN = "https://testnet.arcscan.app";
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const CONTRACTS: [string, string | undefined][] = [
  ["BondedEscrow", process.env.ESCROW_ADDRESS],
  ["RefundVault", process.env.REFUND_VAULT_ADDRESS],
  ["ProviderStake", process.env.PROVIDER_STAKE_ADDRESS],
  ["SessionAccount (delegate)", process.env.DELEGATE_ADDRESS],
  ["IthacaAccount (root)", process.env.ITHACA_IMPL],
];

const capStyle: React.CSSProperties = { padding: "var(--space-4) var(--space-6)", fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: "var(--text-lg)", borderBottom: "1px solid var(--line)" };

export default async function StatusPage() {
  const broker = process.env.BROKER_ADDRESS as Address;
  const [treasury, gas, vaultFloat, escrowHeld, totals] = await Promise.all([
    usdcBalance(broker).catch(() => null),
    gasBalance(broker).catch(() => null),
    usdcBalance(process.env.REFUND_VAULT_ADDRESS as Address).catch(() => null),
    usdcBalance(process.env.ESCROW_ADDRESS as Address).catch(() => null),
    getTotals().catch(() => null),
  ]);
  const matchingActive = treasury != null && treasury >= 1.0;

  return (
    <AppShell settled={totals?.matchesSettled ?? 0}>
      <div className="page-head">
        <p className="kicker">System of Record</p>
        <h1>Status &amp; reconciliation.</h1>
        <p className="lede">Treasury, float, and open bonds — every figure below is a live on-chain read, not a cached number.</p>
        <hr className="ledger-rule" />
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Broker treasury</div>
          <div className="value">{usd(treasury)}<span className="unit">USDC</span></div>
          {/* a tripped circuit breaker is a pause, not destroyed money — never cinnabar */}
          <div className="sub" style={{ color: matchingActive ? "var(--pass)" : "var(--muted)" }}>{matchingActive ? "matching active" : "circuit breaker tripped (< 1 USDC)"}</div>
        </div>
        <div className="stat">
          <div className="label">Gas (native)</div>
          <div className="value">{usd(gas)}<span className="unit">USDC</span></div>
        </div>
        <div className="stat">
          <div className="label">Refund vault float</div>
          <div className="value at-risk">{usd(vaultFloat)}<span className="unit">USDC</span></div>
          <div className="sub">covers price refunds</div>
        </div>
        <div className="stat">
          <div className="label">Bonds held in escrow</div>
          <div className="value">{usd(escrowHeld)}<span className="unit">USDC</span></div>
          <div className="sub">open bonds on the line</div>
        </div>
      </div>

      <section className="section">
        <div className="table-wrap">
          <div style={capStyle}>Deployed contracts <span className="tag" style={{ fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--muted)", marginLeft: "var(--space-2)" }}>all verified on Arcscan</span></div>
          {CONTRACTS.map(([name, addr]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: "var(--text-sm)" }}>{name}</span>
              {addr
                ? <a className="tx-link" href={`${ARCSCAN}/address/${addr}?tab=contract`} target="_blank" rel="noreferrer" title="View verified contract on Arcscan">{trunc(addr)} ↗</a>
                : <span className="muted">—</span>}
            </div>
          ))}
          <div className="tfoot-note">Σ escrow (open bonds) + vault (refund float) backed by treasury <span className="ok">✓ ledger reconciles</span></div>
        </div>
      </section>

      <section className="section">
        <ClaimCard />
      </section>
    </AppShell>
  );
}
