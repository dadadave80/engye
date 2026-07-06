"use client";
// Renders get_quote tool output; Accept pays via the caller's rail. The card's numbers come from
// the tool payload only — the model cannot alter them. The bonded state IS the product's flagship
// component — rebuilt to the handoff .quote-card (stele double rule, quote-grid, verdigris accent).
import { useState, type CSSProperties } from "react";
import { KeyRound } from "lucide-react";
import { WalletControl } from "../wallet/WalletControl";
import { useWallet } from "../wallet/useWallet";
import { useWalletClient } from "wagmi";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { payForQuote } from "../wallet/passkeyClient";
import { usePasskey } from "../wallet/passkey";
import { VerdictWatch } from "./VerdictWatch";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const fx = (n: number) => n.toFixed(3);

type ExecuteResult = {
  match_id: string; match_key: string; status: string; deliverable?: unknown;
  verdict_due_at?: string; watch_url?: string; bond_tx?: string; tier?: string;
};

/* Render a deliverable readably. Providers return { provider, answer } — show the `answer` as prose;
   if it's itself JSON (e.g. the sidecar's settlement statement) pretty-print that; else raw JSON. */
function Deliverable({ value }: { value: unknown }) {
  const answer = value && typeof value === "object" && "answer" in value && typeof (value as { answer?: unknown }).answer === "string"
    ? (value as { answer: string }).answer : undefined;
  if (answer !== undefined) {
    let pretty: string | null = null;
    try { const p = JSON.parse(answer); if (p && typeof p === "object") pretty = JSON.stringify(p, null, 2); } catch { /* prose */ }
    return <pre className="code" style={{ marginTop: 14, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: pretty ? "var(--font-mono)" : "var(--font-ui)" }}>{pretty ?? answer}</pre>;
  }
  return <pre className="code" style={{ marginTop: 14, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(value, null, 2)}</pre>;
}

export function QuoteCard({ output }: { output: Record<string, unknown> }) {
  const wallet = useWallet();
  const { current } = usePasskey();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  if (output.error) {
    return <div className="quote-card" style={{ borderColor: "var(--line)" }}><span className="small muted">{String(output.error)}</span></div>;
  }

  if (output.declined) {
    return (
      <div className="quote-card" style={{ borderColor: "var(--line)" }}>
        <div className="quote-head" style={{ color: "var(--muted)" }}>Declined</div>
        <p style={{ margin: "10px 0 0", fontSize: "var(--text-sm)", lineHeight: 1.5, color: "var(--ink)", textWrap: "pretty" }}>
          {String(output.reason ?? "I won't bond this one — the spec is underspecified and I can't price my confidence honestly.")}
        </p>
        <p className="small muted" style={{ margin: "8px 0 0" }}>No bond, no charge. Refine the ask and I&apos;ll quote again.</p>
      </div>
    );
  }

  const q = output as { quote_id: string; action: "accept" | "best_effort_offer"; provider_name?: string; confidence: number; bond_usdc: number; total_price_usdc: number; expires_at: string };
  const bonded = q.action === "accept";
  const passkey = wallet.kind === "passkey";

  async function accept() {
    setBusy(true); setErr(null);
    try {
      let res: Response;
      if (wallet.kind === "passkey" && current) {
        const hash = await payForQuote(current, q.quote_id);
        res = await fetch(`/api/broker/execute/${q.quote_id}`, { method: "POST", headers: { "content-type": "application/json", "x-engye-payment-tx": hash }, body: "{}" });
      } else if (wallet.kind === "eoa" && walletClient) {
        await ensureGatewayFloat(walletClient, Math.max(0.5, q.total_price_usdc * 4));
        res = await payX402(walletClient, `/api/broker/execute/${q.quote_id}`, { method: "POST", body: "{}" });
      } else throw new Error("connect first");
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "execution failed");
      setResult(body as ExecuteResult);
    } catch (e) { setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(false); }
  }

  if (result) {
    const steps = bonded
      ? [{ label: "Bond posted", done: true }, { label: "Provider paid", done: true }, { label: "Deliverable ready", done: !!result.deliverable }]
      : [{ label: "Provider paid", done: true }, { label: "Deliverable ready", done: !!result.deliverable }];
    return (
      <div className="quote-card">
        {bonded && <div className="quote-head">Accepted · bonded</div>}
        {!bonded && <div className="quote-head" style={{ color: "var(--muted)" }}>Accepted</div>}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 6, margin: "12px 0 14px" }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Task underwritten</span>
          {bonded && <span style={{ ...mono, fontSize: "var(--text-sm)", color: "var(--accent-ink)" }}>{fx(q.bond_usdc)} USDC staked</span>}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "var(--text-sm)", color: s.done ? "var(--ink)" : "var(--muted)" }}>
              <span style={{ color: s.done ? "var(--pass)" : "var(--muted)", fontFamily: "var(--font-mono)" }}>{s.done ? "✓" : "·"}</span>
              {s.label}
            </li>
          ))}
        </ul>
        {result.deliverable !== undefined && <Deliverable value={result.deliverable} />}
        <div style={{ marginTop: 14 }}>
          {result.status === "delivered_awaiting_verdict" && result.verdict_due_at
            ? <VerdictWatch matchKey={result.match_key} dueAt={result.verdict_due_at} bondTx={result.bond_tx} />
            : <div className="small muted">delivered (best-effort tier — no bond, no public verdict)</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="quote-card">
      <div className="quote-head" style={bonded ? undefined : { color: "var(--muted)" }}>{bonded ? "Bonded Quote" : "Best effort — no bond"}</div>
      {bonded && (
        <p className="greek" style={{ margin: "8px 0 0", fontSize: "var(--text-base)", color: "var(--muted)" }}>
          The oracle says {q.confidence.toFixed(2)}. Care to disagree?
        </p>
      )}
      <div className="quote-grid">
        {q.provider_name && <div><div className="q-label">provider</div><div className="q-value">{q.provider_name}</div></div>}
        <div><div className="q-label">calibration ĉ</div><div className="q-value">{q.confidence.toFixed(2)}</div></div>
        <div><div className="q-label">price</div><div className="q-value">{fx(q.total_price_usdc)} USDC</div></div>
        {bonded && <div><div className="q-label">bond</div><div className="q-value accent">{fx(q.bond_usdc)} USDC</div></div>}
      </div>
      <p className="small muted" style={{ margin: "0 0 0.25rem" }}>
        {bonded ? "If the validator fails the work, you're paid price + bond — on-chain, not a support ticket." : "No bond posted. You pay the price only; no failure payout."}
      </p>
      {wallet.connected ? (
        <div className="quote-actions">
          <button className="btn btn-primary" type="button" onClick={accept} disabled={busy} aria-disabled={busy}>
            {passkey && <KeyRound size={14} aria-hidden="true" />}
            {busy ? "Paying…" : `Accept · ${fx(q.total_price_usdc)} USDC${passkey ? " · Passkey" : ""}`}
          </button>
        </div>
      ) : (
        <div className="quote-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <WalletControl />
          <p className="small muted" style={{ margin: 0 }}>No wallet? A passkey account takes one tap — first tasks sponsored.</p>
        </div>
      )}
      <div className="small" style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
        {err ? <span style={{ color: "var(--slash)" }}>{err}</span> : <span />}
        <span className="muted">expires {new Date(q.expires_at).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
