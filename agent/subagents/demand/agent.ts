import { groq } from "@ai-sdk/groq";
import { defineAgent } from "eve";

// The autonomous demand buyer, as a declared eve subagent. Its buy-cycle logic is shared with the
// headless cron (agents/demand.ts) via lib/demand.ts. Live buying runs on the schedule (the cron
// holds the signing key); here the broker can delegate demand-desk questions or, where the key is
// present, kick a cycle.
export default defineAgent({
  description:
    "The autonomous demand buyer: drafts small tasks, judges the broker's bonded quote against a daily USDC budget, and buys only the ones worth it. Delegate here to report demand-side activity/budget, or (where the signing key is present) run one buy cycle.",
  model: groq("openai/gpt-oss-20b"),
  reasoning: "low", // gpt-oss hidden reasoning eats output tokens (house gotcha)
  limits: { maxInputTokensPerSession: 60_000, maxOutputTokensPerSession: 12_000 },
});
