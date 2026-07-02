import { AppShell } from "@/components/AppShell";
import { Card, Eyebrow, AddressChip, EmptyState } from "@/components/ui/primitives";
import { RegisterForm } from "@/components/RegisterForm";
import { getProviders, getTotals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const ARCSCAN = "https://testnet.arcscan.app";
const lat = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

export default async function ProvidersPage() {
  const [providers, totals] = await Promise.all([getProviders(), getTotals()]);
  return (
    <AppShell settled={totals.matchesSettled}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>Earn in the agora</Eyebrow>
            <span style={{ fontSize: 20, fontWeight: 600 }}>Provider leaderboard</span>
          </div>
        </div>

        <RegisterForm />

        <Card padding={0}>
          {providers.length === 0 ? (
            <EmptyState title="No providers registered" hint="Register an x402 endpoint above — we probe it, pay one real call, and seed a reputation prior." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>#</th><th style={th}>Provider</th><th style={th}>ĉ</th><th style={th}>Trials</th>
                  <th style={th}>Pass</th><th style={th}>Earned</th><th style={th}>Latency</th><th style={th}>Slashes</th><th style={th}>Wallet</th>
                </tr></thead>
                <tbody>
                  {providers.map((p, i) => (
                    <tr key={p.id}>
                      <td style={{ ...td, ...mono, color: "var(--muted-foreground)" }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{p.name}{p.inHouse && <span style={{ ...mono, fontSize: 10, color: "var(--muted-foreground)", marginLeft: 6 }}>·in-house</span>}</td>
                      <td style={{ ...td, ...mono }}>{p.confidence.toFixed(2)}</td>
                      <td style={{ ...td, ...mono }}>{p.trials}</td>
                      <td style={{ ...td, ...mono }}>{p.passRate}</td>
                      <td style={{ ...td, ...mono }}>{p.earned.toFixed(4)}</td>
                      <td style={{ ...td, ...mono, color: "var(--muted-foreground)" }}>{lat(p.avgLatencyMs)}</td>
                      <td style={{ ...td, ...mono, color: p.slashes > 3 ? "var(--oxblood-badge)" : "var(--muted-foreground)" }}>{p.slashes}</td>
                      <td style={td}><AddressChip address={p.wallet} href={`${ARCSCAN}/address/${p.wallet}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
