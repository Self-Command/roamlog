import type { AiChatResponse, AiRunExecuteResponse } from "@roamlog/contracts";
import { AiChatResponseSchema } from "@roamlog/contracts";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  AiRequestError,
  aiFailureKind,
  createAiIdempotencyKey,
  createAiPlan,
  executeAiRun,
  toAiRequestError,
} from "./ai";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const RUN_ID = "0123456789abcdef0123456789abcdef";
const TRIP_ID = "018f0a00-0000-7000-8000-0000000000b1";

function makePlan(): AiChatResponse {
  return AiChatResponseSchema.parse({
    runId: RUN_ID,
    message: "计划已提交，等待你确认。",
    plannedCalls: [
      {
        tool: "trips.create",
        args: {
          title: "京都一周",
          destinations: ["Kyoto, Japan"],
          startDate: "2026-04-05",
          endDate: "2026-04-11",
          budgetAmountMinor: 800000,
          budgetCurrency: "CNY",
        },
      },
    ],
    readOnlyTrace: [{ tool: "places.search", args: { q: "Kyoto, Japan", limit: 5 } }],
    usage: { inputTokens: 6716, outputTokens: 2956 },
    provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    expiresAt: "2026-11-19T15:00:00.000Z",
  });
}

function makeExecution(): AiRunExecuteResponse {
  return {
    results: [{ tool: "trips.create", ok: true, entityId: TRIP_ID }],
    partialFailure: false,
    summary: "1 action(s) applied.",
  };
}

function makeResponse(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

function problem(status: number, code: string) {
  return {
    type: `https://roamlog.example/problems/${code.toLowerCase()}`,
    title: "AI request failed",
    status,
    code,
  };
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAiPlan", () => {
  it("posts the message to the workspace plan endpoint and validates the response", async () => {
    const plan = makePlan();
    fetchMock.mockResolvedValue(makeResponse(plan, 201));

    await expect(createAiPlan(WORKSPACE_ID, { message: "京都一周" })).resolves.toEqual(plan);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ message: "京都一周" });
  });

  it("forwards optional hints without inventing extra fields", async () => {
    fetchMock.mockResolvedValue(makeResponse(makePlan(), 201));

    await createAiPlan(WORKSPACE_ID, {
      message: "京都一周",
      hints: { budgetMinor: 800000, currency: "CNY", destinations: ["Kyoto"] },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      message: "京都一周",
      hints: { budgetMinor: 800000, currency: "CNY", destinations: ["Kyoto"] },
    });
  });

  it("rejects a response that does not match the contract", async () => {
    fetchMock.mockResolvedValue(makeResponse({ runId: "not-a-run" }, 201));

    const failure = await createAiPlan(WORKSPACE_ID, { message: "x" }).catch((error) => error);

    expect(failure).toBeInstanceOf(AiRequestError);
    expect(failure.code).toBe("INVALID_RESPONSE");
    expect(failure.kind).toBe("invalid_response");
  });

  it("rejects a success response that is not JSON", async () => {
    fetchMock.mockResolvedValue(makeResponse("<html>oops</html>", 200));

    const failure = await createAiPlan(WORKSPACE_ID, { message: "x" }).catch((error) => error);

    expect(failure).toBeInstanceOf(AiRequestError);
    expect(failure.kind).toBe("invalid_response");
  });

  it("turns a network rejection into a retryable network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const failure = await createAiPlan(WORKSPACE_ID, { message: "x" }).catch((error) => error);

    expect(failure).toBeInstanceOf(AiRequestError);
    expect(failure.kind).toBe("network");
    expect(failure.status).toBe(0);
    expect(failure.retryable).toBe(true);
  });
});

describe("executeAiRun", () => {
  it("posts the confirmed subset with its idempotency key", async () => {
    const execution = makeExecution();
    const calls = makePlan().plannedCalls;
    fetchMock.mockResolvedValue(makeResponse(execution, 201));

    await expect(
      executeAiRun(WORKSPACE_ID, RUN_ID, { calls, idempotencyKey: "key-12345678" }),
    ).resolves.toEqual(execution);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/runs/${RUN_ID}/execute`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      calls,
      idempotencyKey: "key-12345678",
    });
  });
});

describe("AI failure classification", () => {
  const cases: Array<{ status: number; code: string; kind: string; retryable: boolean }> = [
    { status: 503, code: "AI_NOT_CONFIGURED", kind: "not_configured", retryable: false },
    { status: 429, code: "AI_QUOTA", kind: "quota", retryable: false },
    { status: 422, code: "AI_LOOP_LIMIT", kind: "loop_limit", retryable: false },
    // An upstream gateway failure is transient: the same plan request may work.
    { status: 502, code: "AI_UPSTREAM", kind: "upstream", retryable: true },
  ];

  for (const { status, code, kind, retryable } of cases) {
    it(`classifies ${code} (${status}) as ${kind}`, async () => {
      fetchMock.mockResolvedValue(makeResponse(problem(status, code), status));

      const failure = await createAiPlan(WORKSPACE_ID, { message: "x" }).catch((error) => error);

      expect(failure).toBeInstanceOf(AiRequestError);
      expect(failure.status).toBe(status);
      expect(failure.code).toBe(code);
      expect(failure.kind).toBe(kind);
      expect(failure.retryable).toBe(retryable);
    });
  }

  it("classifies a consumed run and an unplanned call on execute", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(problem(409, "AI_RUN_CONSUMED"), 409));
    const consumed = await executeAiRun(WORKSPACE_ID, RUN_ID, {
      calls: makePlan().plannedCalls,
      idempotencyKey: "key-12345678",
    }).catch((error) => error);
    expect(consumed.kind).toBe("run_consumed");
    expect(consumed.retryable).toBe(false);

    fetchMock.mockResolvedValueOnce(
      makeResponse(problem(422, "AI_RUN_CALL_NOT_PLANNED"), 422),
    );
    const notPlanned = await executeAiRun(WORKSPACE_ID, RUN_ID, {
      calls: makePlan().plannedCalls,
      idempotencyKey: "key-12345678",
    }).catch((error) => error);
    expect(notPlanned.kind).toBe("call_not_planned");
  });

  it("falls back to the HTTP status when the problem body has no code", async () => {
    fetchMock.mockResolvedValue(makeResponse({}, 503));

    const failure = await createAiPlan(WORKSPACE_ID, { message: "x" }).catch((error) => error);

    expect(failure.kind).toBe("not_configured");
  });

  it("classifies a plain Error as unknown and retryable", () => {
    const failure = toAiRequestError(new Error("boom"));
    expect(failure.kind).toBe("unknown");
    expect(failure.retryable).toBe(true);
  });

  it("keeps an existing AiRequestError untouched", () => {
    const original = new AiRequestError(429, "quota", "AI_QUOTA", "quota");
    expect(toAiRequestError(original)).toBe(original);
  });

  it("derives a kind from status and code", () => {
    expect(aiFailureKind(409, "AI_RUN_CONSUMED")).toBe("run_consumed");
    expect(aiFailureKind(403, "WORKSPACE_ROLE_FORBIDDEN")).toBe("forbidden");
    expect(aiFailureKind(401, "UNAUTHENTICATED")).toBe("unauthorized");
    expect(aiFailureKind(418, "SOMETHING_ELSE")).toBe("unknown");
  });
});

describe("createAiIdempotencyKey", () => {
  it("returns a unique key that satisfies the contract length bounds", () => {
    const first = createAiIdempotencyKey();
    const second = createAiIdempotencyKey();

    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first).not.toBe(second);
  });
});