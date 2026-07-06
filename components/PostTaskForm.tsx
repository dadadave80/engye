"use client";
// The hero flow: a human requester connects (passkey), gets a live bonded quote, and pays from
// their own account. On failure the bond + refund land back on-chain. Disconnected → the handoff
// .gate + a dimmed preview that mirrors the real form exactly; connected → the real .card form.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletClient } from "wagmi";
import { KeyRound } from "lucide-react";
import { ConnectGate } from "./ConnectGate";
import { useWallet } from "./wallet/useWallet";
import { usePasskey } from "./wallet/passkey";
import { payForQuote } from "./wallet/passkeyClient";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { ARCSCAN } from "@/lib/clientChain";

// Only types with a registered provider capability — so a posted task actually gets a bonded quote
// instead of an EV-gate decline. (See scripts/seed-providers capabilities.)
const TASK_TYPES = [
  { value: "question-answering", label: "Answer a question" },
  { value: "summarization", label: "Summarize a link" },
  { value: "lookup", label: "Look something up" },
  { value: "structured-output", label: "Extract structured data" },
];

type Quote =
  | { declined: true; reason: string }
  | { declined: false; quote_id: string; action: string; provider_id: string; provider_name?: string; confidence: number; bond_usdc: number; total_price_usdc: number; reasoning_summary: string };

const fx = (n: number) => n.toFixed(3);

// The dimmed after-connect preview — the SAME fields the real form renders, just disabled. No fake
// controls (the verdict window is a fixed ~2 min, shown as a note, not a selector).
function PostPreview() {
  return (
    <div className="preview">
      <p className="preview-label">Preview — after you connect</p>
      <div className="card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pv-type">Task type</label>
            <select id="pv-type" disabled>{TASK_TYPES.map((t) => <option key={t.value}>{t.label}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="pv-price">Max price</label>
            <div className="input-suffix"><input type="number" id="pv-price" disabled placeholder="0.010" /><span className="suffix">USDC</span></div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pv-spec">Spec</label>
          <textarea id="pv-spec" rows={3} disabled placeholder="What does good look like? The validator scores against exactly this." />
          <p className="hint">The validator scores the deliverable against exactly this. Verdict window ~2 minutes.</p>
        </div>
        <button className="btn btn-primary" type="button" disabled aria-disabled>Get bonded quote</button>
      </div>
    </div>
  );
}

export function PostTaskForm() {
  const router = useRouter();
  const wallet = useWallet();
  const { current } = usePasskey();
  const { data: walletClient } = useWalletClient();
  const passkey = wallet.kind === "passkey";
  const [type, setType] = useState(TASK_TYPES[0].value);
  const [spec, setSpec] = useState("");
  const [maxPrice, setMaxPrice] = useState("0.010");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function getQuote() {
    setBusy("quote"); setErr(null); setResult(null); setQuote(null);
    try {
      const res = await fetch("/api/broker/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: { type, spec, max_price_usdc: Number(maxPrice) }, requester_wallet: wallet.address }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.error ?? "quote failed");
      setQuote(body);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function payAndExecute() {
    if (!quote || quote.declined) return;
    setBusy("pay"); setErr(null);
    try {
      // dual-rail, matching /hire's QuoteCard: passkey pays via a userOp bound to the quote; an EOA
      // tops up its Gateway float and pays via browser x402. (EOA disabled this version.)
      let res: Response;
      if (wallet.kind === "passkey" && current) {
        const hash = await payForQuote(current, quote.quote_id);
        res = await fetch(`/api/broker/execute/${quote.quote_id}`, { method: "POST", headers: { "content-type": "application/json", "x-engye-payment-tx": hash }, body: "{}" });
      } else if (wallet.kind === "eoa" && walletClient) {
        await ensureGatewayFloat(walletClient, Math.max(0.5, quote.total_price_usdc * 4));
        res = await payX402(walletClient, `/api/broker/execute/${quote.quote_id}`, { method: "POST", body: "{}" });
      } else throw new Error("connect a passkey first");
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "execution failed");
      setResult(body);
      if (body.match_key) router.push(`/m/${body.match_key}`);
    } catch (e) { setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(null); }
  }

  if (!wallet.connected) {
    return (
      <>
        <ConnectGate title="Connect to post">A posted task is escrowed up front; the broker only quotes what it can honestly price.</ConnectGate>
        <PostPreview />
      </>
    );
  }

  return (
    <>
      <div className="card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="t-type">Task type</label>
            <select id="t-type" value={type} onChange={(e) => setType(e.target.value)}>
              {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-price">Max price</label>
            <div className="input-suffix"><input type="number" id="t-price" className="input-mono" step="0.001" min="0.001" placeholder="0.010" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /><span className="suffix">USDC</span></div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="t-spec">Spec</label>
          <textarea id="t-spec" rows={3} placeholder="What does good look like? The validator scores against exactly this." value={spec} onChange={(e) => setSpec(e.target.value)} />
          <p className="hint">The validator scores the deliverable against exactly this. Verdict window ~2 minutes.</p>
        </div>
        <button className="btn btn-primary" disabled={busy !== null || !spec.trim()} aria-disabled={busy !== null || !spec.trim()} onClick={getQuote}>
          {busy === "quote" ? "Getting quote…" : "Get bonded quote"}
        </button>
      </div>

      {quote && quote.declined && (
        <div className="card" style={{ marginTop: "var(--space-4)" }}><span className="muted">Broker declined: {quote.reason}</span></div>
      )}

      {quote && !quote.declined && !result && (
        <div className="quote-card" style={{ marginTop: "var(--space-4)" }}>
          <div className="quote-head">Bonded Quote</div>
          <div className="quote-grid">
            {quote.provider_name && <div><div className="q-label">provider</div><div className="q-value">{quote.provider_name}</div></div>}
            <div><div className="q-label">confidence ĉ</div><div className="q-value">{quote.confidence.toFixed(2)}</div></div>
            <div><div className="q-label">you pay</div><div className="q-value">{fx(quote.total_price_usdc)} USDC</div></div>
            <div><div className="q-label">bond</div><div className="q-value accent">{fx(quote.bond_usdc)} USDC</div></div>
          </div>
          <p className="small muted" style={{ margin: "0 0 0.5rem" }}>{quote.reasoning_summary}</p>
          <div className="quote-actions">
            <button className="btn btn-primary" disabled={busy !== null} aria-disabled={busy !== null} onClick={payAndExecute}>
              {passkey && <KeyRound size={14} aria-hidden="true" />}
              {busy === "pay" ? "Signing & paying…" : `Pay ${fx(quote.total_price_usdc)} USDC & execute${passkey ? " · Passkey" : ""}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="quote-card" style={{ marginTop: "var(--space-4)" }}>
          <div className="quote-head">Delivered</div>
          <p style={{ margin: "10px 0 0", fontSize: "var(--text-sm)" }}>
            {result.status === "delivered_awaiting_verdict" ? "Opening your match page to watch the verdict…" : "Opening your match page…"}
          </p>
          {result.bond_tx ? <a className="tx-link" href={`${ARCSCAN}/tx/${result.bond_tx}`} target="_blank" rel="noreferrer">bond {(result.bond_tx as string).slice(0, 10)}… ↗</a> : null}
        </div>
      )}

      {err && <div className="card" style={{ marginTop: "var(--space-4)" }}><span className="small" style={{ color: "var(--slash)" }}>{err}</span></div>}
    </>
  );
}
