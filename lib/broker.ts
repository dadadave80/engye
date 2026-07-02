// LLM DECISION #1 — routing, confidence, accept/decline. The model chooses; the server
// re-derives every number (§4) and enforces the EV gate. Decisions are first-class data.
import { z } from "zod";
import { decide } from "./llm";
import { supabaseAdmin } from "./db";
import { brokerContext, type ProviderRow } from "./reputation";
import {
  feeFor,
  bondFor,
  calibratedConfidence,
  evGateAccepts,
  round6,
  QUOTE_TTL_MS,
  BEST_EFFORT_FEE_DISCOUNT,
} from "./economics";

export interface Task {
  type: string;
  spec: string;
  max_price_usdc: number;
  quality_bar?: string;
}

const brokerSchema = z.object({
  action: z.enum(["accept", "decline", "best_effort_offer"]),
  provider_id: z.string().nullish(),
  confidence: z.number().min(0.5).max(0.99),
  reasoning: z.string(),
  decline_reason: z.string().nullish(),
});

const SYSTEM = `You are ENGYE, an underwriting broker: routing paid tasks AND staking a USDC bond behind every match is your product. Requesters pay you precisely BECAUSE you bond your judgment — an unbonded match is a degraded product, not a safe choice.
Rules:
- Pick the provider whose capabilities and track record best fit the task. Price matters, but a slash costs more than a cheap provider saves.
- confidence is YOUR honest probability (0.50-0.99) that the chosen provider's deliverable passes independent validation against the task spec. Do not deflate it to avoid staking: a well-specified task on a provider with a decent record deserves its real number. The platform separately verifies the economics — pricing risk is not your job, estimating pass-probability is.
- DEFAULT to action="accept" whenever a provider fits the task. Reserve "best_effort_offer" for genuinely unusual territory: task types no provider has demonstrably handled, ambiguous specs, or providers with clearly deteriorating records.
- action="decline" if no provider fits, the task is malformed/unethical/unanswerable, or every fitting provider's price exceeds max_price_usdc.
- provider_id is the provider's P-number from the registry table (e.g. "P2").
Reply with strict JSON: {action, provider_id, confidence, reasoning, decline_reason}.`;

export async function quoteTask(task: Task, requesterWallet: string | null) {
  const { providers, table } = await brokerContext();
  if (providers.length === 0) {
    return persistQuote(task, requesterWallet, null, null, {
      action: "decline" as const,
      declineReason: "no active providers registered",
      reasoning: "registry empty",
    });
  }

  const user = `Task: ${JSON.stringify(task)}

Provider registry (id | name | capabilities | price | calibrated pass-prob ĉ | trials | avg score | slashes | last 5 outcomes P=pass F=fail):
${table}`;

  const llm = await decide({ role: "broker", system: SYSTEM, user, schema: brokerSchema });
  // resolve alias (P2) or index or full uuid — never trust an LLM to copy a UUID
  const ref = (llm.data.provider_id ?? "").trim();
  const byAlias = /^P?\d+$/i.test(ref) ? providers[Number(ref.replace(/\D/g, "")) - 1] : undefined;
  const provider = byAlias ?? providers.find((p) => p.id === ref) ?? null;

  // server-side derivation — never trust model arithmetic (§8)
  let action: "accept" | "decline" | "best_effort_offer" = llm.data.action;
  let declineReason = llm.data.decline_reason ?? null;
  let derived: Derived | null = null;

  if (action !== "decline") {
    if (!provider) {
      action = "decline";
      declineReason = `model chose unknown provider ${llm.data.provider_id}`;
    } else if (provider.price_usdc > task.max_price_usdc) {
      action = "decline";
      declineReason = `provider price $${provider.price_usdc} exceeds max_price_usdc $${task.max_price_usdc}`;
    } else {
      derived = deriveNumbers(provider, llm.data.confidence);
      if (action === "accept" && !derived.gatePassed) {
        // the broker wanted to accept but the EV gate says the fee doesn't cover expected slash loss
        action = "best_effort_offer";
        declineReason = `EV gate: fee $${derived.fee} < (1-ĉ ${derived.cHat.toFixed(2)}) × bond $${derived.bond}`;
      }
      if (action === "best_effort_offer") {
        derived = { ...derived, fee: round6(derived.fee * BEST_EFFORT_FEE_DISCOUNT), bond: 0 };
        derived.total = round6(provider.price_usdc + derived.fee);
      }
    }
  }

  return persistQuote(task, requesterWallet, provider, derived, {
    action,
    declineReason,
    reasoning: llm.data.reasoning,
    confidence: llm.data.confidence,
    llmMeta: { model: llm.model, latencyMs: llm.latencyMs, promptHash: llm.promptHash, raw: llm.raw },
  });
}

interface Derived {
  fee: number;
  bond: number;
  total: number;
  cHat: number;
  gatePassed: boolean;
}

function deriveNumbers(p: ProviderRow, stated: number): Derived {
  const fee = feeFor(p.price_usdc);
  const bond = bondFor(p.price_usdc, stated);
  const cHat = calibratedConfidence(stated, p.passes, p.trials);
  return {
    fee,
    bond,
    total: round6(p.price_usdc + fee),
    cHat,
    gatePassed: evGateAccepts(fee, bond, cHat),
  };
}

async function persistQuote(
  task: Task,
  requesterWallet: string | null,
  provider: ProviderRow | null,
  derived: Derived | null,
  d: {
    action: "accept" | "decline" | "best_effort_offer";
    declineReason?: string | null;
    reasoning: string;
    confidence?: number;
    llmMeta?: { model: string; latencyMs: number; promptHash: string; raw: string };
  },
) {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const { data: quote, error } = await supabaseAdmin
    .from("quotes")
    .insert({
      task,
      requester_wallet: requesterWallet,
      provider_id: provider?.id ?? null,
      action: d.action,
      confidence: d.confidence ?? null,
      calibrated_confidence: derived?.cHat ?? null,
      bond_usdc: derived?.bond ?? null,
      fee_usdc: derived?.fee ?? null,
      total_price_usdc: derived?.total ?? null,
      reasoning: d.reasoning,
      decline_reason: d.declineReason ?? null,
      expires_at: expiresAt,
      status: d.action === "decline" ? "declined" : "open",
    })
    .select()
    .single();
  if (error) throw new Error(`quote insert: ${error.message}`);

  await supabaseAdmin.from("decisions").insert({
    kind: "broker_quote",
    quote_id: quote.id,
    llm_provider: "groq",
    model: d.llmMeta?.model ?? null,
    prompt_hash: d.llmMeta?.promptHash ?? null,
    raw_json: d.llmMeta ? JSON.parse(d.llmMeta.raw) : null,
    derived: { action: d.action, decline_reason: d.declineReason, ...derived },
    latency_ms: d.llmMeta?.latencyMs ?? null,
  });

  if (d.action === "decline") {
    return { declined: true as const, reason: d.declineReason ?? d.reasoning, quote_id: quote.id };
  }
  return {
    declined: false as const,
    quote_id: quote.id,
    action: d.action,
    provider_id: provider!.id,
    confidence: d.confidence!,
    bond_usdc: derived!.bond,
    total_price_usdc: derived!.total,
    expires_at: expiresAt,
    reasoning_summary: d.reasoning,
  };
}
