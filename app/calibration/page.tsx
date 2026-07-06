import { AppShell } from "@/components/AppShell";
import { getCalibration, getTotals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Handoff chart geometry (viewBox 680×400): plot x∈[64,664], y∈[24(=100%),344(=0%)], 10 buckets
// .50–.95 step .05, bar width 44 on a 60px pitch starting at x=72. Bars are token-driven (.bar fill
// = --accent), so the whole chart re-themes with the coin. Opacity tracks sample size.
const BAR_W = 44, PITCH = 60, X0 = 72, Y_BOT = 344, PLOT_H = 320;
const barX = (i: number) => X0 + i * PITCH;
const centerX = (i: number) => barX(i) + BAR_W / 2;

export default async function CalibrationPage() {
  const [buckets, totals] = await Promise.all([getCalibration(), getTotals()]);
  const withData = buckets.filter((b) => b.n > 0);
  const scored = withData.reduce((s, b) => s + b.n, 0);
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  return (
    <AppShell settled={totals.matchesSettled}>
      <div className="page-head">
        <p className="kicker">Calibration</p>
        <h1>Judgment, measured.</h1>
        <p className="lede">Stated confidence against realized pass rate, over {scored} scored {scored === 1 ? "match" : "matches"}. Bonds are priced from this curve.</p>
        <hr className="ledger-rule" />
      </div>

      <div className="card chart-card">
        {withData.length === 0 ? (
          <div className="floor-empty">
            <p className="quiet">Not enough settled matches yet.</p>
            <p className="small">Once matches settle across confidence buckets, the broker&apos;s calibration curve renders here — its stated confidence against the realized pass rate.</p>
          </div>
        ) : (
          <>
            <svg viewBox="0 0 680 400" role="img" aria-label="Bar chart: realized pass rate per stated-confidence bucket from 0.50 to 0.95, with a dashed perfect-calibration diagonal">
              <line className="grid-line" x1="64" y1="24" x2="664" y2="24" />
              <line className="grid-line" x1="64" y1="104" x2="664" y2="104" />
              <line className="grid-line" x1="64" y1="184" x2="664" y2="184" />
              <line className="grid-line" x1="64" y1="264" x2="664" y2="264" />
              <line className="axis-line" x1="64" y1="344" x2="664" y2="344" />
              <line className="axis-line" x1="64" y1="24" x2="64" y2="344" />
              <text className="axis-label" x="56" y="348" textAnchor="end">0</text>
              <text className="axis-label" x="56" y="268" textAnchor="end">25%</text>
              <text className="axis-label" x="56" y="188" textAnchor="end">50%</text>
              <text className="axis-label" x="56" y="108" textAnchor="end">75%</text>
              <text className="axis-label" x="56" y="28" textAnchor="end">100%</text>

              {buckets.map((b, i) => {
                if (b.n === 0) return null;
                const h = b.realized * PLOT_H;
                return <rect key={i} className="bar" x={barX(i)} y={Y_BOT - h} width={BAR_W} height={h} opacity={(0.5 + 0.45 * (b.n / maxN)).toFixed(2)} />;
              })}

              <line className="perfect-line" x1={centerX(0)} y1="184" x2={centerX(9)} y2="40" />
              <text className="chart-note" x="470" y="88">perfect calibration</text>

              <text className="axis-label" x={centerX(0)} y="364" textAnchor="middle">.50</text>
              <text className="axis-label" x={centerX(2)} y="364" textAnchor="middle">.60</text>
              <text className="axis-label" x={centerX(4)} y="364" textAnchor="middle">.70</text>
              <text className="axis-label" x={centerX(6)} y="364" textAnchor="middle">.80</text>
              <text className="axis-label" x={centerX(8)} y="364" textAnchor="middle">.90</text>
              <text className="axis-label" x={centerX(9)} y="364" textAnchor="middle">.95</text>
              <text className="axis-label" x="364" y="392" textAnchor="middle">stated confidence (bucket)</text>
            </svg>
            <p className="chart-caption">Each bar is a stated-confidence bucket; height is the realized pass rate; opacity tracks sample size. Perfect calibration sits on the dashed line — the broker&apos;s stated confidence <em>is</em> the observed pass rate. Bonds are priced from this curve.</p>
            <p className="small muted mono" style={{ margin: "0.75rem 0 0" }}>model groq/gpt-oss-120b · {scored} scored · per-model tabs appear once a second model clears n = 20</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
