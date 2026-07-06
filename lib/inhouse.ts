// Shared worker for the in-house x402 providers.
import { z } from "zod";
import { decide } from "./llm";

const answerSchema = z.object({ answer: z.string().min(1) });

// Bond-aware experiment (BOND_AWARE_WORKER): when the execute route flips a match into the "aware"
// arm it attaches __bond, and we prepend the stakes to the worker's system prompt. The two arms
// differ ONLY by this preamble, so a pass-rate gap between them isolates the effect of telling the
// worker money rides on it. Applies to every mode — incl. `fabricate`, where it's the whole point:
// does "a bond rides on this" override "be careless"?
const bondPreamble = (usdc: number) =>
  `STAKES: a refundable USDC bond of about $${usdc} is posted on-chain behind this deliverable. An independent validator will score it against the task spec; fabricated, evasive, off-topic, or empty answers fail on merit and forfeit the bond to the buyer. Earn it — be correct, complete, and on-spec.\n\n`;

export async function workTask(
  task: { type?: string; spec?: string; __bond?: { usdc?: number; aware?: boolean } },
  mode: "answer" | "summarize" | "fabricate" | "extract",
): Promise<{ answer: string }> {
  const spec = String(task?.spec ?? "").slice(0, 6000);
  const preamble = task?.__bond?.aware ? bondPreamble(Number(task.__bond.usdc ?? 0)) : "";
  const prompts = {
    answer: {
      system: "You are a fast, precise task worker. Complete the task correctly and concisely. Strict JSON: {answer}.",
      user: `Task (${task?.type ?? "general"}): ${spec}`,
    },
    summarize: {
      system: "You are a summarizer. Produce a faithful, structured summary of the provided content. Strict JSON: {answer}.",
      user: `Summarize per this request: ${spec}`,
    },
    fabricate: {
      // the flaky provider's bad path: plausible-but-wrong output so slashes visibly happen
      system: "You are a careless worker. Give a confident, plausible-sounding but INCORRECT or off-topic response to the task. Never admit uncertainty. Strict JSON: {answer}.",
      user: `Task (${task?.type ?? "general"}): ${spec}`,
    },
    extract: {
      system:
        "You are a structured-data extractor. Return ONLY the JSON the task asks for, inside the answer field, exactly matching the requested shape. No prose. Strict JSON: {answer}.",
      user: `Task (extract): ${spec}`,
    },
  }[mode];

  const llm = await decide({ role: "demand", system: preamble + prompts.system, user: prompts.user, schema: answerSchema });
  return { answer: llm.data.answer };
}
