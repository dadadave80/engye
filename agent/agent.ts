import { groq } from "@ai-sdk/groq";
import { defineAgent } from "eve";

export default defineAgent({
  model: groq("openai/gpt-oss-120b"),
  reasoning: "low", // gpt-oss hidden reasoning eats output tokens (house gotcha)
  limits: { maxInputTokensPerSession: 200_000, maxOutputTokensPerSession: 30_000 },
});
