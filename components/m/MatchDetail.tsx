"use client";
// Public match receipt — spec, deliverable, broker reasoning, verdict, full on-chain tx timeline.
// Countdown while the verdict is pending; realtime flip when settle() lands; a permissionless
// "settle now" poke once the verdict window is >60s overdue (anyone may call /api/settle).
import { useEffect, useState, type CSSProperties } from "react";
import { Check, Clock, ExternalLink } from "lucide-react";
import { Card, Badge, Eyebrow, Button } from "@/components/ui/primitives";
import { supabasePublic, txUrl } from "@/lib/supabase/public";
import { VERDICT_WINDOW_SECONDS } from "@/lib/economics";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, ...mono, fontSize: 14, padding: "8px 0", borderBottom: "1px solid var(--border)" };
const lastRow: CSSProperties = { ...row, borderBottom: "none" };
const pre: CSSProperties = {
  ...mono, fontSize: 13, background: "var(--secondary)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 12, maxHeight: 280, overflow: "auto",
  whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
};
const label: CSSProperties = { display: "block", marginBottom: 10 };

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

const TERMINAL = new Set(["delivered", "failed_compensated"]);

function badgeStatus(status: string): "PASS" | "SLASHED" | "OPEN" {
  if (status === "delivered") return "PASS";
  if (status === "failed_compensated") return "SLASHED";
  return "OPEN"; // pending|bonded|paid|awaiting_verdict|validating|settle_retry|error
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const fmtUsdc = (n: number | null): string | undefined => (n != null ? `${n.toFixed(4)} USDC` : undefined);

// The on-chain stepper (design: TxTimeline) — one step per real tx column already on the row.
// `tone` colors the filled node + amount for money-moving steps whose direction depends on the
// verdict (Settle releases OR slashes the bond; Refund only ever fires on the fail path).
type TxStep = { label: string; tx: string | null; amount?: string; tone?: string };

function txSteps(m: MatchRow, passed: boolean | null): TxStep[] {
  const bondAmount = fmtUsdc(m.bond_usdc != null ? Number(m.bond_usdc) : null);
  const priceAmount = fmtUsdc(m.price_usdc != null ? Number(m.price_usdc) : null);
  const settleTone = passed == null ? undefined : passed ? "var(--laurel)" : "var(--oxblood)";
  return [
    { label: "Bond", tx: m.bond_tx, amount: bondAmount },
    { label: "Validation request", tx: m.validation_request_tx },
    { label: "Provider paid", tx: m.pay_tx, amount: priceAmount },
    { label: "Validation response", tx: m.validation_response_tx },
    { label: "Settle", tx: m.settle_tx, amount: bondAmount, tone: settleTone },
    { label: "Refund", tx: m.refund_tx, amount: priceAmount, tone: "var(--oxblood)" },
    { label: "Stake slash", tx: m.stake_slash_tx },
    { label: "Feedback", tx: m.feedback_tx },
  ];
}

export function MatchDetail({ initial, matchKey }: { initial: MatchRow; matchKey: string }) {
  const [m, setM] = useState<MatchRow>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [poking, setPoking] = useState(false);

  const terminal = TERMINAL.has(m.status);

  // countdown tick — only while a verdict is still outstanding
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [terminal]);

  // realtime: this match's row changed (verdict landed, tx recorded, status flipped) — refetch with joins
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
  // ground truth for "which way did the money move" — tied to m.status (mirrors the Badge), not the
  // raw validation.pass bool, so an unbonded best-effort delivery (always "delivered") never renders
  // the slashed copy just because its validator happened to fail it.
  const passed = terminal ? m.status !== "failed_compensated" : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Eyebrow>Match receipt</Eyebrow>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, margin: 0 }}>{task?.type ?? "task"}</h1>
        </div>
        <Badge status={badgeStatus(m.status)} />
      </div>

      <Card stele padding={20}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Provider</span><span>{m.providers?.name ?? "—"}</span></div>
          <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Confidence ĉ</span><span>{m.quotes?.confidence != null ? m.quotes.confidence.toFixed(2) : "—"}</span></div>
          <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Bond</span><span>{m.bond_usdc != null ? Number(m.bond_usdc).toFixed(4) : "—"} USDC</span></div>
          <div style={lastRow}><span style={{ color: "var(--muted-foreground)" }}>Price</span><span>{m.price_usdc != null ? Number(m.price_usdc).toFixed(4) : "—"} USDC</span></div>
        </div>
      </Card>

      {task?.spec && (
        <Card padding={20}>
          <Eyebrow style={label}>Task spec</Eyebrow>
          <pre style={pre}>{task.spec}</pre>
        </Card>
      )}

      {m.deliverable != null && (
        <Card padding={20}>
          <Eyebrow style={label}>Deliverable</Eyebrow>
          <pre style={pre}>{JSON.stringify(m.deliverable, null, 2)}</pre>
        </Card>
      )}

      {m.quotes?.reasoning && (
        <Card padding={20}>
          <Eyebrow style={label}>Broker&apos;s reasoning</Eyebrow>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{m.quotes.reasoning}</p>
        </Card>
      )}

      <Card
        stele padding={20}
        style={terminal && passed != null
          ? { borderColor: `color-mix(in oklab, ${passed ? "var(--laurel)" : "var(--oxblood)"} 40%, var(--border))` }
          : undefined}
      >
        <Eyebrow style={label}>Verdict</Eyebrow>
        <div aria-live="polite">
        {!terminal ? (
          <div className="animate-in fade-in duration-300" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Clock size={16} color="var(--ring)" aria-hidden="true" />
              {msLeft != null ? (
                msLeft > 0 ? (
                  <span style={{ fontSize: 14, fontWeight: 500 }}>verdict in <span style={mono}>{fmtClock(msLeft)}</span></span>
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 500 }}>verdict overdue by <span style={{ ...mono, color: "var(--gold-lifted)" }}>{fmtClock(-msLeft)}</span></span>
                )
              ) : (
                <span style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Awaiting delivery…</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)" }}>the validator rules publicly</span>
            </div>
            {msLeft != null && (
              <div style={{ height: 4, borderRadius: 2, background: "var(--secondary)", overflow: "hidden" }}>
                <div
                  className="bar-fill"
                  style={{
                    height: "100%", width: "100%", background: "var(--ring)",
                    transformOrigin: "left center", transform: `scaleX(${progress})`, transition: "transform 1s linear",
                  }}
                />
              </div>
            )}
            {overdue && (
              <Button
                size="sm" variant="outline" disabled={poking}
                onClick={async () => { setPoking(true); await fetch("/api/settle", { method: "POST" }); setPoking(false); }}
              >
                {poking ? "Settling…" : "Settle Now (Anyone May)"}
              </Button>
            )}
          </div>
        ) : validation ? (
          <div className="animate-in fade-in zoom-in-95 duration-300" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Badge status={badgeStatus(m.status)} />
              <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginLeft: "auto" }}>
                ruled by <span style={mono}>{validation.model ?? "—"}</span>
                {validation.score != null && <> · score <span style={mono}>{validation.score}</span></>}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>
              {passed
                ? "Bond released — the broker kept its stake. The work passed the spec."
                : <>Slashed — you were paid{" "}
                  <span style={{ ...mono, color: "var(--destructive)" }}>
                    {m.price_usdc != null && m.bond_usdc != null ? (Number(m.price_usdc) + Number(m.bond_usdc)).toFixed(4) : "—"} USDC
                  </span>{" "}
                  (price + bond), plus a cut of the provider&apos;s stake.
                </>}
            </p>
            {validation.reasons != null && (
              <pre style={pre}>
                {typeof validation.reasons === "string" ? validation.reasons : JSON.stringify(validation.reasons, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No validation recorded.</div>
        )}
        </div>
      </Card>

      <Card padding={20}>
        <Eyebrow style={label}>On-chain timeline</Eyebrow>
        <div>
          {txSteps(m, passed).map((s, i, arr) => {
            const last = i === arr.length - 1;
            const done = !!s.tx;
            const url = txUrl(s.tx);
            return (
              <div key={s.label} style={{ display: "flex", gap: 12 }}>
                <div style={{ position: "relative", width: 16, flexShrink: 0 }}>
                  <span style={{
                    position: "relative", zIndex: 1, display: "grid", placeItems: "center",
                    width: 16, height: 16, borderRadius: 999,
                    background: done ? (s.tone ?? "var(--foreground)") : "transparent",
                    border: done ? "none" : "2px solid var(--border)",
                  }}>
                    {done && <Check size={10} color="var(--background)" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  {!last && <span style={{ position: "absolute", left: 7, top: 18, bottom: -6, width: 2, background: "var(--border)" }} />}
                </div>
                <div style={{ paddingBottom: last ? 0 : 18, flex: 1, marginTop: -1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: done ? "var(--foreground)" : "var(--muted-foreground)" }}>{s.label}</span>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" title="View on Arcscan" aria-label={`View ${s.label} on Arcscan`} style={{ color: "var(--link)", display: "inline-flex" }}>
                        <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    )}
                    {s.amount && <span style={{ ...mono, fontSize: 12.5, color: s.tone ?? "var(--muted-foreground)", marginLeft: "auto" }}>{s.amount}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
        <span style={mono} title={m.match_key}>{m.match_key}</span>
        <span>bonded by ENGYE</span>
      </div>
    </div>
  );
}
