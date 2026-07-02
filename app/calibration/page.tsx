import { AppShell } from "@/components/AppShell";
import { Card, Eyebrow, EmptyState } from "@/components/ui/primitives";
import { getCalibration, getTotals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CalibrationPage() {
  const [buckets, totals] = await Promise.all([getCalibration(), getTotals()]);
  const withData = buckets.filter((b) => b.n > 0);
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  const W = 760, H = 380, PAD = 48;
  const x = (v: number) => PAD + ((v - 0.475) / 0.55) * (W - PAD - 16);
  const y = (v: number) => H - PAD - v * (H - PAD - 24);
  const barW = 34;

  return (
    <AppShell settled={totals.matchesSettled}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>The judge</Eyebrow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Calibration — stated confidence vs realized pass rate</span>
        </div>
        <Card padding={24}>
          {withData.length === 0 ? (
            <EmptyState title="Not enough settled matches yet." description="Once matches settle across confidence buckets, the broker's calibration curve renders here — its stated confidence against the realized pass rate." />
          ) : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Calibration chart">
                {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                  <g key={g}>
                    <line x1={PAD} x2={W - 16} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
                    <text x={PAD - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">{g.toFixed(2)}</text>
                  </g>
                ))}
                {buckets.map((b) => (
                  <g key={b.stated}>
                    {b.n > 0 && (
                      <rect x={x(b.stated) - barW / 2} y={y(b.realized)} width={barW} height={y(0) - y(b.realized)} fill="var(--chart-1)" opacity={0.35 + 0.65 * (b.n / maxN)} rx="2" />
                    )}
                    <text x={x(b.stated)} y={H - PAD + 18} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">{b.stated.toFixed(2)}</text>
                    {b.n > 0 && <text x={x(b.stated)} y={y(b.realized) - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">n={b.n}</text>}
                  </g>
                ))}
                <line x1={x(0.5)} y1={y(0.5)} x2={x(1.0)} y2={y(1.0)} stroke="var(--ring)" strokeWidth="1.5" strokeDasharray="6 5" />
                <text x={x(0.97)} y={y(0.97) - 12} textAnchor="end" fontSize="11" fill="var(--ring)" fontFamily="var(--font-mono)">perfect calibration</text>
              </svg>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "16px 0 0", maxWidth: 640, lineHeight: 1.55 }}>
                Perfectly calibrated judgment sits on the gold line — the broker&apos;s stated confidence <em>is</em> the observed pass rate. Bonds are priced from this. Bar opacity scales with sample size.
              </p>
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
