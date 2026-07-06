"use client";
// Public match receipt — spec, deliverable, broker reasoning, verdict, full on-chain tx timeline.
// Countdown while the verdict is pending; realtime flip when settle() lands; a permissionless
// "settle now" poke once the verdict window is >60s overdue (anyone may call /api/settle).
// Skinned to the handoff: kicker + stamped seals + .quote-card + .code + a chiselled tx timeline.
import { useEffect, useState, type CSSProperties } from "react";
import { supabasePublic, txUrl } from "@/lib/supabase/public";
import { VERDICT_WINDOW_SECONDS } from "@/lib/economics";
import { TERMINAL as TERMINAL_STATUSES, outcome } from "@/lib/matchLifecycle";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

type Task = { type?: string; spec?: string; max_price_usdc?: number; quality_bar?: string } | null;
type Quote = {
  task: Task; confidence: number | null; bond_usdc: number | null;
  total_price_usdc: number | null; reasoning: string | null;
} | null;
type Validation = { pass: boolean; score: number | null; reasons: unknown; model: string | null };

export type MatchRow = {
  status: string;
  match_key: string;
  verdict_due_at: string | null;
  bond_usdc: number | null;
  price_usdc: number | null;
  bond_tx: string | null;
  settle_tx: string | null;
  pay_tx: string | null;
  refund_tx: string | null;
  stake_slash_tx: string | null;
  validation_request_tx: string | null;
  validation_response_tx: string | null;
  feedback_tx: string | null;
  deliverable: unknown;
  decision_json: unknown;
  created_at: string;
  quotes: Quote;
  providers: { name: string } | null;
  validations: Validation[] | null;
};

// keep in lockstep with the server page's select() — used to refresh joins on realtime UPDATEs
const SELECT = "*, quotes(task,confidence,bond_usdc,total_price_usdc,reasoning), providers(name), validations(pass,score,reasons,model)";

const TERMINAL = new Set<string>(TERMINAL_STATUSES);
const sealFor = (status: string) => outcome({ status }) === "slashed" ? "seal-slashed" : TERMINAL.has(status) ? "seal-pass" : "seal-open";
const sealText = (status: string) => outcome({ status }) === "slashed" ? "SLASHED" : TERMINAL.has(status) ? "PASS" : "OPEN";

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const fx = (n: number | null): string => (n != null ? Number(n).toFixed(3) : "—");
const fmtUsdc = (n: number | null): string | undefined => (n != null ? `${fx(n)} USDC` : undefined);

// The on-chain stepper — one step per real tx column on the row. `tone` colours money-moving steps
// whose direction depends on the verdict (Settle releases OR slashes; Refund only fires on fail).
type TxStep = { label: string; tx: string | null; amount?: string; tone?: string };
function txSteps(m: MatchRow, passed: boolean | null): TxStep[] {
  const bondAmount = fmtUsdc(m.bond_usdc);
  const priceAmount = fmtUsdc(m.price_usdc);
  const settleTone = passed == null ? undefined : passed ? "var(--pass)" : "var(--slash)";
  return [
    { label: "Bond", tx: m.bond_tx, amount: bondAmount },
    { label: "Validation request", tx: m.validation_request_tx },
    { label: "Provider paid", tx: m.pay_tx, amount: priceAmount },
    { label: "Validation response", tx: m.validation_response_tx },
    { label: "Settle", tx: m.settle_tx, amount: bondAmount, tone: settleTone },
    { label: "Refund", tx: m.refund_tx, amount: priceAmount, tone: "var(--slash)" },
    { label: "Stake slash", tx: m.stake_slash_tx },
    { label: "Feedback", tx: m.feedback_tx },
  ];
}

export function MatchDetail({ initial, matchKey }: { initial: MatchRow; matchKey: string }) {
  const [m, setM] = useState<MatchRow>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [poking, setPoking] = useState(false);

  const terminal = TERMINAL.has(m.status);

  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [terminal]);

  useEffect(() => {
    const sb = supabasePublic();
    const ch = sb
      .channel(`match-${matchKey}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `match_key=eq.${matchKey}` },
        async () => {
          const { data } = await sb.from("matches").select(SELECT).eq("match_key", matchKey).maybeSingle();
          if (data) setM(data as MatchRow);
        },
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [matchKey]);

  const task = m.quotes?.task ?? null;
  const validation = m.validations?.[0] ?? null;
  const dueAtMs = m.verdict_due_at ? new Date(m.verdict_due_at).getTime() : null;
  const msLeft = dueAtMs != null ? dueAtMs - now : null;
  const overdue = msLeft != null && msLeft < -60_000;
  const progress = msLeft != null ? Math.min(1, Math.max(0, msLeft / (VERDICT_WINDOW_SECONDS * 1000))) : 0;
  // ground truth for "which way the money moved" — tied to m.status (mirrors the seal), so an
  // unbonded best-effort delivery ("delivered") never renders the slashed copy.
  const passed = terminal ? outcome(m) !== "slashed" : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760, margin: "0 auto" }}>
      <div className="page-head" style={{ paddingBottom: 0 }}>
        <p className="kicker">Match Receipt</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ margin: 0, overflowWrap: "anywhere" }}>{task?.type ?? "task"}</h1>
          <span className={`seal ${sealFor(m.status)}`}>{sealText(m.status)}</span>
        </div>
        <hr className="ledger-rule" />
      </div>

      <div className="quote-card">
        <div className="quote-grid">
          <div><div className="q-label">provider</div><div className="q-value">{m.providers?.name ?? "—"}</div></div>
          <div><div className="q-label">confidence ĉ</div><div className="q-value">{m.quotes?.confidence != null ? m.quotes.confidence.toFixed(2) : "—"}</div></div>
          <div><div className="q-label">bond</div><div className="q-value accent">{fx(m.bond_usdc)} USDC</div></div>
          <div><div className="q-label">price</div><div className="q-value">{fx(m.price_usdc)} USDC</div></div>
        </div>
      </div>

      {task?.spec && (
        <div className="card">
          <div className="q-label" style={{ marginBottom: 10 }}>Task spec</div>
          <pre className="code" style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.spec}</pre>
        </div>
      )}

      {m.deliverable != null && (
        <div className="card">
          <div className="q-label" style={{ marginBottom: 10 }}>Deliverable</div>
          <pre className="code" style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(m.deliverable, null, 2)}</pre>
        </div>
      )}

      {m.quotes?.reasoning && (
        <div className="card">
          <div className="q-label" style={{ marginBottom: 10 }}>Broker&apos;s reasoning</div>
          <p style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, margin: 0 }}>{m.quotes.reasoning}</p>
        </div>
      )}

      <div className="card" style={terminal && passed != null ? { borderColor: passed ? "var(--pass)" : "var(--slash)" } : undefined}>
        <div className="q-label" style={{ marginBottom: 10 }}>Verdict</div>
        <div aria-live="polite">
          {!terminal ? (
            <div className="animate-in fade-in duration-300" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: "var(--text-sm)" }}>
                {msLeft != null ? (
                  msLeft > 0
                    ? <span style={{ fontWeight: 500 }}>verdict in <span style={mono}>{fmtClock(msLeft)}</span></span>
                    : <span style={{ fontWeight: 500 }}>verdict overdue by <span style={{ ...mono, color: "var(--accent-ink)" }}>{fmtClock(-msLeft)}</span></span>
                ) : <span className="muted">Awaiting delivery…</span>}
                <span className="small muted" style={{ marginLeft: "auto" }}>the validator rules publicly</span>
              </div>
              {msLeft != null && (
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-raised)", overflow: "hidden" }}>
                  <div className="bar-fill" style={{ height: "100%", width: "100%", background: "var(--accent)", transformOrigin: "left center", transform: `scaleX(${progress})`, transition: "transform 1s linear" }} />
                </div>
              )}
              {overdue && (
                <button className="btn btn-ghost btn-sm" disabled={poking} aria-disabled={poking}
                  onClick={async () => { setPoking(true); await fetch("/api/settle", { method: "POST" }); setPoking(false); }}>
                  {poking ? "Settling…" : "Settle now (anyone may)"}
                </button>
              )}
            </div>
          ) : validation ? (
            <div className="animate-in fade-in zoom-in-95 duration-300" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className={`seal ${sealFor(m.status)}`}>{sealText(m.status)}</span>
                <span className="small muted" style={{ marginLeft: "auto" }}>
                  ruled by <span style={mono}>{validation.model ?? "—"}</span>
                  {validation.score != null && <> · score <span style={mono}>{validation.score}</span></>}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
                {passed
                  ? "Bond released — the broker kept its stake. The work passed the spec."
                  : <>Slashed — you were paid{" "}
                    <span style={{ ...mono, color: "var(--slash)" }}>
                      {m.price_usdc != null && m.bond_usdc != null ? (Number(m.price_usdc) + Number(m.bond_usdc)).toFixed(3) : "—"} USDC
                    </span>{" "}(price + bond), plus a cut of the provider&apos;s stake.
                  </>}
              </p>
              {validation.reasons != null && (
                <pre className="code" style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {typeof validation.reasons === "string" ? validation.reasons : JSON.stringify(validation.reasons, null, 2)}
                </pre>
              )}
            </div>
          ) : <div className="small muted">No validation recorded.</div>}
        </div>
      </div>

      <div className="card">
        <div className="q-label" style={{ marginBottom: 10 }}>On-chain timeline</div>
        <div>
          {txSteps(m, passed).map((s, i, arr) => {
            const last = i === arr.length - 1;
            const done = !!s.tx;
            const url = txUrl(s.tx);
            return (
              <div key={s.label} style={{ display: "flex", gap: 12 }}>
                <div style={{ position: "relative", width: 16, flexShrink: 0 }}>
                  <span style={{ position: "relative", zIndex: 1, display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 999, background: done ? (s.tone ?? "var(--ink)") : "transparent", border: done ? "none" : "2px solid var(--line-strong)", color: "var(--bg)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                    {done ? "✓" : ""}
                  </span>
                  {!last && <span style={{ position: "absolute", left: 7, top: 18, bottom: -6, width: 2, background: "var(--line)" }} />}
                </div>
                <div style={{ paddingBottom: last ? 0 : 18, flex: 1, marginTop: -1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <span className="min-w-0" style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: done ? "var(--ink)" : "var(--muted)" }}>{s.label}</span>
                    {url && <a className="tx-link" href={url} target="_blank" rel="noreferrer" title={`View ${s.label} on Arcscan`} style={{ flexShrink: 0 }}>↗</a>}
                    {s.amount && <span style={{ ...mono, fontSize: "var(--text-xs)", color: s.tone ?? "var(--muted)", marginLeft: "auto", flexShrink: 0 }}>{s.amount}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }} className="small muted">
        <span className="min-w-0" style={{ ...mono, wordBreak: "break-all", overflowWrap: "anywhere", minWidth: 0 }} title={m.match_key}>{m.match_key}</span>
        <span>bonded by ENGYE</span>
      </div>
    </div>
  );
}
