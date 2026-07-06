import { AppShell } from "@/components/AppShell";
import { ProviderOnboarding } from "@/components/ProviderOnboarding";
import { getProviders, getTotals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ARCSCAN = "https://testnet.arcscan.app";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"; // canonical ERC-8004 Identity on Arc

export default async function ProvidersPage() {
  const [providers, totals] = await Promise.all([getProviders(), getTotals()]);
  return (
    <AppShell settled={totals.matchesSettled}>
      <div className="page-head">
        <p className="kicker">The Registry</p>
        <h1>Stake your endpoint.</h1>
        <p className="lede">Your x402 endpoint, underwritten. Register once — the broker sends paying demand to providers it can price.</p>
        <hr className="ledger-rule" />
      </div>

      <div className="r-split" style={{ alignItems: "start" }}>
        <ProviderOnboarding />

        <div className="table-wrap">
          <table>
            <caption>Calibration leaderboard <span className="tag">ranked by ĉ</span></caption>
            <thead>
              <tr>
                <th scope="col">#</th><th scope="col">Provider</th>
                <th scope="col" className="t-right">ĉ</th><th scope="col" className="t-right">Trials</th>
                <th scope="col" className="t-right">Pass</th><th scope="col" className="t-right">Earned</th>
                <th scope="col" className="t-right">Slashes</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr><td colSpan={7} className="muted">No providers yet — register an x402 endpoint to seed the leaderboard.</td></tr>
              ) : providers.map((p, i) => (
                <tr key={p.id}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    {p.name}
                    {p.inHouse && <span className="num" style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>·in-house</span>}
                    {p.agentId && (
                      <a href={`${ARCSCAN}/token/${IDENTITY_REGISTRY}/instance/${p.agentId}`} target="_blank" rel="noreferrer" title="Verified ERC-8004 identity on Arc"
                        className="num" style={{ fontSize: 10, color: "var(--accent-ink)", textDecoration: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", padding: "1px 6px", marginLeft: 6, whiteSpace: "nowrap" }}>
                        8004 #{p.agentId}
                      </a>
                    )}
                  </td>
                  <td className="num t-right">{p.confidence.toFixed(2)}</td>
                  <td className="num t-right">{p.trials}</td>
                  <td className="num t-right">{p.passRate}</td>
                  <td className="num t-right">{p.earned.toFixed(3)}</td>
                  <td className="num t-right">{p.slashes > 0 ? <span style={{ color: "var(--slash)" }}>{p.slashes}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tfoot-note">ĉ is calibrated confidence — stated confidence corrected by observed pass rate. It sets the bond.</div>
        </div>
      </div>
    </AppShell>
  );
}
