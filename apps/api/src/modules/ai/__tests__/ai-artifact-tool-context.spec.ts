import { describe, expect, it, vi } from "vitest";

import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import { actorStub, membershipStub } from "./ai-fixtures.js";

const ARTIFACT_ID = "01942f30-1200-7000-8000-000000000301";
const CONVERSATION_ID = "01942f30-1200-7000-8000-000000000009";

function context(conversationId?: string): AiToolContext {
  return {
    actor: actorStub(),
    membership: membershipStub("editor"),
    runId: "f".repeat(32),
    candidates: new Map(),
    ...(conversationId ? { conversationId } : {}),
  };
}

function toolbox(createGenerated: ReturnType<typeof vi.fn>): AiToolbox {
  return new AiToolbox(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    { createGenerated } as never,
  );
}

describe("artifacts.create conversation binding", () => {
  it("forwards the run conversation to createGenerated", async () => {
    const createGenerated = vi.fn().mockResolvedValue({
      id: ARTIFACT_ID,
      title: "Kyoto guide",
      kind: "text",
    });
    const outcome = await toolbox(createGenerated).execute(
      {
        tool: "artifacts.create",
        args: { title: "Kyoto guide", kind: "text", brief: "Slow travel notes." },
      },
      context(CONVERSATION_ID),
    );

    expect(outcome).toMatchObject({
      ok: true,
      entityId: ARTIFACT_ID,
      artifact: { id: ARTIFACT_ID, title: "Kyoto guide", kind: "text" },
    });
    expect(createGenerated.mock.calls[0]?.[2]).toMatchObject({
      title: "Kyoto guide",
      kind: "text",
      brief: "Slow travel notes.",
      conversationId: CONVERSATION_ID,
    });
  });

  it("does not invent a conversationId for a legacy run", async () => {
    const createGenerated = vi.fn().mockResolvedValue({
      id: ARTIFACT_ID,
      title: "Kyoto guide",
      kind: "text",
    });

    await toolbox(createGenerated).execute(
      {
        tool: "artifacts.create",
        args: { title: "Kyoto guide", kind: "text" },
      },
      context(),
    );

    expect(createGenerated.mock.calls[0]?.[2]).not.toHaveProperty("conversationId");
  });
});
