"use client";
// The front door: chat with the broker (eve agent), get a bonded quote, accept, watch receipts.
// The agent only converses+quotes; Accept pays through the deterministic rails (QuoteCard).
import { useEveAgent, type EveMessagePart } from "eve/react";
import { useState } from "react";
import { Card, Button, Eyebrow } from "../ui/primitives";
import { QuoteCard } from "./QuoteCard";

const STARTERS = [
  { label: "Summarize a link", text: "Summarize this article into 3 bullets: https://" },
  { label: "Extract JSON", text: "Extract {name, price} from this text: " },
  { label: "Draft an email", text: "Write a short email declining a meeting politely because " },
  { label: "Review code", text: "Review this function for bugs:\n```\n\n```" },
];

function Part({ part }: { part: EveMessagePart }) {
  if (part.type === "text") return <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{part.text}</p>;
  if (part.type === "dynamic-tool" && part.state === "output-available" && part.toolName === "get_quote") {
    return <QuoteCard output={part.output as Record<string, unknown>} />;
  }
  if (part.type === "dynamic-tool" && part.state === "input-available") {
    return <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>… consulting the registry</div>;
  }
  // a tool that errored or was denied would otherwise render nothing — leave the user with a gap
  if (part.type === "dynamic-tool" && (part.state === "output-error" || part.state === "output-denied")) {
    return <div style={{ fontSize: 12, color: "var(--oxblood-badge)" }}>that step didn&apos;t complete — try rephrasing your request.</div>;
  }
  return null;
}

export function HireChat() {
  const agent = useEveAgent();
  const [draft, setDraft] = useState("");
  const busy = agent.status === "submitted" || agent.status === "streaming";

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await agent.send({ message: text });
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <Eyebrow>Hire ENGYE — quotes are free, every job is bonded</Eyebrow>
      {agent.data.messages.length === 0 && (
        <Card padding={24}>
          <p style={{ marginTop: 0 }}>Describe a task. I&apos;ll route it, price it, and stake my own USDC on the result — if my validator rejects the work, you&apos;re paid back price + bond, on-chain.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STARTERS.map((s) => (
              <Button key={s.label} size="sm" variant="outline" onClick={() => setDraft(s.text)}>{s.label}</Button>
            ))}
          </div>
        </Card>
      )}
      {agent.data.messages.map((m) => (
        <div key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "stretch", maxWidth: m.role === "user" ? "80%" : "100%" }}>
          {m.role === "user"
            ? <Card padding={12}>{m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}</Card>
            : m.parts.map((p, i) => <Part key={i} part={p} />)}
        </div>
      ))}
      {agent.error && <div style={{ color: "var(--oxblood-badge)", fontSize: 13 }}>{agent.error.message}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
          placeholder="e.g. summarize https://… into 3 bullets"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          style={{ flex: 1, resize: "none", padding: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-body)", fontSize: 14 }}
        />
        <Button disabled={busy || !draft.trim()} onClick={submit}>{busy ? "…" : "Send"}</Button>
      </div>
    </div>
  );
}
