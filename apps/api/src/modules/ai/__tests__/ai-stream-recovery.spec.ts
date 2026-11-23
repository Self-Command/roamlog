import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

import { AiController } from "../ai.controller.js";
import { AiConversationService } from "../ai-conversation.service.js";
import { AiRunStore } from "../ai-run.store.js";
import { actorStub, membershipStub } from "./ai-fixtures.js";

const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";
const STREAM_ID = "018f0a00-0000-7000-8000-0000000000dd";

function responseStub(chunks: string[] = []): Response {
  return {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    socket: { setNoDelay: vi.fn(), setTimeout: vi.fn() },
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  } as unknown as Response;
}

function controller(options: {
  recoverable?: boolean;
  resumable?: boolean;
  streamStatus?: "active" | "completed" | "aborted" | "failed";
}) {
  const conversations = {
    findRecoverableStream: vi.fn(async () =>
      options.recoverable === false ? null : { streamId: STREAM_ID },
    ),
    findStream: vi.fn(async () =>
      options.streamStatus ? { streamId: STREAM_ID, status: options.streamStatus } : null,
    ),
  };
  const runs = {
    hasResumableStream: vi.fn(async () => options.resumable !== false),
    bindAssistantMessage: vi.fn(async () => undefined),
    resumeResumableStream: vi.fn(async () => {
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue("id: 000001\nevent: meta\ndata: {}\n\n");
          controller.close();
        },
      });
    }),
    requestCancel: vi.fn(async () => undefined),
    cancelStream: vi.fn(() => true),
  };
  return {
    sut: new AiController(
      {} as never,
      {} as never,
      {} as never,
      conversations as unknown as AiConversationService,
      runs as unknown as AiRunStore,
      15_000,
    ),
    conversations,
    runs,
  };
}

describe("AI stream recovery endpoints", () => {
  it("reports active only when both the DB row and Redis producer exist", async () => {
    const active = controller({ resumable: true });
    await expect(
      active.sut.streamStatus(actorStub(), membershipStub(), CONVERSATION_ID),
    ).resolves.toEqual({ active: true, streamId: STREAM_ID });

    const stale = controller({ resumable: false });
    await expect(
      stale.sut.streamStatus(actorStub(), membershipStub(), CONVERSATION_ID),
    ).resolves.toEqual({ active: false });
  });

  it("cancels an owned active stream through the shared stop flag", async () => {
    const { sut, runs } = controller({ streamStatus: "active" });

    await expect(
      sut.cancelStream(actorStub(), membershipStub(), CONVERSATION_ID, {
        streamId: STREAM_ID,
      }),
    ).resolves.toEqual({ cancelled: true });

    expect(runs.requestCancel).toHaveBeenCalledWith(STREAM_ID);
    expect(runs.cancelStream).toHaveBeenCalledWith(STREAM_ID);
  });

  it("does not claim to cancel a completed stream", async () => {
    const { sut, runs } = controller({ streamStatus: "completed" });

    await expect(
      sut.cancelStream(actorStub(), membershipStub(), CONVERSATION_ID, {
        streamId: STREAM_ID,
      }),
    ).resolves.toEqual({ cancelled: false });
    expect(runs.requestCancel).not.toHaveBeenCalled();
  });

  it("binds the refreshed assistant id and pipes the replay buffer", async () => {
    const { sut, runs } = controller({ resumable: true });
    const chunks: string[] = [];
    const res = responseStub(chunks);

    await sut.resumeStream(
      actorStub(),
      membershipStub(),
      CONVERSATION_ID,
      { assistantMessageId: "assistant-refreshed-1" },
      res,
    );

    expect(runs.bindAssistantMessage).toHaveBeenCalledWith(STREAM_ID, "assistant-refreshed-1");
    expect(chunks.join("")).toContain("event: meta");
    expect(res.end).toHaveBeenCalled();
  });

  it("creates the resumable producer from the first meta before model output", async () => {
    let plannerPulls = 0;
    const planner = {
      streamChat: async function* () {
        plannerPulls += 1;
        yield {
          type: "meta" as const,
          v: 1 as const,
          conversationId: CONVERSATION_ID,
          userMessageId: "user-message-1",
          assistantMessageId: "assistant-message-1",
          streamId: STREAM_ID,
          provider: { protocol: "openai-chat" as const, model: "slow-model" },
        };
        await new Promise(() => {});
      },
    };
    const runs = {
      registerStreamController: vi.fn(),
      unregisterStreamController: vi.fn(),
      createResumableStream: vi.fn(
        async () =>
          new ReadableStream<string>({
            start(controller) {
              controller.close();
            },
          }),
      ),
      isCancelRequested: vi.fn(async () => false),
      clearCancelRequest: vi.fn(async () => undefined),
    };
    const sut = new AiController(
      planner as never,
      {} as never,
      {} as never,
      {} as never,
      runs as never,
      15_000,
    );
    const res = responseStub();

    await sut.chatStream(actorStub(), membershipStub(), { message: "Kyoto" }, {} as never, res);

    expect(plannerPulls).toBe(1);
    expect(runs.registerStreamController).toHaveBeenCalledWith(STREAM_ID, expect.anything());
    expect(runs.createResumableStream).toHaveBeenCalledWith(STREAM_ID, expect.any(Function));
    expect(res.end).toHaveBeenCalled();
  });
});
