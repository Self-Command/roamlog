import type { AiStreamEvent } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AiProtocolAdapter, AiStepResult, AiStreamOptions } from "../adapters/adapter.js";
import { AiPlanService } from "../ai-plan.service.js";
import { staticAiSettingsSource } from "../ai.settings.js";
import { AiToolbox } from "../ai-tools.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  quotaStub,
  runStoreStub,
  toolServiceMocks,
} from "./ai-fixtures.js";

describe("AI reasoning and tool-argument streaming", () => {
  it("emits reasoning deltas, tool argument fragments, then the matching tool lifecycle", async () => {
    const tools = toolServiceMocks();
    const toolbox = new AiToolbox(
      tools.places as never,
      tools.trips as never,
      tools.stops as never,
      tools.itinerary as never,
      tools.packing as never,
    );
    let turn = 0;
    const adapter: AiProtocolAdapter = {
      protocol: "openai-chat",
      step: vi.fn(),
      async streamStep(_input, options: AiStreamOptions): Promise<AiStepResult> {
        turn += 1;
        if (turn === 1) {
          await options.onReasoningDelta?.("先确认");
          await options.onReasoningDelta?.("搜索范围。");
          await options.onToolCallDelta?.({
            index: 0,
            id: "call-place",
            name: "places.search",
            argumentsDelta: '{"q":"',
          });
          await options.onToolCallDelta?.({
            index: 0,
            id: "call-place",
            name: "places.search",
            argumentsDelta: '京都"}',
          });
          return {
            text: null,
            toolCalls: [
              {
                id: "call-place",
                name: "places.search",
                input: { q: "京都" },
              },
            ],
          };
        }
        await options.onReasoningDelta?.("地点已经返回，");
        await options.onDelta?.("完成");
        return { text: "完成", toolCalls: [] };
      },
    };
    const conversations = {
      getOrCreate: vi.fn().mockResolvedValue({ id: "conversation-1", title: null }),
      loadContext: vi.fn().mockResolvedValue({ messages: [], facts: {} }),
      appendUserMessage: vi
        .fn()
        .mockResolvedValue({ messageId: "message-user-1", clientId: "client-1", created: true }),
      startStream: vi.fn().mockResolvedValue({ streamId: "stream-1" }),
      finishAssistantMessage: vi.fn().mockResolvedValue(undefined),
    };
    const settings = aiSettings();
    const service = new AiPlanService(
      staticAiSettingsSource(settings),
      () => adapter,
      toolbox,
      quotaStub() as never,
      runStoreStub() as never,
      loggerStub() as never,
      fixedClock(),
      conversations as never,
    );

    const events: AiStreamEvent[] = [];
    for await (const event of service.streamChat(actorStub(), membershipStub(), {
      message: "搜索京都",
    })) {
      events.push(event);
    }

    const reasoning = events.filter(
      (event): event is Extract<AiStreamEvent, { type: "reasoning.delta" }> =>
        event.type === "reasoning.delta",
    );
    expect(reasoning.map((event) => event.delta)).toEqual([
      "先确认",
      "搜索范围。",
      "地点已经返回，",
    ]);
    expect(reasoning[0]?.partId).toBe("reasoning-round-1");
    expect(events.some((event) => event.type === "reasoning.end")).toBe(true);

    const args = events.filter(
      (event): event is Extract<AiStreamEvent, { type: "tool.args.delta" }> =>
        event.type === "tool.args.delta",
    );
    expect(args.map((event) => event.argsTextDelta).join("")).toBe('{"q":"京都"}');
    expect(args.every((event) => event.toolCallId === "round-1-call-0")).toBe(true);

    const toolStartIndex = events.findIndex((event) => event.type === "tool.start");
    const firstArgsIndex = events.findIndex((event) => event.type === "tool.args.delta");
    expect(firstArgsIndex).toBeGreaterThan(-1);
    expect(toolStartIndex).toBeGreaterThan(firstArgsIndex);
    const toolStart = events[toolStartIndex];
    expect(toolStart).toMatchObject({
      type: "tool.start",
      toolCallId: "round-1-call-0",
      name: "places.search",
    });

    const persisted = conversations.finishAssistantMessage.mock.calls[0]?.[0] as
      { content?: Array<{ type?: string; text?: string; status?: { type?: string } }> } | undefined;
    expect(persisted?.content?.[0]).toMatchObject({
      type: "reasoning",
      text: "先确认搜索范围。",
      status: { type: "complete" },
    });
    expect(persisted?.content?.[1]).toMatchObject({
      type: "reasoning",
      text: "地点已经返回，",
      status: { type: "complete" },
    });
  });
});
