"use client";
// The front door: chat with the broker (eve agent), get a bonded quote, accept, watch receipts.
// UI = assistant-ui thread primitives skinned to the handoff .chat / .msg / .quote-card system.
// Runtime = ExternalStore adapter over eve/react's useEveAgent — the agent only converses+quotes;
// Accept pays through the deterministic rails (QuoteCard).
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { useEveAgent, type EveMessage } from "eve/react";
import { ObolMark } from "../ObolMark";
import { QuoteCard } from "./QuoteCard";

const STARTERS: { label: string; text: string }[] = [
  { label: "Summarize a link", text: "Summarize this article into 3 bullets: https://" },
  { label: "Extract JSON", text: "Extract {name, price} from this text: " },
  { label: "Draft an email", text: "Write a short email declining a meeting politely because " },
  { label: "Review code", text: "Review this function for bugs:\n```\n\n```" },
  {
    label: "Settle a stream session",
    text: 'Compute the stream session settlement statement from this event log. Return JSON {per_viewer, total_seconds, total_usdc, recipients}:\n```json\n{"rate_usdc_per_second":0.0001,"events":[{"viewer":"alice","event":"joined","t":0},{"viewer":"bob","event":"joined","t":45},{"viewer":"alice","event":"parted","t":340},{"viewer":"carol","event":"joined","t":300},{"viewer":"bob","event":"parted","t":480},{"viewer":"carol","event":"parted","t":600}],"recipients":[{"name":"streamer","share":0.9},{"name":"platform","share":0.1}]}\n```',
  },
];

/* ---- eve → assistant-ui message conversion ---- */
type PartLike = Exclude<ThreadMessageLike["content"], string>[number];
type ToolCallArgs = Extract<PartLike, { type: "tool-call" }>["args"];
function convertMessage(m: EveMessage): ThreadMessageLike {
  const content: PartLike[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text) content.push({ type: "text", text: p.text });
    else if (p.type === "dynamic-tool") {
      const failed = p.state === "output-error" || p.state === "output-denied";
      content.push({
        type: "tool-call",
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        args: (p.input ?? {}) as ToolCallArgs,
        result: p.state === "output-available" ? p.output : failed ? { error: "that step didn't complete — try rephrasing your request." } : undefined,
        isError: failed,
      });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  return { role: m.role === "user" ? "user" : "assistant", id: m.id, content };
}

/* ---- tool renderers ---- */
function GetQuoteTool({ result, status }: ToolCallMessagePartProps) {
  if (status.type === "running" || result === undefined) {
    return <div className="small muted">… consulting the registry</div>;
  }
  return <QuoteCard output={result as Record<string, unknown>} />;
}
function GenericTool({ result, status, isError }: ToolCallMessagePartProps) {
  if (status.type === "running" || result === undefined) return <div className="small muted">… working</div>;
  if (isError) return <div className="small" style={{ color: "var(--slash)" }}>that step didn&apos;t complete — try rephrasing your request.</div>;
  return null;
}
const PART_COMPONENTS = {
  Text: ({ text }: { text: string }) =>
    text ? (
      <div className="msg msg-broker">
        <div className="who">engye</div>
        <span style={{ whiteSpace: "pre-wrap", textWrap: "pretty" }}>{text}</span>
      </div>
    ) : null,
  tools: { by_name: { get_quote: GetQuoteTool }, Fallback: GenericTool },
};

function UserText({ text }: { text: string }) {
  return <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</span>;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg msg-user animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="who">you</div>
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", width: "100%" }}>
      <MessagePrimitive.Parts components={PART_COMPONENTS} />
    </MessagePrimitive.Root>
  );
}

function TypingIndicator() {
  const dot = (delay: number) => (
    <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--muted)", display: "inline-block", animationDelay: `${delay}s` }} />
  );
  return (
    <div className="msg msg-broker animate-in fade-in duration-200" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      {dot(0)}{dot(0.2)}{dot(0.4)}
    </div>
  );
}

export function HireChat() {
  const agent = useEveAgent();
  const busy = agent.status === "submitted" || agent.status === "streaming";

  const runtime = useExternalStoreRuntime({
    messages: agent.data.messages,
    isRunning: busy,
    convertMessage,
    onNew: async (m: AppendMessage) => {
      const text = m.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (text) await agent.send({ message: text });
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat" style={{ height: "calc(100dvh - 300px)", minHeight: 460 }}>
        <div className="chat-head">
          <ObolMark size={16} simple />
          <span>engye broker · arc testnet · bonded quotes are free</span>
        </div>

        <ThreadPrimitive.Viewport className="chat-log" aria-live="polite" aria-atomic="false" style={{ overflowY: "auto", scrollbarWidth: "thin" }}>
          <ThreadPrimitive.Empty>
            <div className="msg msg-broker animate-in fade-in duration-300">
              <div className="who">engye</div>
              Tell me the job. If I can price my confidence honestly, I&apos;ll bond it — my money, not yours.
            </div>
            <div className="chip-row" aria-label="Suggested tasks" style={{ marginTop: 16 }}>
              {STARTERS.map((s) => (
                <ThreadPrimitive.Suggestion key={s.label} prompt={s.text} send={false} className="chip animate-in fade-in zoom-in-95 duration-300">
                  {s.label}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.If running>
            <TypingIndicator />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>

        {agent.error && <div className="small" style={{ color: "var(--slash)", padding: "0 var(--space-6) var(--space-2)" }}>{agent.error.message}</div>}

        <ComposerPrimitive.Root className="chat-input aui-composer">
          <ComposerPrimitive.Input
            rows={1}
            maxRows={5}
            autoFocus
            placeholder="Describe the task — the broker quotes and bonds it…"
            aria-label="Describe the task"
            style={{ flex: 1, resize: "none", minWidth: 0 }}
          />
          <ComposerPrimitive.Send className="btn btn-primary aui-send" aria-label="Send">Send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
