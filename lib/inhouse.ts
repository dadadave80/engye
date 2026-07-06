// Shared worker for the in-house x402 providers.
import { z } from "zod";
import { decide } from "./llm";

const answerSchema = z.object({ answer: z.string().min(1) });

export async function workTask(
  task: { type?: string; spec?: string },
  mode: "answer" | "summarize" | "fabricate" | "extract",
): Promise<{ answer: string }> {
  const spec = String(task?.spec ?? "").slice(0, 6000);
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

  const llm = await decide({ role: "demand", system: prompts.system, user: prompts.user, schema: answerSchema });
  return { answer: llm.data.answer };
}
