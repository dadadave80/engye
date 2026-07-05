import { describe, expect, test } from "bun:test";
import { parseAgentCard } from "./agentCard";

const CARD_URL = "https://engye.vercel.app/agents/obol-sidecar.json";

describe("parseAgentCard", () => {
  test("relative service endpoint resolves against the card URL", () => {
    const p = parseAgentCard(
      { name: "Obol Sidecar", capabilities: ["creator-settlement"], endpoints: { service: "/api/sidecar/settle" } },
      CARD_URL, 845020,
    );
    expect(p).toEqual({
      name: "Obol Sidecar", description: null, capabilities: ["creator-settlement"],
      endpoint: "https://engye.vercel.app/api/sidecar/settle",
    });
  });
  test("absolute endpoint stays; defaults fill name/capabilities", () => {
    const p = parseAgentCard({ endpoints: { service: "https://api.other.dev/task" } }, CARD_URL, 7);
    expect(p?.endpoint).toBe("https://api.other.dev/task");
    expect(p?.name).toBe("ERC-8004 agent #7");
    expect(p?.capabilities).toEqual(["general"]);
  });
  test("no service endpoint / non-https / junk → null", () => {
    expect(parseAgentCard({ name: "x" }, CARD_URL, 1)).toBeNull();
    expect(parseAgentCard({ endpoints: { service: "http://insecure.dev/x" } }, CARD_URL, 1)).toBeNull();
    expect(parseAgentCard("not an object", CARD_URL, 1)).toBeNull();
  });
});
