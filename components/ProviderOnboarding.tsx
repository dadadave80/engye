"use client";
// One onboarding slot, two interchangeable modes: manual registration (default) ⇄ ERC-8004
// import-by-agentId. A hint link under the active card switches modes.
import { useState } from "react";
import { RegisterForm } from "./RegisterForm";
import { ImportAgentForm } from "./ImportAgentForm";

export function ProviderOnboarding() {
  const [mode, setMode] = useState<"register" | "import">("register");
  const swap = (
    <button
      type="button"
      className="focus-ring"
      onClick={() => setMode(mode === "register" ? "import" : "register")}
      style={{ background: "none", border: "none", padding: 2, cursor: "pointer", font: "inherit", fontSize: 13, color: "var(--link)" }}
    >
      {mode === "register" ? "Already an ERC-8004 agent? Import by agentId →" : "← No agentId? Register your endpoint manually"}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {mode === "register" ? <RegisterForm /> : <ImportAgentForm />}
      <div style={{ textAlign: "right" }}>{swap}</div>
    </div>
  );
}
