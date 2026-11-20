import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import type { AppConfigService } from "../../../config/app-config.service.js";
import { MailDeliveryError, type MailService } from "../../email/mail.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import type { AuthService } from "../auth.service.js";
import { EmailDeliveryService } from "../email-delivery.service.js";
import { AuthController } from "../auth.controller.js";

/**
 * Route contract for the password-reset gateway.
 *
 * Better Auth 1.7 mounts the endpoint at `/request-password-reset`
 * (`createAuthEndpoint("/request-password-reset")`); the gateway used to answer
 * `/forget-password`, which does not exist upstream, so the frontend got a 404
 * and the "mail not configured" branch below was unreachable.
 */

function logger(): PinoLoggerService {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as PinoLoggerService;
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

function controller(options: { configured: boolean; handleWebRequest: ReturnType<typeof vi.fn> }) {
  const auth = { handleWebRequest: options.handleWebRequest } as unknown as AuthService;
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

/** A real delivery service whose transport is down, as in a stopped relay. */
function deliveryWith(transport: "sent" | "down"): EmailDeliveryService {
  const prismaClient = {
    client: {
      emailLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as PrismaService;
  const mailer = {
    send:
      transport === "down"
        ? vi.fn().mockRejectedValue(new MailDeliveryError("CONNECTION_FAILED", "unreachable"))
        : vi.fn().mockResolvedValue({ provider: "smtp", providerId: "<msg@roamlog.test>", latencyMs: 4 }),
  };
  return new EmailDeliveryService(
    { apiUrl: "http://localhost:4000" } as unknown as AppConfigService,
    prismaClient,
    logger(),
    mailer as unknown as MailService,
  );
}

describe("AuthController password reset route", () => {
  it("answers /v1/auth/request-password-reset with the honest delivery marker when mail is off", async () => {
    const response = expressResponse();
    const handleWebRequest = vi.fn();
    const controllerUnderTest = controller({ configured: false, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/request-password-reset", { email: "verify@roamlog.test" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: true, emailDelivery: "not_configured" });
    // No token is minted and no transport is attempted for a doomed send.
    expect(handleWebRequest).not.toHaveBeenCalled();
  });

  it("forwards a mail-configured reset request to better-auth and keeps its body", async () => {
    const response = expressResponse();
    const handleWebRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: "If this email exists in our system, check your email for the reset link",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const controllerUnderTest = controller({ configured: true, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/request-password-reset", { email: "verify@roamlog.test" }),
      response,
    );

    expect(handleWebRequest).toHaveBeenCalledTimes(1);
    const [forwarded] = handleWebRequest.mock.calls[0] as [Request];
    expect(new URL(forwarded.url).pathname).toBe("/v1/auth/request-password-reset");

    expect(response.status).toHaveBeenCalledWith(200);
    const body = readBody(response);
    expect(body).toMatchObject({
      status: true,
      message: "If this email exists in our system, check your email for the reset link",
    });
    // A real send carries no marker: only "nothing was delivered" is asserted.
    expect(body).not.toHaveProperty("emailDelivery");
  });

  it("reports emailDelivery=failed when better-auth answers 200 but the relay rejected the mail", async () => {
    const response = expressResponse();
    const delivery = deliveryWith("down");
    const handleWebRequest = vi.fn(async () => {
      // better-auth awaits sendResetPassword and swallows the rejection
      // (dist/context/create-context.mjs:215-224), still answering 200.
      await delivery
        .sendPasswordResetEmail(
          { email: "verify@roamlog.test", name: "Verify" },
          "http://localhost:4000/v1/auth/reset-password/token",
        )
        .catch(() => undefined);
      return new Response(
        JSON.stringify({
          status: true,
          message: "If this email exists in our system, check your email for the reset link",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const controllerUnderTest = controller({ configured: true, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/request-password-reset", { email: "verify@roamlog.test" }),
      response,
    );

    // The status stays 200 (the user's request was well-formed); the marker is
    // what stops the UI from claiming a link that never left.
    expect(response.status).toHaveBeenCalledWith(200);
    expect(readBody(response)).toMatchObject({ status: true, emailDelivery: "failed" });
  });

  it("leaves a reset request unmarked when the mail really went out", async () => {
    const response = expressResponse();
    const delivery = deliveryWith("sent");
    const handleWebRequest = vi.fn(async () => {
      await delivery.sendPasswordResetEmail(
        { email: "verify@roamlog.test", name: "Verify" },
        "http://localhost:4000/v1/auth/reset-password/token",
      );
      return new Response(
        JSON.stringify({
          status: true,
          message: "If this email exists in our system, check your email for the reset link",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const controllerUnderTest = controller({ configured: true, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/request-password-reset", { email: "verify@roamlog.test" }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(readBody(response)).not.toHaveProperty("emailDelivery");
  });

  it("no longer special-cases the removed /v1/auth/forget-password route", async () => {
    const response = expressResponse();
    const handleWebRequest = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404, headers: { "content-type": "text/plain" } }),
    );
    const controllerUnderTest = controller({ configured: false, handleWebRequest });

    await controllerUnderTest.handle(
      request("/v1/auth/forget-password", { email: "verify@roamlog.test" }),
      response,
    );

    // The old path is not a mail route any more: it goes to better-auth and gets
    // whatever better-auth answers (404), never the fabricated 200 marker.
    expect(handleWebRequest).toHaveBeenCalledTimes(1);
    expect(response.json).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
  });
});