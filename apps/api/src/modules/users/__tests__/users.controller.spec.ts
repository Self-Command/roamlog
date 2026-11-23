import { UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import type { AppConfigService } from "../../../config/app-config.service.js";
import { makeActor } from "../../../../test/identity-fixtures.js";
import { UsersController } from "../users.controller.js";
import type { UsersService } from "../users.service.js";

const SESSION_ID = "01942f30-1200-7000-8000-000000000401";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setup() {
  const users = {
    associateDevice: vi.fn().mockResolvedValue({ message: "Device associated." }),
  };
  const config = { isProduction: true } as AppConfigService;
  const controller = new UsersController(users as unknown as UsersService, config);
  return { users, controller };
}

function request(cookies: Record<string, string> = {}): AuthenticatedRequest {
  return {
    authSession: { sessionId: SESSION_ID, userId: "user", expiresAt: null },
    cookies,
    secure: false,
  } as AuthenticatedRequest;
}

describe("UsersController device registration", () => {
  it("sets an HttpOnly device cookie and associates the current session", async () => {
    const { controller, users } = setup();
    const response = { cookie: vi.fn() } as unknown as Response;
    const actor = makeActor();

    await controller.associateDevice(actor, request(), response);

    expect(response.cookie).toHaveBeenCalledWith(
      "roamlog.device_id",
      expect.stringMatching(UUID_V7),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      }),
    );
    expect(users.associateDevice).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: actor.user.id }) }),
      SESSION_ID,
      expect.stringMatching(UUID_V7),
    );
  });

  it("reuses a valid existing device id", async () => {
    const { controller, users } = setup();
    const response = { cookie: vi.fn() } as unknown as Response;
    const deviceId = "01942f30-1200-7000-8000-0000000004d1";

    await controller.associateDevice(
      makeActor(),
      request({ "roamlog.device_id": deviceId }),
      response,
    );

    expect(users.associateDevice).toHaveBeenCalledWith(expect.anything(), SESSION_ID, deviceId);
  });

  it("rejects a request without a resolved session", async () => {
    const { controller } = setup();
    const response = { cookie: vi.fn() } as unknown as Response;

    await expect(
      controller.associateDevice(makeActor(), { cookies: {} } as AuthenticatedRequest, response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
