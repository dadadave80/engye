// ERC-8004 agent-card parsing (registration-v1 shape) for import-by-agentId onboarding.
// Pure — fetch/chain stay in the route. Cards look like public/agents/*.json:
//   { name, description, capabilities: [..], x402Support, endpoints: { service: "/api/..." } }
import { z } from "zod";

const cardSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  capabilities: z.array(z.string().min(1)).max(12).optional(),
  x402Support: z.boolean().optional(),
  endpoints: z.object({ service: z.string().min(1) }).partial().optional(),
});

export type ParsedAgentCard = { name: string; description: string | null; capabilities: string[]; endpoint: string };

/** Parse an agent card; resolves a relative service endpoint against the card's URL.
 *  Returns null when the card has no usable https service endpoint. */
export function parseAgentCard(json: unknown, cardUrl: string, agentId: bigint | number): ParsedAgentCard | null {
  const parsed = cardSchema.safeParse(json);
  if (!parsed.success) return null;
  const c = parsed.data;
  const service = c.endpoints?.service;
  if (!service) return null;
  let endpoint: string;
  try {
    endpoint = new URL(service, cardUrl).toString(); // absolute stays absolute; relative resolves against the card
  } catch {
    return null;
  }
  if (!endpoint.startsWith("https://")) return null;
  return {
    name: c.name ?? `ERC-8004 agent #${agentId}`,
    description: c.description ?? null,
    capabilities: c.capabilities?.length ? c.capabilities : ["general"],
    endpoint,
  };
}
