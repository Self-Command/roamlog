import { ForbiddenException, HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AiExecuteService } from "../ai-execute.service.js";
import { AiToolbox } from "../ai-tools.js";
import {
  actorStub,
  aiSettings,
  KINKAKUJI,
  membershipStub,
  STOP_ID,
  TRIP_ID,
  toolServiceMocks,
  WORKSPACE_ID,
} from "./ai-fixtures.js";

const RUN_ID = "a".repeat(32);

function plannedRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    workspaceId: WORKSPACE_ID,
    userId: actorStub().user.id,
    message: "Plan ready.",
    plannedCalls: [
      { tool: "trips.create", args: { title: "Kyoto" } },
      {
        tool: "stops.add",
        args: { tripId: TRIP_ID, providerPlaceId: KINKAKUJI.providerPlaceId },
      },
    ],
    candidates: [KINKAKUJI],
    createdAt: "2026-11-19T05:00:00.000Z",
    ...overrides,
  };
}

function harness(run: ReturnType<typeof plannedRun> | undefined, mocks = toolServiceMocks()) {
  const toolbox = new AiToolbox(
    mocks.places as never,
    mocks.trips as never,
    mocks.stops as never,
    mocks.itinerary as never,
    mocks.packing as never,
  );
  const runStore = {
    load: vi.fn().mockResolvedValue(run),
    isConsumed: vi.fn().mockResolvedValue(false),
    consume: vi.fn().mockResolvedValue(undefined),
  };
  const idempotency = {
    run: vi.fn(async (_scope: string, _key: string, operation: () => unknown) => operation()),
  };
  const audit = { record: vi.fn().mockResolvedValue({ id: "audit-1" }) };
  const service = new AiExecuteService(
    toolbox,
    runStore as never,
    idempotency as never,
    audit as never,
  );
  return { service, mocks, runStore, idempotency, audit, toolbox };
}

async function expectHttp(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  expect(((error as HttpException).getResponse() as { code?: string }).code).toBe(code);
}

describe("AiExecuteService", () => {
  it("executes only the submitted subset and reports each call", async () => {
    const { service, mocks, runStore, audit } = harness(plannedRun());

    const response = await service.execute(
      actorStub() as never,
      membershipStub() as never,
      RUN_ID,
      {
        calls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
        idempotencyKey: "execute-once-1",
      },
    );

    expect(response.results).toEqual([
      { tool: "trips.create", ok: true, entityId: TRIP_ID },
    ]);
    expect(response.partialFailure).toBe(false);
    expect(mocks.trips.create).toHaveBeenCalledTimes(1);
    expect(mocks.stops.create).not.toHaveBeenCalled();
    expect(runStore.consume).toHaveBeenCalledTimes(1);
    // Audit per executed call; arguments are never stored.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.tool_call",
        targetType: "ai_tool",
        targetId: RUN_ID,
        metadata: expect.objectContaining({ tool: "trips.create", ok: true }),
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Kyoto");
  });

  it("rejects a call that was never planned", async () => {
    const { service, mocks } = harness(plannedRun());

    await expectHttp(
      service.execute(actorStub() as never, membershipStub() as never, RUN_ID, {
        calls: [{ tool: "budget.setSummary", args: { tripId: TRIP_ID, amountMinor: 1, currency: "CNY" } }],
        idempotencyKey: "execute-once-2",
      }),
      422,
      "AI_RUN_CALL_NOT_PLANNED",
    );
    expect(mocks.trips.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or expired run", async () => {
    const { service } = harness(undefined);

    await expectHttp(
      service.execute(actorStub() as never, membershipStub() as never, RUN_ID, {
        calls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
        idempotencyKey: "execute-once-3",
      }),
      404,
      "AI_RUN_NOT_FOUND",
    );
  });

  it("returns 409 AI_RUN_CONSUMED when the run was already executed", async () => {
    const { service, runStore } = harness(undefined);
    runStore.isConsumed.mockResolvedValue(true);

    await expectHttp(
      service.execute(actorStub() as never, membershipStub() as never, RUN_ID, {
        calls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
        idempotencyKey: "execute-once-4",
      }),
      409,
      "AI_RUN_CONSUMED",
    );
  });

  it("does not expose another user's plan", async () => {
    const { service } = harness(plannedRun({ userId: "01942f30-1200-7000-8000-000000000099" }));

    await expectHttp(
      service.execute(actorStub() as never, membershipStub() as never, RUN_ID, {
        calls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
        idempotencyKey: "execute-once-5",
      }),
      404,
      "AI_RUN_NOT_FOUND",
    );
  });

  it("keeps succeeding calls when a later call fails (partialFailure)", async () => {
    const mocks = toolServiceMocks();
    mocks.stops.create.mockRejectedValue(
      new ForbiddenException({
        code: "WORKSPACE_ROLE_FORBIDDEN",
        message: "Your Workspace role does not permit this action.",
      }),
    );
    const { service, audit } = harness(plannedRun(), mocks);

    const response = await service.execute(
      actorStub() as never,
      membershipStub("viewer") as never,
      RUN_ID,
      {
        calls: [
          { tool: "trips.create", args: { title: "Kyoto" } },
          { tool: "stops.add", args: { tripId: TRIP_ID, providerPlaceId: KINKAKUJI.providerPlaceId } },
        ],
        idempotencyKey: "execute-once-6",
      },
    );

    expect(response.results).toEqual([
      { tool: "trips.create", ok: true, entityId: TRIP_ID },
      {
        tool: "stops.add",
        ok: false,
        error: {
          code: "WORKSPACE_ROLE_FORBIDDEN",
          message: "Your Workspace role does not permit this action.",
        },
      },
    ]);
    expect(response.partialFailure).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(response.summary).toContain("1 action(s) applied, 1 failed");
  });

  it("never forwards model-authored workspaceId/userId to the services", async () => {
    const { service, mocks } = harness(
      plannedRun({
        plannedCalls: [
          {
            tool: "trips.create",
            args: { title: "Kyoto", workspaceId: "01942f30-1200-7000-8000-00000000dead", userId: "evil" },
          },
        ],
      }),
    );

    await service.execute(actorStub() as never, membershipStub() as never, RUN_ID, {
      calls: [
        {
          tool: "trips.create",
          args: { title: "Kyoto", workspaceId: "01942f30-1200-7000-8000-00000000dead", userId: "evil" },
        },
      ],
      idempotencyKey: "execute-once-7",
    });

    const [, membership, body] = mocks.trips.create.mock.calls[0] as [
      unknown,
      { workspaceId: string },
      Record<string, unknown>,
    ];
    expect(membership.workspaceId).toBe(WORKSPACE_ID);
    expect(body).not.toHaveProperty("workspaceId");
    expect(body).not.toHaveProperty("userId");
    expect(body.title).toBe("Kyoto");
  });

  it("rejects a stop whose place id was not part of the run's candidates", async () => {
    const { service, mocks } = harness(
      plannedRun({
        plannedCalls: [
          { tool: "stops.add", args: { tripId: TRIP_ID, providerPlaceId: "N:999999" } },
        ],
        candidates: [],
      }),
    );

    const response = await service.execute(
      actorStub() as never,
      membershipStub() as never,
      RUN_ID,
      {
        calls: [{ tool: "stops.add", args: { tripId: TRIP_ID, providerPlaceId: "N:999999" } }],
        idempotencyKey: "execute-once-8",
      },
    );

    expect(response.results[0]).toMatchObject({
      tool: "stops.add",
      ok: false,
      error: { code: "UNRESOLVED_PLACE" },
    });
    expect(mocks.stops.create).not.toHaveBeenCalled();
    expect(STOP_ID).toBeTruthy();
    expect(aiSettings().configured).toBe(true);
  });
});