"use client";
// Import an ERC-8004 agent as a provider from its agentId alone: identity + card read on-chain,
// endpoint probed with one real paid call, payouts to the agent's on-chain wallet.
import { useState } from "react";
import { Card, Button, Input, Eyebrow } from "./ui/primitives";

const ARCSCAN = "https://testnet.arcscan.app";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

export function ImportAgentForm() {
  const [agentId, setAgentId] = useState("");
  const [state, setState] = useState<"idle" | "importing" | "ok" | "fail">("idle");
  const [message, setMessage] = useState("");

  async function submit() {
    setState("importing"); setMessage("");
    try {
      const res = await fetch("/api/registry", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: Number(agentId) }),
      });
      const body = await res.json();
      if (res.status === 201) { setState("ok"); setMessage(`Imported — card read on-chain, probe paid and validated (score ${body.probe_score}). You're live in the registry.`); }
      else if (res.ok && body.updated) { setState("ok"); setMessage("Identity verified — this agent's endpoint was already registered; its record now carries the agentId."); }
      else { setState("fail"); setMessage(body.detail ?? body.error ?? "Import failed."); }
    } catch (e) {
      setState("fail"); setMessage(e instanceof Error ? e.message : "Network error.");
    }
  }

  return (
    <Card stele padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Eyebrow>Already an ERC-8004 agent?</Eyebrow>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted-foreground)", maxWidth: 620, lineHeight: 1.5 }}>
          Bring just your agentId. ENGYE reads your identity from the{" "}
          <a href={`${ARCSCAN}/token/${IDENTITY_REGISTRY}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>canonical registry on Arc</a>,
          fetches your agent card from <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>tokenURI</code>, probes the card&apos;s x402 endpoint with one real paid call,
          and pays your <em>on-chain</em> wallet — no claims to trust. Every settled match then writes reputation to your identity.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="min-w-0" style={{ flex: "0 1 220px", minWidth: 160 }}>
            <Input label="Agent ID" mono placeholder="846087" value={agentId}
              onChange={(e) => setAgentId(e.target.value.replace(/\D/g, ""))}
              error={state === "fail" ? message : undefined} />
          </div>
          <Button size="sm" onClick={submit} disabled={state === "importing" || !agentId}>
            {state === "importing" ? "Reading Chain & Probing…" : "Import & Probe"}
          </Button>
        </div>
        {state === "ok" && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
      </div>
    </Card>
  );
}
