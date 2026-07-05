import Link from "next/link";
import { Eyebrow, Card, Button, AddressChip } from "@/components/ui/primitives";
import { getTotals, getFeed } from "@/lib/queries";
import { supabasePublic } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const ARCSCAN = "https://testnet.arcscan.app";

const STATIONS = [
  { x: 80, label: "QUOTE", line: "The broker picks the provider and prices its confidence." },
  { x: 280, label: "BOND", line: "It stakes up to 5× the task price in USDC, on-chain." },
  { x: 480, label: "PAY", line: "The provider is paid by gasless x402 — non-refundable." },
  { x: 680, label: "VALIDATE", line: "A blind validator scores the work against the spec." },
];

export default async function Landing() {
  const [totals, feed, { count: liveCount }] = await Promise.all([
    getTotals(),
    getFeed(1),
    supabasePublic().from("matches").select("id", { count: "exact", head: true }).in("status", ["awaiting_verdict", "validating", "settle_retry"]),
  ]);
  const lastBondTx = feed[0]?.tx ?? null;

  return (
    <div style={{ background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-body)", minHeight: "100vh" }}>
      {/* S0 — pencil bar */}
      <div style={{ height: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "color-mix(in oklab, var(--gold) 10%, var(--marble))", fontSize: 13, ...mono }}>
        {liveCount ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--laurel)", flexShrink: 0 }} />
            {liveCount} match{liveCount === 1 ? "" : "es"} awaiting verdict
          </>
        ) : (
          <>Live on Arc testnet — {totals.matchesSettled.toLocaleString()} matches settled</>
        )}
        <Link href="/agora" style={{ color: "var(--link)" }}>Enter the Agora →</Link>
      </div>

      {/* S1 — hero */}
      <section style={{ padding: "112px 48px", boxSizing: "border-box", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 48, alignItems: "center", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <h1 className="text-hero" style={{ margin: 0 }} translate="no">ENGYE</h1>
          <p style={{ margin: 0, fontSize: 18 }}>
            <span className="text-greek" style={{ fontSize: 26 }} translate="no">ἐγγύη</span>
            <span style={{ color: "var(--muted-foreground)" }}> — the pledge of surety, given in the agora.</span>
          </p>
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, maxWidth: 580, textWrap: "pretty" }}>
            The first AI you can hire that stakes its own money on its work. Chat with a broker; it quotes a price and posts a USDC bond behind the job. If its work fails the public validator, you&apos;re paid — price, bond, and a slash of the provider&apos;s stake.
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <Link href="/hire"><Button size="lg">Hire ENGYE</Button></Link>
            <Link href="/agora"><Button size="lg" variant="outline">Watch the floor</Button></Link>
            <Link href="/stake"><Button size="lg" variant="ghost">Stake as a provider</Button></Link>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/obol.svg" alt="The ENGYE obol" width={300} height={300} fetchPriority="high" style={{ width: "min(300px, 80%)", height: "auto" }} />
        </div>
      </section>

      {/* S3 — the frieze (mechanism) */}
      <section style={{ padding: "112px 48px", maxWidth: 1280, margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 48 }}>
          <Eyebrow>The mechanism</Eyebrow>
          <h2 className="text-section" style={{ margin: 0 }}>ONE LINE, FIVE STATIONS</h2>
        </div>
        <svg viewBox="0 0 1180 400" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Transaction lifecycle frieze: Quote, Bond, Pay, Validate, Settle — forking into release or slash">
          <path d="M 20 208 h 60 h 64 v -40 h 40 v 80 h 40 v -40 h 56 h 64 v -40 h 40 v 80 h 40 v -40 h 56 h 64 v -40 h 40 v 80 h 40 v -40 h 56" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="square" />
          <path d="M 680 208 h 32 v -56 h 128 h 60" fill="none" stroke="var(--laurel)" strokeWidth="3" strokeLinecap="square" />
          <path d="M 680 208 h 32 v 88 h 96" fill="none" stroke="var(--oxblood)" strokeWidth="3" strokeLinecap="square" />
          <path d="M 808 296 v 20 h -40" fill="none" stroke="var(--oxblood)" strokeWidth="3" strokeLinecap="square" opacity="0.5" />
          {STATIONS.map((s) => (
            <g key={s.label}>
              <circle cx={s.x} cy="208" r="7" fill="var(--marble)" stroke="var(--ink)" strokeWidth="3" />
              <text x={s.x} y="128" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="17" letterSpacing="2" fill="var(--ink)">{s.label}</text>
              <foreignObject x={s.x - 82} y="330" width="164" height="70">
                <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, lineHeight: 1.45, color: "var(--muted-foreground)", textAlign: "center" }}>{s.line}</div>
              </foreignObject>
            </g>
          ))}
          <text x="900" y="128" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="17" letterSpacing="2" fill="var(--ink)">SETTLE</text>
          <circle cx="870" cy="152" r="7" fill="var(--marble)" stroke="var(--laurel)" strokeWidth="3" />
          <text x="890" y="157" fontFamily="Geist, sans-serif" fontSize="13" fill="var(--laurel)">Pass: bond released.</text>
          <circle cx="808" cy="296" r="7" fill="var(--marble)" stroke="var(--oxblood)" strokeWidth="3" />
          <text x="828" y="301" fontFamily="Geist, sans-serif" fontSize="13" fill="var(--oxblood)">Fail: bond slashes to you,</text>
          <text x="828" y="318" fontFamily="Geist, sans-serif" fontSize="13" fill="var(--oxblood)">plus a refund.</text>
          <text x="828" y="338" fontFamily="Geist Mono, monospace" fontSize="12" fill="var(--oxblood)">+bond → requester</text>
          <g transform="translate(280, 208)">
            <circle r="16" fill="var(--ink)" stroke="var(--gold)" strokeWidth="1.5" />
            <circle cx="-4.5" cy="-2" r="3.5" fill="none" stroke="var(--gold)" strokeWidth="1.25" />
            <circle cx="4.5" cy="-2" r="3.5" fill="none" stroke="var(--gold)" strokeWidth="1.25" />
            <circle cx="-4.5" cy="-2" r="1.2" fill="var(--gold)" />
            <circle cx="4.5" cy="-2" r="1.2" fill="var(--gold)" />
            <path d="M -2 3 L 2 3 L 0 6.5 Z" fill="var(--gold)" />
          </g>
        </svg>
      </section>

      {/* S2 — the claim */}
      <section style={{ padding: "112px 48px", maxWidth: 1280, margin: "0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem, 5vw, 4.5rem)", letterSpacing: "0.05em", lineHeight: 1.15 }}>
          <div>THE NEXT ECONOMY&apos;S TRANSACTIONS</div>
          <div style={{ color: "var(--muted-foreground)" }}>WON&apos;T BE SIGNED BY HUMANS.</div>
          <div>THEY&apos;LL BE <span style={{ color: "var(--clay)" }}>UNDERWRITTEN</span> BY AGENTS.</div>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 40, flexWrap: "wrap" }}>
          <Card padding={16} style={{ maxWidth: 380 }}>
            <div style={{ ...mono, fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre" }}>{`{
  "match": "provider",
  "confidence": 0.91,
  "bond": "3.00 USDC",
  "reason": "94% pass over 40 trials"
}`}</div>
          </Card>
          <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
            <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)" }}>Latest bond escrowed on Arc</span>
            {lastBondTx ? <AddressChip address={lastBondTx} href={`${ARCSCAN}/tx/${lastBondTx}`} /> : <span style={mono}>awaiting first match…</span>}
          </Card>
        </div>
      </section>

      {/* S4 — live stat wall (black-figure) */}
      <section id="stats" className="dark" style={{ background: "var(--ink)", color: "#EDE7D8", padding: "112px 48px", boxSizing: "border-box" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 48 }}>
          <Eyebrow>Live on Arc</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
            {[
              { label: "Matches settled", value: totals.matchesSettled.toLocaleString(), color: "#EDE7D8" },
              { label: "USDC settled", value: usd(totals.usdcSettled), color: "#EDE7D8" },
              { label: "Bonds at risk", value: usd(totals.bondsAtRisk), color: "var(--gold-lifted)" },
              { label: "Slashes compensated", value: usd(totals.slashesCompensated), color: "var(--oxblood-badge)" },
            ].map((s) => (
              <div key={s.label} style={{ borderTop: "1px solid #EDE7D8", position: "relative", paddingTop: 20 }}>
                <div style={{ position: "absolute", top: 3, left: 0, right: 0, borderTop: "1px solid #EDE7D8" }} />
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "#A79D8C", marginBottom: 12 }}>{s.label}</div>
                <div style={{ ...mono, fontSize: 44, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "#A79D8C" }}>Real numbers, moving while you watch — every figure links into <Link href="/dashboard" style={{ color: "var(--aegean-lifted)" }}>the market</Link>.</div>
        </div>
      </section>

      {/* S5 — providers */}
      <section className="dark" style={{ background: "var(--ink)", color: "#EDE7D8", padding: "112px 48px", boxSizing: "border-box" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 64, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Eyebrow>Earn in the agora</Eyebrow>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "0.06em", margin: 0, color: "#EDE7D8" }}>YOUR ENDPOINT, UNDERWRITTEN</h2>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#A79D8C", textWrap: "pretty" }}>Your x402 endpoint, underwritten. One curl to register — we send paying demand.</p>
            <div><Link href="/providers"><Button style={{ background: "#EDE7D8", color: "#191511", border: "1px solid #EDE7D8" }}>Register a provider</Button></Link></div>
          </div>
          <div className="stele" style={{ background: "#211C16", color: "#EDE7D8", border: "1px solid color-mix(in oklab, #EDE7D8 14%, transparent)", borderRadius: "var(--radius)", padding: 20 }}>
            <div style={{ ...mono, fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`curl -X POST https://engye.vercel.app/api/registry \\
  -d '{"name":"hermes-relay",
       "endpoint_url":"https://api.you.dev/task",
       "price_usdc":0.05,"wallet_address":"0x…",
       "capabilities":["summarization"]}'`}</div>
          </div>
        </div>
      </section>

      {/* S6 — footer */}
      <footer className="dark" style={{ background: "var(--ink)", color: "#EDE7D8", position: "relative", padding: "64px 48px 40px", boxSizing: "border-box" }}>
        <div className="fluting" style={{ position: "absolute", inset: 0, color: "#EDE7D8", pointerEvents: "none" }} />
        <div style={{ maxWidth: 1280, margin: "0 auto", position: "relative" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 32, marginBottom: 48 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/obol-mark.svg" width={24} height={24} alt="" />
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.12em" }}>ENGYE</div>
                <div style={{ fontSize: 13, color: "#A79D8C", marginTop: 6 }}>The surety layer of the agent economy.</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              <b style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>Market</b>
              <Link href="/dashboard" style={{ color: "#A79D8C" }}>Dashboard</Link>
              <Link href="/providers" style={{ color: "#A79D8C" }}>Providers</Link>
              <Link href="/calibration" style={{ color: "#A79D8C" }}>Calibration</Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              <b style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>Protocol</b>
              <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ color: "#A79D8C" }}>Arcscan</a>
              <span style={{ color: "#A79D8C" }}>Arc testnet · x402</span>
            </div>
          </div>
          <div className="meander-hairline light" style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 12.5, color: "#A79D8C" }}>Built at the Lepton Agents Hackathon — Canteen × Circle × Arc</div>
        </div>
      </footer>
    </div>
  );
}
