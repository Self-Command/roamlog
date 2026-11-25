import { AiChatRequestSchema, AiToolCallSchema } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import { AI_TOOL_SPECS } from "../ai-tools.js";

/**
 * Golden regression set for the planner's input contract.
 *
 * Three operator prompts (reduced from 20 given the time box) are pinned here.
 * The offline half asserts that each prompt is a valid chat request and that the
 * tool argument examples it implies satisfy the published tool JSON Schema; the
 * real-gateway half lives in `adapters.integration.spec.ts` and only runs when
 * `AI_BASE_URL` is exported.
 */
const GOLDEN_PROMPTS = [
  {
    id: "kyoto-week-cafes-temples",
    message: "我想去京都待一周，预算 8000 人民币，喜欢咖啡馆和古寺",
    tool: "trips.create",
    args: { title: "Kyoto: cafés and temples", startDate: "2026-12-01", endDate: "2026-12-07" },
  },
  {
    id: "lisbon-long-weekend",
    message: "Plan a long weekend in Lisbon for two, mid-March, walkable neighborhoods.",
    tool: "stops.add",
    args: { tripId: "01942f30-1200-7000-8000-000000000201", providerPlaceId: "N:1234" },
  },
  {
    id: "iceland-ring-road",
    message: "7 days in Iceland, ring road, budget 250000 ISK, no camping.",
    tool: "packing.add",
    args: {
      tripId: "01942f30-1200-7000-8000-000000000201",
      name: "Waterproof shell",
      category: "clothing",
      quantity: 1,
    },
  },
] as const;

describe("AI planner golden prompts (offline)", () => {
  it("accepts every golden prompt as a valid chat request", () => {
    for (const golden of GOLDEN_PROMPTS) {
      const parsed = AiChatRequestSchema.safeParse({ message: golden.message });
      expect(parsed.success, golden.id).toBe(true);
      expect(golden.message.length).toBeLessThanOrEqual(2000);
    }
  });

  it("publishes a schema for every tool a golden prompt expects", () => {
    const published = new Set(AI_TOOL_SPECS.map((tool) => tool.name));
    for (const golden of GOLDEN_PROMPTS) {
      expect(published.has(golden.tool), golden.id).toBe(true);
      expect(AiToolCallSchema.safeParse({ tool: golden.tool, args: golden.args }).success).toBe(
        true,
      );
    }
  });

  it("keeps tool schemas free of model-authored coordinates, timezone and public grants", () => {
    for (const tool of AI_TOOL_SPECS) {
      const properties = JSON.stringify(tool.parameters);
      // `trips.update` is the one deliberate exception: the product requirement
      // lets the model edit the trip origin/time zone, but no other tool may
      // invent coordinates or a timezone for a place or stop.
      if (tool.name !== "trips.update") {
        expect(properties).not.toMatch(/"(lat|lng|timeZone)"/u);
      }
      // The only visibility a model may request is a non-public one.
      expect(properties).not.toContain("public_link");
      expect(tool.description).toMatch(
        /Read-only, no side effects|WRITES DATA|human-input tool/u,
      );
    }
  });
});
