"use client";
// The handoff .gate — the disconnected state for /post, /stake, /account. Both buttons open the
// real ConnectModal (wallet + passkey paths). Copy is per-page.
import { useState } from "react";
import { ObolMark } from "./ObolMark";
import { ConnectModal } from "./wallet/ConnectModal";

export function ConnectGate({ title, children }: { title: string; children: React.ReactNode }) {
  const [modal, setModal] = useState(false);
  return (
    <div className="card">
      <div className="gate">
        <ObolMark size={34} />
        <h2>{title}</h2>
        <p>{children}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={() => setModal(true)}>Connect wallet</button>
          <button className="btn btn-ghost" type="button" onClick={() => setModal(true)}>Use a passkey</button>
        </div>
        <p className="hint" style={{ marginTop: "var(--space-3)" }}>No wallet? A passkey takes one tap — first tasks sponsored.</p>
      </div>
      {modal && <ConnectModal onClose={() => setModal(false)} />}
    </div>
  );
}
