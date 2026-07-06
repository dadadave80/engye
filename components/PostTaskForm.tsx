"use client";
// The hero flow: a human requester connects, gets a live bonded quote, and PAYS FROM THEIR
// OWN WALLET (x402/Gateway). On failure the bond + refund land in their wallet on-chain.
// Disconnected → the handoff .gate + a dimmed preview; connected → the real .card form.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectGate } from "./ConnectGate";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { ARCSCAN } from "@/lib/clientChain";

type Quote =
  | { declined: true; reason: string }
  | { declined: false; quote_id: string; action: string; provider_id: string; provider_name?: string; confidence: number; bond_usdc: number; total_price_usdc: number; reasoning_summary: string };

const fx = (n: number) => n.toFixed(3);

function PostPreview() {
  return (
    <div className="preview">
      <p className="preview-label">Preview — after you connect</p>
      <div className="card">
        <div className="field">
          <label htmlFor="pv-type">Task type</label>
          <select id="pv-type" disabled><option>Summarize a link</option><option>Extract JSON</option><option>Draft an email</option><option>Review code</option></select>
        </div>
        <div className="field">
          <label htmlFor="pv-spec">Spec</label>
          <textarea id="pv-spec" rows={3} disabled placeholder="What does good look like? The validator scores against exactly this." />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pv-price">Max price</label>
            <div className="input-suffix"><input type="number" id="pv-price" disabled placeholder="0.010" /><span className="suffix">USDC</span></div>
          </div>
          <div className="field">
            <label htmlFor="pv-window">Verdict window</label>
            <select id="pv-window" disabled><option>2 minutes</option><option>10 minutes</option><option>1 hour</option></select>
          </div>
        </div>
        <button className="btn btn-primary" type="button" disabled aria-disabled>Post to the floor</button>
      </div>
    </div>
  );
}

export function PostTaskForm() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const [type, setType] = useState("question-answering");
  const [spec, setSpec] = useState("");
  const [maxPrice, setMaxPrice] = useState("0.01");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function getQuote() {
    setBusy("quote"); setErr(null); setResult(null); setQuote(null);
    try {
      const res = await fetch("/api/broker/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: { type, spec, max_price_usdc: Number(maxPrice) }, requester_wallet: wallet?.account.address }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.error ?? "quote failed");
      setQuote(body);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function payAndExecute() {
    if (!wallet || !quote || quote.declined) return;
    setBusy("pay"); setErr(null);
    try {
      await ensureGatewayFloat(wallet, Math.max(0.5, quote.total_price_usdc * 4));
      const res = await payX402(wallet, `/api/broker/execute/${quote.quote_id}`, { method: "POST", body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "execution failed");
      setResult(body);
      if (body.match_key) router.push(`/m/${body.match_key}`);
    } catch (e) { setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(null); }
  }

  if (!isConnected) {
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
            <input type="text" id="t-type" placeholder="question-answering" value={type} onChange={(e) => setType(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="t-price">Max price</label>
            <div className="input-suffix"><input type="number" id="t-price" className="input-mono" placeholder="0.010" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /><span className="suffix">USDC</span></div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="t-spec">Spec</label>
          <textarea id="t-spec" rows={3} placeholder="What does good look like? The validator scores against exactly this." value={spec} onChange={(e) => setSpec(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy !== null || !spec} aria-disabled={busy !== null || !spec} onClick={getQuote}>
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
              {busy === "pay" ? "Signing & paying…" : `Pay ${fx(quote.total_price_usdc)} USDC & execute`}
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
