"use client";
// The Connect affordance (top-right of the app shell). Opens a small menu:
//  - Browser wallet (EOA) via wagmi injected connector — full flow incl. x402 pay
//  - Passkey (Ithaca smart account) — rail-B actions, no extension
// Connected → shows a truncated address + kind chip; click to disconnect / view account.
import { useState } from "react";
import { useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useWallet } from "./useWallet";
import { usePasskey } from "./passkey";
import { connectPasskey } from "./passkeyClient";

const chip: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12,
  padding: "5px 12px", borderRadius: 999, border: "1px solid var(--border)",
  background: "transparent", color: "var(--foreground)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 8,
};
const item: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
  background: "none", border: "none", cursor: "pointer", color: "var(--foreground)",
  fontSize: 13, fontFamily: "var(--font-body)",
};
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ConnectButton() {
  const wallet = useWallet();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { setSession } = usePasskey();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (wallet.connected && wallet.address) {
    return (
      <div style={{ position: "relative" }}>
        <button style={chip} onClick={() => setOpen((o) => !o)}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--success)" }} />
          {trunc(wallet.address)}
          <span style={{ color: "var(--muted-foreground)" }}>· {wallet.kind}</span>
        </button>
        {open && (
          <div style={{ position: "absolute", right: 0, top: 40, minWidth: 180, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-popover)", zIndex: 20 }}>
            <button style={item} onClick={() => { navigator.clipboard?.writeText(wallet.address!); setOpen(false); }}>Copy address</button>
            <button style={{ ...item, color: "var(--destructive)" }} onClick={() => { disconnect(); setSession(null); setOpen(false); }}>Disconnect</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button style={{ ...chip, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }} onClick={() => setOpen((o) => !o)}>
        Connect
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 40, minWidth: 220, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-popover)", zIndex: 20 }}>
          <button style={item} disabled={busy !== null} onClick={() => { setOpen(false); connect({ connector: injected() }); }}>
            Browser wallet <span style={{ color: "var(--muted-foreground)" }}>· full flow</span>
          </button>
          <button style={item} disabled={busy !== null} onClick={async () => {
            setBusy("passkey");
            try { const s = await connectPasskey(); if (s) setSession(s); setOpen(false); }
            catch (e) { console.error("passkey connect:", e); }
            finally { setBusy(null); }
          }}>
            {busy === "passkey" ? "Waiting for passkey…" : <>Passkey <span style={{ color: "var(--muted-foreground)" }}>· Porto · no extension</span></>}
          </button>
        </div>
      )}
    </div>
  );
}
