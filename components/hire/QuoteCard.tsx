"use client";
// Renders get_quote tool output; Accept pays via the caller's rail. The card's numbers come from
// the tool payload only — the model cannot alter them.
// Visuals adopted from design-system/import/market/QuoteCard.jsx (bonded / best-effort / declined / accepted).
import { useState, type CSSProperties, type ReactNode } from "react";
import { Coins, Check, Scale, KeyRound, type LucideIcon } from "lucide-react";
import { Card, Button } from "../ui/primitives";
import { ConnectButton } from "../wallet/ConnectButton";
import { useWallet } from "../wallet/useWallet";
import { useWalletClient } from "wagmi";
import { payX402, ensureGatewayFloat } from "@/lib/gatewayBrowser";
import { payForQuote } from "../wallet/passkeyClient";
import { usePasskey } from "../wallet/passkey";
import { VerdictWatch } from "./VerdictWatch";

const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const pct = (c: number) => `${Math.round(c * 100)}%`;
const ENTER = "animate-in fade-in slide-in-from-bottom-2 duration-300";

function Label({ text, color, icon: Icon }: { text: string; color: string; icon?: LucideIcon }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.22em", color }}>
      {Icon ? <Icon size={13} strokeWidth={2} aria-hidden="true" /> : <span style={{ width: 20, height: 1, background: "currentColor" }} />}
      {text}
    </div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: strong ? "12px 0" : "8px 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: strong ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: strong ? 500 : 400 }}>{label}</span>
      <span style={{ ...mono, fontSize: strong ? 16 : 14, fontWeight: 500, color: tone || "var(--foreground)" }}>{value}</span>
    </div>
  );
}

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

  if (output.error) {
    return (
      <div className={ENTER}>
        <Card padding={16} style={{ maxWidth: 460 }}>
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{String(output.error)}</span>
        </Card>
      </div>
    );
  }

  if (output.declined) {
    return (
      <div className={ENTER}>
        <Card padding={18} style={{ borderColor: "color-mix(in oklab, var(--destructive) 45%, var(--border))", maxWidth: 460 }}>
          <Label text="Declined" color="var(--destructive)" icon={Scale} />
          <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--foreground)", textWrap: "pretty" }}>
            {String(output.reason ?? "I won't bond this one — the spec is underspecified and I can't price my confidence honestly.")}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--muted-foreground)" }}>No bond, no charge. Refine the ask and I&apos;ll quote again.</p>
        </Card>
      </div>
    );
  }

  const q = output as { quote_id: string; action: "accept" | "best_effort_offer"; confidence: number; bond_usdc: number; total_price_usdc: number; expires_at: string };
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
      ? [
          { label: "Bond posted", done: true },
          { label: "Provider paid", done: true },
          { label: "Deliverable ready", done: !!result.deliverable },
        ]
      : [
          { label: "Provider paid", done: true },
          { label: "Deliverable ready", done: !!result.deliverable },
        ];
    return (
      <div className={ENTER}>
        <Card stele={bonded} padding={18} style={{ maxWidth: 460 }}>
          <Label text={bonded ? "Accepted · bonded" : "Accepted"} color={bonded ? "var(--ring)" : "var(--muted-foreground)"} icon={bonded ? Coins : undefined} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "12px 0 14px" }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>Task</span>
            {bonded && <span style={{ ...mono, fontSize: 14, color: "var(--ring)" }}>{q.bond_usdc} USDC staked</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", background: s.done ? "var(--success)" : "transparent", border: s.done ? "none" : "2px solid var(--border)", flexShrink: 0 }}>
                  {s.done && <Check size={11} color="var(--success-foreground)" strokeWidth={3} aria-hidden="true" />}
                </span>
                <span style={{ color: s.done ? "var(--foreground)" : "var(--muted-foreground)" }}>{s.label}</span>
              </div>
            ))}
          </div>
          {result.deliverable !== undefined && (
            <pre style={{ margin: "14px 0 0", padding: 12, background: "var(--muted)", borderRadius: "var(--radius)", fontSize: 12, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result.deliverable, null, 2)}
            </pre>
          )}
          <div style={{ marginTop: 14 }}>
            {result.status === "delivered_awaiting_verdict" && result.verdict_due_at
              ? <VerdictWatch matchKey={result.match_key} dueAt={result.verdict_due_at} bondTx={result.bond_tx} />
              : <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>delivered (best-effort tier — no bond, no public verdict)</div>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={ENTER}>
      <Card stele={bonded} padding={18} style={{ maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label
            text={bonded ? "Bonded quote" : "Best effort — no bond"}
            color={bonded ? "var(--ring)" : "var(--muted-foreground)"}
            icon={bonded ? Coins : undefined}
          />
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>expires {new Date(q.expires_at).toLocaleTimeString()}</span>
        </div>

        {bonded && (
          <p style={{ margin: "12px 0 0", fontSize: 14.5, color: "var(--muted-foreground)", fontStyle: "italic", fontFamily: "var(--font-greek)" }}>
            The oracle says {pct(q.confidence)}. Care to disagree?
          </p>
        )}

        <div style={{ marginTop: 8 }}>
          <Row label="Price" value={`${q.total_price_usdc} USDC`} />
          <Row label="Broker confidence" value={pct(q.confidence)} />
          {bonded && <Row label="ENGYE stakes" value={`${q.bond_usdc} USDC`} tone="var(--ring)" strong />}
        </div>

        {bonded && (
          <div style={{ height: 4, borderRadius: 2, background: "var(--secondary)", overflow: "hidden", margin: "12px 0" }}>
            <div className="bar-fill" style={{ height: "100%", width: "100%", transformOrigin: "left center", transform: `scaleX(${q.confidence})`, transition: "transform var(--dur) var(--ease)", background: "var(--accent)" }} />
          </div>
        )}

        {wallet.connected ? (
          <Button onClick={accept} disabled={busy} style={{ width: "100%", marginTop: bonded ? 4 : 14 }}>
            {passkey && <KeyRound size={15} aria-hidden="true" />}
            {busy ? "Paying…" : `Accept · ${q.total_price_usdc} USDC${passkey ? " · Passkey" : ""}`}
          </Button>
        ) : (
          <div style={{ marginTop: bonded ? 4 : 14 }}>
            <ConnectButton />
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted-foreground)" }}>No wallet? A passkey account takes one tap — first tasks sponsored.</p>
          </div>
        )}
        {err && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--destructive)" }}>{err}</p>}

        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted-foreground)", textAlign: "center" }}>
          {bonded ? "If the validator fails it, you're paid price + bond — on-chain." : "No bond posted. You pay the price only; no failure payout."}
        </p>
      </Card>
    </div>
  );
}
