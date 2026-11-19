import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { AuthService } from "../auth.service.js";
import type { EmailDeliveryService } from "../email-delivery.service.js";
import { AuthController } from "../auth.controller.js";

function logger(): PinoLoggerService {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as PinoLoggerService;
}

function request(path: string, body: Record<string, unknown> = {}): Request {
  return {
    originalUrl: path,
    url: path,
    method: "POST",
    body,
    headers: {},
    header: () => undefined,
  } as unknown as Request;
}

function expressResponse() {
  const res = {
    statusCode: 200,
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function controller(options: {
  configured: boolean;
  response?: Response;
  handleWebRequest?: ReturnType<typeof vi.fn>;
}) {
  const auth = {
    handleWebRequest:
      options.handleWebRequest ??
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ token: null, user: { id: "user-1", email: "new@roamlog.test" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
  } as unknown as AuthService;
  const config = { betterAuthUrl: "http://localhost:4000" } as unknown as AppConfigService;
  const email = {
    isConfigured: vi.fn().mockResolvedValue(options.configured),
  } as unknown as EmailDeliveryService;
  return new AuthController(auth, config, email, logger());
}

function readBody(response: ReturnType<typeof expressResponse>): Record<string, unknown> {
  const [buffer] = response.end.mock.calls[0] as [Buffer];
  return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
}

describe("AuthController mail behaviour", () => {
  it("keeps registration successful with emailDelivery=not_configured", async () => {
    const response = expressResponse();
    const controllerUnderTest = controller({ configured: false });

    await controllerUnderTest.handle(
      request("/v1/auth/sign-up/email", { email: "new@roamlog.test", password: "secret" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(readBody(response)).toMatchObject({
      emailDelivery: "not_configured",
      user: { email: "new@roamlog.test" },
    });
  });

  it("fails the explicit verification resend with a readable 503 code", async () => {
    const response = expressResponse();
    const handleWebRequest = vi.fn();
    const controllerUnderTest = controller({ configured: false, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/send-verification-email", { email: "new@roamlog.test" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MAIL_NOT_CONFIGURED", message: expect.stringContaining("Admin settings") }),
    );
    // No token is minted and no transport is attempted for a doomed send.
    expect(handleWebRequest).not.toHaveBeenCalled();
  });

  it("answers the reset request honestly without a 500", async () => {
    const response = expressResponse();
    const handleWebRequest = vi.fn();
    const controllerUnderTest = controller({ configured: false, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/forget-password", { email: "someone@roamlog.test" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: true, emailDelivery: "not_configured" });
    expect(handleWebRequest).not.toHaveBeenCalled();
  });

  it("leaves a configured registration response untouched", async () => {
    const response = expressResponse();
    const controllerUnderTest = controller({ configured: true });

    await controllerUnderTest.handle(
      request("/v1/auth/sign-up/email", { email: "new@roamlog.test", password: "secret" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(readBody(response)).not.toHaveProperty("emailDelivery");
  });
});