"use client";
// "Add recovery method" — pick an INSTALLED wallet (EIP-6963 discovery via wagmi), connect it,
// and take its address from the connection (no error-prone pasting). The chosen address is then
// authorized as a super-admin recovery key by the caller (passkey signs; ENGYE relays).
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useConnectors, type Connector } from "wagmi";
import { ShieldCheck, ChevronRight, X } from "lucide-react";

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 };
const card: React.CSSProperties = { width: 400, maxWidth: "92vw", background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: "calc(var(--radius) * 1.5)", boxShadow: "var(--shadow-popover)", overflow: "hidden", fontFamily: "var(--font-body)" };
const walletRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--foreground)", fontSize: 14 };

export function AddRecoveryModal({ onSelect, onClose }: { onSelect: (address: `0x${string}`) => Promise<void>; onClose: () => void }) {
  const connectors = useConnectors();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // EIP-6963-announced wallets carry an icon; dedupe by name. These are the installed wallets.
  const wallets = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((c) => !!c.icon && !seen.has(c.name) && (seen.add(c.name), true));
  }, [connectors]);
  const hasInjected = typeof window !== "undefined" && "ethereum" in window;
  const fallback = wallets.length === 0 && hasInjected ? connectors.find((c) => c.type === "injected") : undefined;
  const shown = wallets.length ? wallets : fallback ? [fallback] : [];

  async function pick(c: Connector) {
    setBusy(c.uid); setErr(null);
    try {
      const provider = (await c.getProvider()) as { request: (a: { method: string }) => Promise<unknown> };
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) throw new Error("The wallet returned no account.");
      await onSelect(addr as `0x${string}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally { setBusy(null); }
  }

  // Portal to <body> so the fixed overlay always sizes to the viewport (a filtered/transformed
  // ancestor would otherwise become its containing block — see ConnectModal).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px 0" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "inline-flex" }}><X size={16} /></button>
        </div>
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", padding: 8, borderRadius: 999, background: "color-mix(in oklab, var(--aegean) 18%, transparent)" }}><ShieldCheck size={20} color="var(--aegean-lifted)" /></span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Add recovery method</span>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, maxWidth: 300 }}>If you lose access to your passkey, recover this account with a wallet of your choice.</span>
          </div>

          {shown.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", textAlign: "center", lineHeight: 1.6, padding: "8px 0" }}>
              No wallets detected. Install a browser wallet — e.g. <b>MetaMask</b>, <b>Rabby</b>, or <b>Coinbase Wallet</b> — then reopen this.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shown.map((c) => (
                <button key={c.uid} style={walletRow} disabled={busy !== null} onClick={() => pick(c)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    {c.icon ? <img src={c.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} /> : <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--secondary)" }} />}
                    {c.name}
                  </span>
                  {busy === c.uid ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>connecting…</span> : <ChevronRight size={16} color="var(--muted-foreground)" />}
                </button>
              ))}
            </div>
          )}

          <button onClick={onClose} style={{ width: "100%", padding: "11px 14px", borderRadius: "var(--radius)", background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 14 }}>
            I&apos;ll do this later
          </button>
          {err && <div style={{ fontSize: 12.5, color: "var(--oxblood-badge)", textAlign: "center" }}>{err}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
