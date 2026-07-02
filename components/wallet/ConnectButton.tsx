"use client";
// The Connect affordance (top-right of the app shell). Opens the Porto-style ConnectModal
// (Continue / Switch / Sign up + browser wallet). Connected → address chip with a small menu.
import { useState } from "react";
import { useDisconnect } from "wagmi";
import { useWallet } from "./useWallet";
import { usePasskey } from "./passkey";
import { ConnectModal } from "./ConnectModal";

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
  const { disconnect } = useDisconnect();
  const { accounts, signOut } = usePasskey();
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState(false);

  if (wallet.connected && wallet.address) {
    return (
      <div style={{ position: "relative" }}>
        <button style={chip} onClick={() => setMenu((o) => !o)}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--success)" }} />
          {trunc(wallet.address)}
          <span style={{ color: "var(--muted-foreground)" }}>· {wallet.kind === "passkey" ? "passkey" : "wallet"}</span>
        </button>
        {menu && (
          <div style={{ position: "absolute", right: 0, top: 40, minWidth: 190, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-popover)", zIndex: 20 }}>
            <button style={item} onClick={() => { navigator.clipboard?.writeText(wallet.address!); setMenu(false); }}>Copy address</button>
            {wallet.kind === "passkey" && accounts.length > 1 && (
              <button style={item} onClick={() => { setMenu(false); setModal(true); }}>Switch account</button>
            )}
            <button style={item} onClick={() => { setMenu(false); setModal(true); }}>Add / sign up</button>
            <button style={{ ...item, color: "var(--destructive)" }} onClick={() => { wallet.kind === "eoa" ? disconnect() : signOut(); setMenu(false); }}>Disconnect</button>
          </div>
        )}
        {modal && <ConnectModal onClose={() => setModal(false)} />}
      </div>
    );
  }

  return (
    <>
      <button style={{ ...chip, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }} onClick={() => setModal(true)}>
        Connect
      </button>
      {modal && <ConnectModal onClose={() => setModal(false)} />}
    </>
  );
}
