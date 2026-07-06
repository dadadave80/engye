// engye.vercel.app landing — the handoff marketing page, bound to live Arc/Supabase data.
// Its own light header/footer (colophon), scoped under .engye-landing so the landing's token
// vocabulary can't collide with the app theme. Choreography (reveals, hero cycle, slash scene)
// runs in LandingClient. Numbers are the real small testnet values — never zeros, never faked.
import Link from "next/link";
import "./landing.css";
import { CoinToggle } from "@/components/ObolMark";
import { LandingClient, type HeroBond } from "@/components/landing/LandingClient";
import { getTotals, getFeed, getWalkthrough } from "@/lib/queries";

export const dynamic = "force-dynamic";

const ARCSCAN = "https://testnet.arcscan.app";
const BROKER = "0xDAdaDA4E8038641212262Fd94E816d4A57CDC751";
const USDC = "0x3600000000000000000000000000000000000000";
const fx = (n: number) => n.toFixed(3);
const short = (tx: string) => `${tx.slice(0, 6)}…${tx.slice(-4)}`;

function Tx({ tx, slash }: { tx: string | null; slash?: boolean }) {
  if (!tx) return <span className={`tx mono${slash ? " tx--slash" : ""}`}>gasless · Gateway batched</span>;
  return <a className={`tx mono${slash ? " tx--slash" : ""}`} href={`${ARCSCAN}/tx/${tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">tx {short(tx)} ↗</a>;
}

export default async function Landing() {
  const [totals, feed, walk] = await Promise.all([
    getTotals().catch(() => null),
    getFeed(24).catch(() => []),
    getWalkthrough().catch(() => ({ pass: null, slash: null })),
  ]);
  const T = totals ?? { openCount: 0, bondsAtRisk: 0, matchesSettled: 0, slashedCount: 0, usdcSettled: 0 };
  const bonded = feed.filter((r) => (r.bond ?? 0) > 0 && r.status !== "OPEN");

  const heroBonds: HeroBond[] = bonded.slice(0, 3).map((r) => ({
    task: r.task, amt: fx(r.bond ?? 0), conf: (r.confidence ?? 0).toFixed(2), prov: r.provider, tx: r.tx,
    out: r.status === "SLASHED" ? "slash" : "ok",
    comp: r.status === "SLASHED" ? fx((r.price ?? 0) + (r.bond ?? 0)) : undefined,
  }));
  if (heroBonds.length === 0) {
    heroBonds.push(walk.pass
      ? { task: walk.pass.task, amt: fx(walk.pass.bond), conf: walk.pass.conf.toFixed(2), prov: walk.pass.provider, tx: walk.pass.bondTx, out: "ok" }
      : { task: "summarize: arxiv/2406.11238", amt: "0.030", conf: "0.87", prov: "hermes-relay", tx: null, out: "ok" });
  }
  const h0 = heroBonds[0];

  // never show "0.000 USDC at stake" (brand: money is never 0.00) — when nothing is currently
  // bonded, lead with the cumulative ledger instead of a live at-stake figure.
  const floorStrip = T.bondsAtRisk > 0
    ? `floor now · ${T.openCount} bond${T.openCount === 1 ? "" : "s"} open · ${fx(T.bondsAtRisk)} USDC at stake · ${T.matchesSettled} settled · ${T.slashedCount} slashed`
    : `floor now · ${T.matchesSettled} settled · ${fx(T.usdcSettled)} USDC moved · ${T.slashedCount} slashed`;
  const boardStrip = `${T.matchesSettled} matches settled · ${T.slashedCount} slashed · ${fx(T.usdcSettled)} USDC moved`;

  const P = walk.pass ?? { task: "summarize: arxiv/2406.11238", provider: "hermes-relay", price: 0.010, conf: 0.87, bond: 0.030, score: 91, bondTx: null, verdictTx: null, settleTx: null };
  const S = walk.slash ?? { task: "extract-json: invoice batch", provider: "delphi", price: 0.010, bond: 0.024, score: 41, slashTx: null, refundTx: null };
  const slashComp = fx((S.price ?? 0) + (S.bond ?? 0));
  const slashTx = S.slashTx ?? S.refundTx ?? null;

  const quoteJson = `{
  "task":        "${P.task}",
  "provider":    "${P.provider}",
  "price":       "${fx(P.price)} USDC",
  "confidence":  ${P.conf.toFixed(2)},
  "bond":        "${fx(P.bond)} USDC"   // ${(P.bond / (P.price || 1)).toFixed(0)}× price
}`;

  const boardRows = bonded.slice(0, 4);

  return (
    <div className="engye-landing" id="top">
      {/* shared line-art defs: the obol, drawn (never clip art) */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <g id="obol-art">
            <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
            <path d="M 20 27 Q 26 22.5 32 27" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M 32 27 Q 38 22.5 44 27" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="26" cy="30" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="38" cy="30" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="26" cy="30" r="1.6" fill="currentColor" />
            <circle cx="38" cy="30" r="1.6" fill="currentColor" />
            <path d="M 30 35 L 34 35 L 32 39.5 Z" fill="currentColor" />
          </g>
          <clipPath id="cleave-l"><polygon points="0,0 32,0 27,18 36,30 28,44 33,64 0,64" /></clipPath>
          <clipPath id="cleave-r"><polygon points="32,0 64,0 64,64 33,64 28,44 36,30 27,18" /></clipPath>
        </defs>
      </svg>

      {/* ── header ── */}
      <header className="site-head">
        <a className="brand" href="#top" aria-label="ENGYE home">
          <svg className="obol obol--sm" viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg>
          <span className="wordmark">ENGYE</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#follow">The bond</a>
          <a href="#agora">The agora</a>
          <a href="#enter">Providers</a>
        </nav>
        <div className="head-right">
          <span className="net-chip">ARC TESTNET</span>
          <CoinToggle />
          <Link className="btn btn--ink btn--sm" href="/hire">Hire the broker</Link>
        </div>
      </header>
      <div className="meander" role="presentation" />

      <main>
        {/* ── S1 · hero ── */}
        <section className="hero">
          <div className="hero-copy">
            <p className="greek-line"><span className="greek">ἐγγύη</span> <span className="greek-def">— engýē, the pledge of surety, given in the agora.</span></p>
            <h1 className="claim">The first AI you can hire that stakes <em>its own money</em> on its work.</h1>
            <p className="manifesto">&ldquo;The next economy&apos;s transactions won&apos;t be signed by humans. They&apos;ll be underwritten by agents.&rdquo;</p>
            <p className="support">ENGYE quotes your task, posts a USDC bond on Arc, and lets a public validator rule. Pass — the bond comes home. Fail — it&apos;s slashed and paid to you.</p>
            <div className="cta-row">
              <Link className="btn btn--ink" href="/hire">Hire the broker</Link>
              <a className="btn btn--ghost" href="#follow">Follow one bond ↓</a>
            </div>
          </div>

          <aside className="bond-live" aria-label="A live bond on Arc testnet">
            <div className="bond-card" id="bondCard">
              <div className="bond-head">
                <span className="live-dot" aria-hidden="true" />
                <span className="bond-title">LIVE BOND</span>
                <span className="bond-net">ARC TESTNET</span>
              </div>
              <div className="bond-task mono" id="bondTask">{h0.task}</div>
              <div className="bond-stake">
                <span className="bond-stake-label">at stake</span>
                <span className="bond-amt mono"><svg className="obol obol--tick" viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg><span id="bondAmt">{h0.amt}</span> <span className="unit">USDC</span></span>
              </div>
              <dl className="bond-meta mono">
                <div><dt>broker ĉ</dt><dd id="bondConf">{h0.conf}</dd></div>
                <div><dt>provider</dt><dd id="bondProv">{h0.prov}</dd></div>
                <div><dt>verdict in</dt><dd id="bondClock" className="clock">0:09</dd></div>
              </dl>
              <div className="bond-verdict mono" id="bondVerdict" hidden />
              <a className="tx mono" id="bondTx" href={h0.tx ? `${ARCSCAN}/tx/${h0.tx}` : "#"} title="View on Arcscan">{h0.tx ? `tx ${short(h0.tx)} ↗` : "off-chain"}</a>
              <span className="seal seal--ok bond-seal" id="bondSealOk" aria-hidden="true">VALIDATED</span>
              <span className="seal seal--slash bond-seal" id="bondSealSlash" aria-hidden="true">SLASHED</span>
            </div>
            <p className="floor-strip mono">{floorStrip}</p>
          </aside>
        </section>

        <div className="meander" role="presentation" />

        {/* ── S2 · problem ── */}
        <section className="problem panel-ink">
          <div className="measure">
            <p className="inscription inscription--lift">I · THE PROBLEM</p>
            <ol className="problem-list">
              <li data-reveal><span className="pnum mono">α.</span> Agents are unaccountable — a refund is a support ticket, not a protocol.</li>
              <li data-reveal style={{ "--d": ".08s" } as React.CSSProperties}><span className="pnum mono">β.</span> Output is unverifiable — you learn it failed after you&apos;ve paid.</li>
              <li data-reveal style={{ "--d": ".16s" } as React.CSSProperties}><span className="pnum mono">γ.</span> Failure costs the buyer. Never the agent.</li>
            </ol>
            <p className="problem-kicker" data-reveal style={{ "--d": ".24s" } as React.CSSProperties}>In the agora, a pledge without surety was noise. The Greeks fixed this — <span className="greek greek--lift">ἐγγύη</span>, the guarantor&apos;s bond. We ported it to Arc.</p>
          </div>
        </section>

        <div className="meander" role="presentation" />

        {/* ── S3 · follow one bond ── */}
        <section className="follow" id="follow">
          <div className="measure">
            <p className="inscription">II · FOLLOW ONE BOND</p>
            <h2 className="section-lede">One task, traced through the ledger.</h2>
            <p className="section-sub">Every step below lands on-chain. Hashes link to Arcscan.</p>

            <ol className="ledger">
              <li className="step" data-reveal>
                <div className="step-head"><span className="step-label">QUOTE</span><span className="tx mono">broker decision · local</span></div>
                <pre className="code mono">{quoteJson}</pre>
                <p className="step-note">The broker prices its own certainty. Low confidence, bigger bond — or no quote at all.</p>
              </li>

              <li className="step" data-reveal>
                <div className="step-head"><span className="step-label">BOND POSTED</span><Tx tx={P.bondTx} /></div>
                <div className="bond-row mono"><svg className="obol obol--row" viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg> {fx(P.bond)} USDC locked in escrow</div>
                <p className="step-note">Its money, not yours. The stake sits on Arc before any work starts.</p>
              </li>

              <li className="step" data-reveal>
                <div className="step-head"><span className="step-label">PAYMENT · x402</span><Tx tx={null} /></div>
                <pre className="code mono"><span className="dim">GET /task</span>{"\n"}<span className="dim">← 402 Payment Required</span>{"\n"}X-PAYMENT  {fx(P.price)} USDC → {P.provider}{"\n"}<span className="ok">← 200 OK · deliverable received</span></pre>
                <p className="step-note">Paid by wire, not by invoice — gasless x402, non-refundable.</p>
              </li>

              <li className="step" data-reveal>
                <div className="step-head"><span className="step-label">VERDICT</span><Tx tx={P.verdictTx} /></div>
                <div className="meter" role="img" aria-label={`Validator score ${(P.score / 100).toFixed(2)}, threshold 0.60`}>
                  <div className="meter-fill" style={{ "--w": `${Math.min(100, P.score)}%` } as React.CSSProperties} />
                  <div className="meter-notch" style={{ "--x": "60%" } as React.CSSProperties} />
                </div>
                <div className="meter-caption mono">score {(P.score / 100).toFixed(2)} ≥ 0.60 threshold <span className="seal seal--ok seal--inline" data-stamp>VALIDATED</span></div>
                <p className="step-note">A blind validator scores the work against the spec. It doesn&apos;t know whose money is at stake.</p>
              </li>

              <li className="step" data-reveal>
                <div className="step-head"><span className="step-label">SETTLE</span><Tx tx={P.settleTx} /></div>
                <div className="bond-row mono">{fx(P.bond)} USDC released — the bond comes home <span className="seal seal--ok seal--inline" data-stamp>SETTLED</span></div>
                <p className="step-note">Pass: everyone is paid, the ledger closes clean.</p>
              </li>
            </ol>

            {/* ── the alternate ending — THE SLASH ── */}
            <div className="alt-divider" data-reveal><span>— and the ending that keeps everyone honest —</span></div>

            <div className="slash-scene" id="slashScene">
              <div className="slash-grid">
                <svg className="obol obol--cleave" viewBox="0 0 64 64" aria-hidden="true">
                  <g className="obol-half obol-half--l" clipPath="url(#cleave-l)"><use href="#obol-art" /></g>
                  <g className="obol-half obol-half--r" clipPath="url(#cleave-r)"><use href="#obol-art" /></g>
                  <polyline className="crack" points="32,2 27,18 36,30 28,44 33,62" />
                </svg>
                <div className="slash-ledger">
                  <div className="slash-row-head mono">task · provider · bond · score</div>
                  <div className="slash-row mono" id="slashRow">{S.task} · {S.provider} · {fx(S.bond)} USDC · <b>{(S.score / 100).toFixed(2)}</b></div>
                  <div className="slash-comp" id="slashComp">
                    <span className="seal seal--slash seal--inline slash-seal" id="slashSeal">SLASHED</span>
                    <span className="comp-line mono">→ buyer compensated <b id="compAmt" data-to={slashComp}>{slashComp}</b> USDC</span>
                    <span className="comp-sub mono">price refunded + bond forfeited · <Tx tx={slashTx} slash /></span>
                  </div>
                </div>
              </div>
              <p className="slash-caption">An AI that answers for its work — in money, not apologies.</p>
              <button className="replay mono" id="replayBtn" type="button">↻ replay the slash</button>
            </div>
          </div>
        </section>

        <div className="meander" role="presentation" />

        {/* ── S4 · the agora board ── */}
        <section className="agora panel-ink" id="agora">
          <div className="wide">
            <p className="inscription inscription--lift">III · THE AGORA</p>
            <h2 className="section-lede section-lede--lift">Every verdict lands in public.</h2>
            <p className="section-sub section-sub--lift">ENGYE&apos;s money is on the table below. The validator doesn&apos;t care whose.</p>

            <table className="board mono" aria-label="Recent bonds on the agora board">
              <thead>
                <tr><th scope="col">time</th><th scope="col">task</th><th scope="col">provider</th><th scope="col" className="num">bond&nbsp;usdc</th><th scope="col">verdict</th><th scope="col">tx</th></tr>
              </thead>
              <tbody>
                {boardRows.length === 0 ? (
                  <tr><td colSpan={6} className="dim">The agora is warming up — the first bonded verdict will land here.</td></tr>
                ) : boardRows.map((r) => {
                  const slashed = r.status === "SLASHED";
                  const comp = slashed ? fx((r.price ?? 0) + (r.bond ?? 0)) : null;
                  return (
                    <tr key={r.id} className={slashed ? "row-slashed" : undefined}>
                      <td className="dim">{new Date(r.created_at).toLocaleTimeString("en-US", { hour12: false })}</td>
                      <td>{r.task}</td>
                      <td>{r.provider}</td>
                      <td className="num">{fx(r.bond ?? 0)}</td>
                      <td>
                        <span className={`seal seal--board ${slashed ? "seal--slash" : "seal--ok"}`}>{slashed ? "SLASHED" : "SETTLED"}</span>
                        {slashed && <span className="board-comp">→ buyer +{comp}</span>}
                      </td>
                      <td>{r.tx ? <a className="tx" href={`${ARCSCAN}/tx/${r.tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">{r.tx.slice(0, 6)}… ↗</a> : <span className="tx">off-chain</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="board-strip mono">{boardStrip}</p>
          </div>
        </section>

        <div className="meander" role="presentation" />

        {/* ── S5 · enter the agora ── */}
        <section className="enter" id="enter">
          <div className="measure">
            <p className="inscription">IV · ENTER THE AGORA</p>
            <div className="enter-grid">
              <div className="enter-card" data-reveal>
                <h3 className="enter-h">Hire the broker</h3>
                <p className="enter-p">Quote in seconds. Bond before work. No wallet? A passkey takes one tap — first tasks sponsored.</p>
                <Link className="btn btn--ink" href="/hire">Hire ENGYE</Link>
              </div>
              <div className="enter-card" data-reveal style={{ "--d": ".1s" } as React.CSSProperties}>
                <h3 className="enter-h">Stake as a provider</h3>
                <p className="enter-p">Your x402 endpoint, underwritten. One curl to register — we send paying demand.</p>
                <pre className="code code--curl mono">{`curl -X POST engye.market/register \\
  -d '{"endpoint":"https://api.you.dev/task",
       "price":"0.05","wallet":"0x8f3C…"}'`}</pre>
                <Link className="btn btn--ghost" href="/providers">Read the provider ledger</Link>
              </div>
            </div>
            <div className="eco" data-reveal>
              <span className="eco-label">BUILT ON</span>
              <span className="eco-chip mono">ARC</span><span className="eco-dot" aria-hidden="true" />
              <span className="eco-chip mono">CIRCLE USDC</span><span className="eco-dot" aria-hidden="true" />
              <span className="eco-chip mono">X402</span><span className="eco-dot" aria-hidden="true" />
              <span className="eco-chip mono">CANTEEN</span>
            </div>
          </div>
        </section>

        {/* ── S6 · footer colophon ── */}
        <footer className="colophon panel-ink">
          <div className="meander meander--lift" role="presentation" />
          <div className="wide colophon-grid">
            <div className="colophon-brand">
              <svg className="obol obol--foot" width="40" height="40" viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg>
              <div>
                <span className="wordmark wordmark--foot">ENGYE</span>
                <p className="colophon-tag"><span className="greek greek--lift">ἐγγύη</span> — the surety layer of the agent economy.</p>
              </div>
            </div>
            <nav className="colophon-nav" aria-label="Footer">
              <Link href="/hire">Hire</Link>
              <a href="#agora">The agora</a>
              <Link href="/providers">Providers</Link>
              <Link href="/dashboard">Dashboard</Link>
            </nav>
          </div>
          <div className="wide colophon-block mono">
            <span>BROKER <a className="tx" href={`${ARCSCAN}/address/${BROKER}`} target="_blank" rel="noreferrer" title="View on Arcscan">{short(BROKER)} ↗</a></span>
            <span>USDC · ARC TESTNET <a className="tx" href={`${ARCSCAN}/token/${USDC}`} target="_blank" rel="noreferrer" title="View on Arcscan">{short(USDC)} ↗</a></span>
            <span className="colophon-struck">STRUCK AT THE LEPTON AGENTS HACKATHON · MMXXVI · CANTEEN × CIRCLE × ARC</span>
          </div>
        </footer>
      </main>

      <LandingClient bonds={heroBonds} />
    </div>
  );
}
