"use client";
// Public match receipt — spec, deliverable, broker reasoning, verdict, full on-chain tx timeline.
// Countdown while the verdict is pending; realtime flip when settle() lands; a permissionless
// "settle now" poke once the verdict window is >60s overdue (anyone may call /api/settle).
import { useEffect, useState, type CSSProperties } from "react";
import { Card, Badge, Eyebrow, Button } from "@/components/ui/primitives";
import { supabasePublic, txUrl } from "@/lib/supabase/public";

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

const TX_ROWS: Array<[string, keyof MatchRow]> = [
  ["Bond", "bond_tx"],
  ["Validation request", "validation_request_tx"],
  ["Provider paid", "pay_tx"],
  ["Validation response", "validation_response_tx"],
  ["Settle", "settle_tx"],
  ["Refund", "refund_tx"],
  ["Stake slash", "stake_slash_tx"],
  ["Feedback", "feedback_tx"],
];

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Eyebrow>Match receipt</Eyebrow>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>{task?.type ?? "task"}</div>
        </div>
        <Badge status={badgeStatus(m.status)} />
      </div>

      <Card padding={20}>
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

      <Card padding={20}>
        <Eyebrow style={label}>Verdict</Eyebrow>
        {!terminal ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            {msLeft != null ? (
              <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
                {msLeft > 0
                  ? <>Verdict due in <span style={{ ...mono, color: "var(--foreground)" }}>{fmtClock(msLeft)}</span></>
                  : <>Verdict overdue by <span style={{ ...mono, color: "var(--gold-lifted)" }}>{fmtClock(-msLeft)}</span></>}
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Awaiting delivery…</div>
            )}
            {overdue && (
              <Button
                size="sm" variant="outline" disabled={poking}
                onClick={async () => { setPoking(true); await fetch("/api/settle", { method: "POST" }); setPoking(false); }}
              >
                {poking ? "Settling…" : "Settle now (anyone may)"}
              </Button>
            )}
          </div>
        ) : validation ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={row}>
              <span style={{ color: "var(--muted-foreground)" }}>Result</span>
              <span>{validation.pass ? "PASS" : "FAIL"}{validation.score != null ? ` · score ${validation.score}` : ""}</span>
            </div>
            <div style={validation.reasons != null ? row : lastRow}>
              <span style={{ color: "var(--muted-foreground)" }}>Validator model</span>
              <span>{validation.model ?? "—"}</span>
            </div>
            {validation.reasons != null && (
              <pre style={{ ...pre, marginTop: 10 }}>
                {typeof validation.reasons === "string" ? validation.reasons : JSON.stringify(validation.reasons, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No validation recorded.</div>
        )}
      </Card>

      <Card padding={20}>
        <Eyebrow style={label}>On-chain timeline</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {TX_ROWS.map(([txLabel, key], i) => {
            const hash = m[key] as string | null;
            const url = txUrl(hash);
            const style = i === TX_ROWS.length - 1 ? lastRow : row;
            return (
              <div key={key} style={style}>
                <span style={{ color: "var(--muted-foreground)" }}>{txLabel}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
                    {hash!.slice(0, 10)}…{hash!.slice(-6)}
                  </a>
                ) : (
                  <span style={{ color: "var(--muted-foreground)" }}>—</span>
                )}
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
