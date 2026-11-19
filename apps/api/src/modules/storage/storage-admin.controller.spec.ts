import { describe, expect, it, vi } from "vitest";

import type { Response } from "express";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { StorageAdminController } from "./storage-admin.controller.js";
import type { StorageProbeResult } from "./storage-probe.service.js";

const ACTOR = {
  user: { id: "0190f2c0-0000-7000-8000-000000000001" },
  ip: "127.0.0.1",
  userAgent: "vitest",
} as unknown as AuthenticatedActor;

function response(): Response {
  return { status: vi.fn() } as unknown as Response;
}

function setup(result: StorageProbeResult) {
  const probe = { run: vi.fn(async () => result) };
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) };
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() };
  const controller = new StorageAdminController(
    probe as never,
    audit as never,
    logger as never,
  );
  return { controller, probe, audit, logger };
}

const SUCCESS: StorageProbeResult = {
  ok: true,
  checks: [
    { name: "HeadBucket", ok: true, ms: 1 },
    { name: "PutObject", ok: true, ms: 1 },
    { name: "GetObject", ok: true, ms: 1 },
    { name: "PresignedGet", ok: true, ms: 1 },
    { name: "DeleteObject", ok: true, ms: 1 },
  ],
  bucket: "roamlog-probe",
  endpoint: "http://127.0.0.1:19999",
  publicEndpoint: "https://media.example.com",
};

const FAILURE: StorageProbeResult = {
  ok: false,
  checks: [{ name: "HeadBucket", ok: false, ms: 3 }],
  failedAt: "HeadBucket",
  code: "STORAGE_ENDPOINT_UNREACHABLE",
  message: "The endpoint could not be reached (ECONNREFUSED).",
  bucket: "roamlog-probe",
  endpoint: "http://127.0.0.1:19999",
  publicEndpoint: "https://media.example.com",
};

describe("StorageAdminController probe route", () => {
  it("returns 200 with the probe payload and audits only non-secret coordinates", async () => {
    const harness = setup(SUCCESS);

    const result = await harness.controller.test(ACTOR, response());

    expect(result).toBe(SUCCESS);
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR.user.id,
        actorType: "admin",
        action: "admin.storage.probe",
        targetType: "storage",
        targetId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
        ),
        metadata: {
          ok: true,
          bucket: "roamlog-probe",
          endpoint: "http://127.0.0.1:19999",
        },
      }),
    );
    const audited = JSON.stringify(harness.audit.record.mock.calls);
    expect(audited).not.toContain("AKIA");
    expect(audited).not.toContain("SECRET");
  });

  it("sets 422 and still returns the checks when the probe fails", async () => {
    const harness = setup(FAILURE);
    const res = response();

    const result = await harness.controller.test(ACTOR, res);

    expect(result).toBe(FAILURE);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { ok: false, bucket: "roamlog-probe", endpoint: "http://127.0.0.1:19999" },
      }),
    );
  });

  it("does not fail the probe when the audit write fails", async () => {
    const harness = setup(SUCCESS);
    harness.audit.record.mockRejectedValueOnce(new Error("db down"));

    const result = await harness.controller.test(ACTOR, response());

    expect(result).toBe(SUCCESS);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.storage.probe" }),
      "storage.probe_audit_failed",
    );
  });
});