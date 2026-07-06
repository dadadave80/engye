import Link from "next/link";
import "./landing.css";
import { getTotals, getFeed, getWalkthrough } from "@/lib/queries";
import { LiveBond, Reveals, type LiveBondItem } from "@/components/landing/LandingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ARCSCAN = "https://testnet.arcscan.app";
const BROKER = "0xDAdaDA4E8038641212262Fd94E816d4A57CDC751"; // ROOT keystore — posts the bonds
const USDC = "0x3600000000000000000000000000000000000000";
const fx = (n: number, d = 3) => n.toFixed(d);
const trunc = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const hhmmss = (iso: string) => iso.slice(11, 19);

function Tx({ tx, slash }: { tx: string | null; slash?: boolean }) {
  if (!tx) return <span className="tx mono" style={{ opacity: 0.55 }}>off-chain</span>;
  return (
    <a className={`tx mono${slash ? " tx--slash" : ""}`} href={`${ARCSCAN}/tx/${tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">
      tx {trunc(tx)} ↗
    </a>
  );
}

function Obol({ cls }: { cls: string }) {
  return <svg className={`obol ${cls}`} viewBox="0 0 64 64" aria-hidden="true"><use href="#obol-art" /></svg>;
}

export default async function Landing() {
  const [totals, feed, walk] = await Promise.all([getTotals(), getFeed(24), getWalkthrough()]);
  const p = walk.pass, s = walk.slash;

  // only genuinely bonded matches on the hero + board — a best-effort row ("0.000 at stake") would
  // undercut the point. Enough remain (matchesSettled is dominated by bonded matches).
  const bonded = feed.filter((r) => (r.bond ?? 0) > 0);
  const liveBonds: LiveBondItem[] = bonded
    .slice(0, 5)
    .map((r) => ({ task: r.task, amt: fx(r.bond ?? 0), conf: (r.confidence ?? 0).toFixed(2), provider: r.provider, tx: r.tx, verdict: r.status }));

  const floorStrip = `${totals.openCount} bond${totals.openCount === 1 ? "" : "s"} open · ${fx(totals.bondsAtRisk)} USDC at stake · ${totals.matchesSettled} settled · ${totals.slashedCount} slashed`;
  const boardStrip = `${totals.matchesSettled} matches settled · ${totals.slashedCount} slashed · ${fx(totals.usdcSettled)} USDC moved`;
  const slashComp = s ? s.price + s.bond : 0;

  return (
    <div className="lv2" id="top">
      {/* ═════ header ═════ */}
      <header className="site-head">
        <Link className="brand" href="#top" aria-label="ENGYE home">
          <Obol cls="obol--sm" /><span className="wordmark">ENGYE</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <a href="#follow">The bond</a>
          <a href="#agora">The agora</a>
          <Link href="/providers">Providers</Link>
        </nav>
        <div className="head-right">
          <span className="net-chip">ARC TESTNET</span>
          <Link className="btn btn--ink btn--sm" href="/hire">Hire the broker</Link>
        </div>
      </header>
      <div className="meander" role="presentation" />

      {/* ═════ S1 · hero ═════ */}
      <section className="hero">
        <div className="hero-copy">
          <p className="greek-line"><span className="greek" translate="no">ἐγγύη</span> <span className="greek-def">— engýē, the pledge of surety, given in the agora.</span></p>
          <h1 className="claim">The first AI you can hire that stakes <em>its own money</em> on its work.</h1>
          <p className="manifesto">&ldquo;The next economy&apos;s transactions won&apos;t be signed by humans. They&apos;ll be underwritten by agents.&rdquo;</p>
          <p className="support">ENGYE quotes your task, posts a USDC bond on Arc, and lets a public validator rule. Pass — the bond comes home. Fail — it&apos;s slashed and paid to you.</p>
          <div className="cta-row">
            <Link className="btn btn--ink" href="/hire">Hire the broker</Link>
            <a className="btn btn--ghost" href="#follow">Follow one bond ↓</a>
          </div>
        </div>
        <LiveBond bonds={liveBonds} floor={floorStrip} />
      </section>
      <div className="meander" role="presentation" />

      {/* ═════ S2 · problem ═════ */}
      <section className="problem panel-ink">
        <div className="measure">
          <p className="inscription inscription--lift">I · THE PROBLEM</p>
          <ol className="problem-list">
            <li data-reveal><span className="pnum mono">α.</span> Agents are unaccountable — a refund is a support ticket, not a protocol.</li>
            <li data-reveal style={{ "--d": ".08s" } as React.CSSProperties}><span className="pnum mono">β.</span> Output is unverifiable — you learn it failed after you&apos;ve paid.</li>
            <li data-reveal style={{ "--d": ".16s" } as React.CSSProperties}><span className="pnum mono">γ.</span> Failure costs the buyer. Never the agent.</li>
          </ol>
          <p className="problem-kicker" data-reveal style={{ "--d": ".24s" } as React.CSSProperties}>In the agora, a pledge without surety was noise. The Greeks fixed this — <span className="greek greek--lift" translate="no">ἐγγύη</span>, the guarantor&apos;s bond. We ported it to Arc.</p>
        </div>
      </section>
      <div className="meander" role="presentation" />

      {/* ═════ S3 · follow one bond ═════ */}
      <section className="follow" id="follow">
        <div className="measure">
          <p className="inscription">II · FOLLOW ONE BOND</p>
          <h2 className="section-lede">One real task, traced through the ledger.</h2>
          <p className="section-sub">Every step below landed on Arc. Hashes link to Arcscan.</p>

          <ol className="ledger">
            <li className="step" data-reveal>
              <div className="step-head"><span className="step-label">QUOTE</span><span className="tx mono">broker decision · local</span></div>
              <pre className="code mono">{`{
  "task":       ${JSON.stringify(p?.task ?? "task")},
  "provider":   ${JSON.stringify(p?.provider ?? "provider")},
  "price":      "${fx(p?.price ?? 0, 4)} USDC",
  "confidence": ${(p?.conf ?? 0).toFixed(2)},
  "bond":       "${fx(p?.bond ?? 0)} USDC"
}`}</pre>
              <p className="step-note">The broker prices its own certainty. Low confidence, bigger bond — or no quote at all.</p>
            </li>

            <li className="step" data-reveal>
              <div className="step-head"><span className="step-label">BOND POSTED</span><Tx tx={p?.bondTx ?? null} /></div>
              <div className="bond-row mono"><Obol cls="obol--row" /> {fx(p?.bond ?? 0)} USDC locked in escrow</div>
              <p className="step-note">Its money, not yours. The stake sits on Arc before any work starts.</p>
            </li>

            <li className="step" data-reveal>
              <div className="step-head"><span className="step-label">PAYMENT · x402</span><span className="tx mono">gasless · Gateway batched</span></div>
              <pre className="code mono"><span className="dim">POST /task</span>{"\n"}<span className="dim">← 402 Payment Required</span>{"\n"}{`X-PAYMENT  ${fx(p?.price ?? 0, 4)} USDC → ${p?.provider ?? "provider"}`}{"\n"}<span className="ok">← 200 OK · deliverable received</span></pre>
              <p className="step-note">Paid by wire, not by invoice — gasless x402, settled in a Circle Gateway batch.</p>
            </li>

            <li className="step" data-reveal>
              <div className="step-head"><span className="step-label">VERDICT</span><Tx tx={p?.verdictTx ?? null} /></div>
              <div className="meter" role="img" aria-label={`Validator score ${p?.score ?? 0} of 100, pass threshold 60`}>
                <div className="meter-fill" style={{ "--w": `${Math.min(100, p?.score ?? 0)}%` } as React.CSSProperties} />
                <div className="meter-notch" style={{ "--x": "60%" } as React.CSSProperties} />
              </div>
              <div className="meter-caption mono">score {p?.score ?? 0}/100 ≥ 60 threshold <span className="seal seal--ok seal--inline" data-stamp>VALIDATED</span></div>
              <p className="step-note">A blind validator (an ERC-8004 validationResponse, on-chain) scores the work against the spec. It doesn&apos;t know whose money is at stake.</p>
            </li>

            <li className="step" data-reveal>
              <div className="step-head"><span className="step-label">SETTLE</span><Tx tx={p?.settleTx ?? null} /></div>
              <div className="bond-row mono">{fx(p?.bond ?? 0)} USDC released — the bond comes home <span className="seal seal--ok seal--inline" data-stamp>SETTLED</span></div>
              <p className="step-note">Pass: everyone is paid, the ledger closes clean.</p>
            </li>
          </ol>

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
                <div className="slash-row mono">{s?.task ?? "task"}: {(s?.spec ?? "").slice(0, 34) || "—"} · {s?.provider ?? "provider"} · {fx(s?.bond ?? 0)} USDC · <b>{s?.score ?? 0}/100</b></div>
                <div className="slash-comp">
                  <span className="seal seal--slash seal--inline" id="slashSeal">SLASHED</span>
                  <span className="comp-line mono">→ buyer compensated <b id="compAmt" data-from={fx(s?.price ?? 0, 4)} data-to={fx(slashComp, 4)}>{fx(slashComp, 4)}</b> USDC</span>
                  <span className="comp-sub mono">price refunded + bond forfeited · <Tx tx={(s?.refundTx ?? s?.slashTx) ?? null} slash /></span>
                </div>
              </div>
            </div>
            <p className="slash-caption">An AI that answers for its work — in money, not apologies.</p>
            <button className="replay mono" id="replayBtn" type="button">↻ replay the slash</button>
          </div>
        </div>
      </section>
      <div className="meander" role="presentation" />

      {/* ═════ S4 · agora board ═════ */}
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
              {bonded.slice(0, 6).map((r) => (
                <tr key={r.id} className={r.status === "SLASHED" ? "row-slashed" : undefined}>
                  <td className="dim">{hhmmss(r.created_at)}</td>
                  <td>{r.task}</td>
                  <td>{r.provider}</td>
                  <td className="num">{fx(r.bond ?? 0)}</td>
                  <td>
                    {r.status === "PASS" && <span className="seal seal--ok seal--board">SETTLED</span>}
                    {r.status === "SLASHED" && <><span className="seal seal--slash seal--board">SLASHED</span><span className="board-comp">→ buyer +{fx((r.bond ?? 0) + (r.price ?? 0), 4)}</span></>}
                    {r.status === "OPEN" && <span className="board-open">OPEN · awaiting verdict</span>}
                  </td>
                  <td>{r.tx ? <a className="tx" href={`${ARCSCAN}/tx/${r.tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">{r.tx.slice(0, 6)}… ↗</a> : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="board-strip mono">{boardStrip}</p>
        </div>
      </section>
      <div className="meander" role="presentation" />

      {/* ═════ S5 · enter the agora ═════ */}
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
              <pre className="code code--curl mono">{`curl -X POST engye.vercel.app/api/registry \\
  -d '{"endpoint_url":"https://api.you.dev/task",
       "price_usdc":0.05,"wallet_address":"0x…"}'`}</pre>
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

      {/* ═════ S6 · colophon ═════ */}
      <footer className="colophon panel-ink">
        <div className="meander meander--lift" role="presentation" />
        <div className="wide colophon-grid">
          <div className="colophon-brand">
            <Obol cls="obol--foot" />
            <div>
              <span className="wordmark wordmark--foot">ENGYE</span>
              <p className="colophon-tag"><span className="greek greek--lift" translate="no">ἐγγύη</span> — the surety layer of the agent economy.</p>
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
          <span>BROKER <a className="tx" href={`${ARCSCAN}/address/${BROKER}`} target="_blank" rel="noreferrer">{trunc(BROKER)} ↗</a></span>
          <span>USDC · ARC TESTNET <a className="tx" href={`${ARCSCAN}/address/${USDC}`} target="_blank" rel="noreferrer">{trunc(USDC)} ↗</a></span>
          <span className="colophon-struck">STRUCK AT THE LEPTON AGENTS HACKATHON · MMXXVI · CANTEEN × CIRCLE × ARC</span>
        </div>
      </footer>

      {/* shared line-art defs: the obol, drawn */}
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

      <Reveals />
    </div>
  );
}
