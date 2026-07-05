"use client";
// Renders get_quote tool output; Accept pays via the caller's rail. The card's numbers come from
// the tool payload only — the model cannot alter them.
import { useState } from "react";
import { Card, Button, Badge } from "../ui/primitives";
import { ConnectButton } from "../wallet/ConnectButton";
import { useWallet } from "../wallet/useWallet";
import { useWalletClient } from "wagmi";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { payForQuote } from "../wallet/passkeyClient";
import { usePasskey } from "../wallet/passkey";
import { VerdictWatch } from "./VerdictWatch";

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 13, padding: "3px 0" };

type ExecuteResult = {
  match_id: string; match_key: string; status: string; deliverable?: unknown;
  verdict_due_at?: string; watch_url?: string; bond_tx?: string; tier?: string;
};

export function QuoteCard({ output }: { output: Record<string, unknown> }) {
  const wallet = useWallet();
  const { current } = usePasskey();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  if (output.error) return <Card padding={16}><span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{String(output.error)}</span></Card>;
  if (output.declined) {
    return <Card padding={16}><Badge status="SLASHED" label="DECLINED" /> <span style={{ fontSize: 13 }}>{String(output.reason)}</span></Card>;
  }
  const q = output as { quote_id: string; action: "accept" | "best_effort_offer"; confidence: number; bond_usdc: number; total_price_usdc: number; expires_at: string };
  const bonded = q.action === "accept";

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

  return (
    <Card stele padding={16}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Badge status={bonded ? "OPEN" : undefined} label={bonded ? "BONDED QUOTE" : "BEST EFFORT — NO BOND"} />
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>expires {new Date(q.expires_at).toLocaleTimeString()}</span>
        </div>
        <div style={row}><span>price</span><span>{q.total_price_usdc} USDC</span></div>
        <div style={row}><span>broker confidence</span><span>{Math.round(q.confidence * 100)}%</span></div>
        {bonded && <div style={row}><span>ENGYE stakes</span><span>{q.bond_usdc} USDC</span></div>}
        {!result && (wallet.connected
          ? <Button disabled={busy} onClick={accept}>{busy ? "Paying…" : `Accept · ${q.total_price_usdc} USDC${wallet.kind === "passkey" ? " · passkey" : ""}`}</Button>
          : <div><ConnectButton /><div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>No wallet? A passkey account takes one tap — first tasks sponsored.</div></div>)}
        {err && <div style={{ fontSize: 12, color: "var(--oxblood-badge)" }}>{err}</div>}
        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <pre style={{ margin: 0, padding: 12, background: "var(--muted)", borderRadius: "var(--radius)", fontSize: 12, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result.deliverable, null, 2)}
            </pre>
            {result.status === "delivered_awaiting_verdict" && result.verdict_due_at
              ? <VerdictWatch matchKey={result.match_key} dueAt={result.verdict_due_at} bondTx={result.bond_tx} />
              : <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>delivered (best-effort tier — no bond, no public verdict)</div>}
          </div>
        )}
      </div>
    </Card>
  );
}
