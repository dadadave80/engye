"use client";
// The hero flow: a human requester connects, gets a live bonded quote, and PAYS FROM THEIR
// OWN WALLET (x402/Gateway). On failure the bond + refund land in their wallet on-chain.
import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Card, Button, Input, Eyebrow, Badge, AddressChip } from "./ui/primitives";
import { ConnectButton } from "./wallet/ConnectButton";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { ARCSCAN } from "@/lib/clientChain";

type Quote =
  | { declined: true; reason: string }
  | { declined: false; quote_id: string; action: string; provider_id: string; confidence: number; bond_usdc: number; total_price_usdc: number; reasoning_summary: string };

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

export function PostTaskForm() {
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
      await ensureGatewayFloat(wallet, 0.05, Math.max(0.5, quote.total_price_usdc * 4));
      const res = await payX402(wallet, `/api/broker/execute/${quote.quote_id}`, { method: "POST", body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "execution failed");
      setResult(body);
    } catch (e) { setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(null); }
  }

  if (!isConnected) {
    return (
      <Card padding={24}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
          <Eyebrow>Enter the agora</Eyebrow>
          <p style={{ fontSize: 15, maxWidth: 560, lineHeight: 1.5, margin: 0 }}>Post a task and ENGYE bonds USDC behind the match it makes — sized by its own confidence. Pay from your wallet; if the work fails validation, the bond and a refund land back in your wallet automatically. Connect to begin.</p>
          <ConnectButton />
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card padding={24}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Input label="Task type" placeholder="question-answering" value={type} onChange={(e) => setType(e.target.value)} />
            <Input label="Max price (USDC)" mono placeholder="0.01" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Task spec</span>
            <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={3}
              placeholder="What is the capital of Australia, and why is it not Sydney?"
              style={{ fontFamily: "var(--font-body)", fontSize: 14, padding: "10px 12px", background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--input)", borderRadius: "var(--radius)", outline: "none", resize: "vertical" }} />
          </label>
          <div><Button disabled={busy !== null || !spec} onClick={getQuote}>{busy === "quote" ? "Getting quote…" : "Get bonded quote"}</Button></div>
        </div>
      </Card>

      {quote && quote.declined && (
        <Card padding={20}><span style={{ color: "var(--muted-foreground)" }}>Broker declined: {quote.reason}</span></Card>
      )}

      {quote && !quote.declined && !result && (
        <Card stele padding={24}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Eyebrow>The bonded quote</Eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <Stat label="Confidence" value={quote.confidence.toFixed(2)} />
              <Stat label="Bond staked" value={`${quote.bond_usdc.toFixed(3)} USDC`} tone="gold" />
              <Stat label="You pay" value={`${quote.total_price_usdc.toFixed(4)} USDC`} />
            </div>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, margin: 0 }}>{quote.reasoning_summary}</p>
            <div><Button disabled={busy !== null} onClick={payAndExecute}>{busy === "pay" ? "Signing & paying…" : `Pay ${quote.total_price_usdc.toFixed(4)} USDC & execute`}</Button></div>
          </div>
        </Card>
      )}

      {result && (
        <Card stele padding={24}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge status={result.status === "delivered" ? "PASS" : "SLASHED"} />
              <span style={{ fontSize: 15, fontWeight: 600 }}>{result.status === "delivered" ? "Delivered — validation passed" : "Failed — you were compensated"}</span>
            </div>
            {(result.validation as { reasons?: string[] })?.reasons?.length ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: 0 }}>{(result.validation as { reasons: string[] }).reasons.join(" · ")}</p>
            ) : null}
            {result.deliverable ? (
              <pre style={{ ...mono, fontSize: 12.5, background: "var(--secondary)", padding: 12, borderRadius: "var(--radius)", overflowX: "auto", margin: 0 }}>{JSON.stringify(result.deliverable, null, 2)}</pre>
            ) : null}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              {(["bond_tx", "settle_tx", "slash_tx", "refund_tx"] as const).map((k) => {
                const v = result[k] as string | undefined;
                if (!v) return null;
                const hash = v.startsWith("http") ? v.split("/tx/")[1] : v;
                return <a key={k} href={v.startsWith("http") ? v : `${ARCSCAN}/tx/${v}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)", ...mono }}>{k.replace("_tx", "")}: {hash.slice(0, 10)}…</a>;
              })}
            </div>
            <div><Button variant="outline" size="sm" onClick={() => { setResult(null); setQuote(null); setSpec(""); }}>Post another</Button></div>
          </div>
        </Card>
      )}

      {err && <Card padding={16}><span style={{ color: "var(--oxblood-badge)", fontSize: 13 }}>{err}</span></Card>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)", marginBottom: 6 }}>{label}</div>
      <div style={{ ...mono, fontSize: 22, color: tone === "gold" ? "var(--gold-lifted)" : "var(--foreground)" }}>{value}</div>
    </div>
  );
}
