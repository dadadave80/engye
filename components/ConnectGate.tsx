"use client";
// The handoff .gate — the disconnected state for /post, /stake, /account. Opens the real
// ConnectModal. Passkey-only this version, so the primary CTA is the passkey; the browser-wallet
// button only appears if external wallets are re-enabled (EXTERNAL_WALLETS_ENABLED).
import { useState } from "react";
import { ObolMark } from "./ObolMark";
import { ConnectModal } from "./wallet/ConnectModal";
import { EXTERNAL_WALLETS_ENABLED } from "./wallet/useWallet";

export function ConnectGate({ title, children }: { title: string; children: React.ReactNode }) {
  const [modal, setModal] = useState(false);
  return (
    <div className="card">
      <div className="gate">
        <ObolMark size={34} />
        <h2>{title}</h2>
        <p>{children}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={() => setModal(true)}>Continue with a passkey</button>
          {EXTERNAL_WALLETS_ENABLED && <button className="btn btn-ghost" type="button" onClick={() => setModal(true)}>Connect wallet</button>}
        </div>
        <p className="hint" style={{ marginTop: "var(--space-3)" }}>No account? A passkey takes one tap — Face ID or fingerprint, first tasks sponsored.</p>
      </div>
      {modal && <ConnectModal onClose={() => setModal(false)} />}
    </div>
  );
}
