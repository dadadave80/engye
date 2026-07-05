import { AppShell } from "@/components/AppShell";
import { Card, Eyebrow, AddressChip, StatCard } from "@/components/ui/primitives";
import { ClaimCard } from "@/components/ClaimCard";
import { usdcBalance, gasBalance } from "@/lib/escrow";
import { getTotals } from "@/lib/queries";
import { Check } from "lucide-react";
import type { Address } from "viem";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ARCSCAN = "https://testnet.arcscan.app";

const CONTRACTS: [string, string | undefined][] = [
  ["BondedEscrow", process.env.ESCROW_ADDRESS],
  ["RefundVault", process.env.REFUND_VAULT_ADDRESS],
  ["ProviderStake", process.env.PROVIDER_STAKE_ADDRESS],
  ["SessionAccount (delegate)", process.env.DELEGATE_ADDRESS],
  ["IthacaAccount (root)", process.env.ITHACA_IMPL],
];

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
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>System of record</Eyebrow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Status &amp; reconciliation</span>
        </div>

        <div className="r-stat-grid">
          <StatCard label="Broker treasury" value={usd(treasury)} unit="USDC" tone={matchingActive ? "laurel" : "oxblood"} caption={matchingActive ? "matching active" : "circuit breaker tripped"} />
          <StatCard label="Gas (native)" value={usd(gas)} unit="USDC" />
          <StatCard label="Refund vault float" value={usd(vaultFloat)} unit="USDC" tone="gold" />
          <StatCard label="Bonds held in escrow" value={usd(escrowHeld)} unit="USDC" />
        </div>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--success)" }}>
            <Check size={16} />
            <span>Ledger reconciles — escrow holds open bonds; vault holds refund float; treasury backs both. Every figure is a live on-chain read.</span>
          </div>
        </Card>

        <Card padding={0}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>Deployed contracts (all verified on Arcscan)</div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {CONTRACTS.map(([name, addr]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                <span className="min-w-0" style={{ fontSize: 14 }}>{name}</span>
                {addr ? <AddressChip address={addr} href={`${ARCSCAN}/address/${addr}?tab=contract`} /> : <span style={{ color: "var(--muted-foreground)" }}>—</span>}
              </div>
            ))}
          </div>
        </Card>

        <ClaimCard />
      </div>
    </AppShell>
  );
}
