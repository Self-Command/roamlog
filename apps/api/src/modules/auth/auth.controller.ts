import { All, Controller, Inject, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthMutationRateLimitGuard } from "../../common/security/auth-mutation-rate-limit.guard.js";
import { redactUrlPathForLogging } from "../../common/services/log-redaction.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { AuthService } from "./auth.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

const SIGN_UP_PATH = "/v1/auth/sign-up/email";
const FORGET_PASSWORD_PATH = "/v1/auth/forget-password";
const SEND_VERIFICATION_PATH = "/v1/auth/send-verification-email";
const MAIL_NOT_CONFIGURED_CODE = "MAIL_NOT_CONFIGURED";

const SKIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);
const SKIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

function requestBody(request: Request): BodyInit | undefined {
  if (request.method === "GET" || request.method === "HEAD" || request.body === undefined) {
    return undefined;
  }
  if (typeof request.body === "string") {
    return request.body;
  }
  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }

  const contentType = request.header("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const values = new URLSearchParams();
    for (const [key, value] of Object.entries(request.body as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          values.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        values.append(key, String(value));
      }
    }
    return values;
  }

  return JSON.stringify(request.body);
}

function webHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (SKIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

@Controller("auth")
@UseGuards(AuthMutationRateLimitGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(EmailDeliveryService) private readonly email: EmailDeliveryService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  @All("*path")
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    const rawUrl = request.originalUrl || request.url;
    const target = new URL(rawUrl, this.config.betterAuthUrl);
    const logPath = redactUrlPathForLogging(rawUrl);
    request.url = logPath;
    request.originalUrl = logPath;

    // Mail-dependent auth routes need an explicit answer when no transport is
    // configured: silently accepting the request would pretend an email went
    // out. Registration and the reset request still succeed (no 500), but the
    // response tells the client that no email was delivered.
    const mailConfigured = this.needsMailCheck(target.pathname)
      ? await this.email.isConfigured()
      : true;

    if (!mailConfigured && target.pathname === SEND_VERIFICATION_PATH) {
      this.logger.warn(
        { event: "mail.not_configured", route: "send-verification-email" },
        "mail.not_configured",
      );
      response.status(503).json({
        code: MAIL_NOT_CONFIGURED_CODE,
        message:
          "Email delivery is not configured. An administrator must set the mail provider, transport and from address in Admin settings.",
      });
      return;
    }

    if (!mailConfigured && target.pathname === FORGET_PASSWORD_PATH) {
      this.logger.warn(
        { event: "mail.not_configured", route: "forget-password" },
        "mail.not_configured",
      );
      // Same generic body better-auth returns, plus the honest delivery marker.
      response.status(200).json({ status: true, emailDelivery: "not_configured" });
      return;
    }

    const body = requestBody(request);
    const webResponse = await this.auth.handleWebRequest(
      new Request(target, {
        method: request.method,
        headers: webHeaders(request),
        ...(body === undefined ? {} : { body }),
      }),
    );

    response.status(webResponse.status);
    webResponse.headers.forEach((value, name) => {
      if (!SKIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
        response.setHeader(name, value);
      }
    });

    const cookies = webResponse.headers.getSetCookie();
    if (cookies.length > 0) {
      response.setHeader("set-cookie", cookies);
    }

    let bodyBuffer: Buffer = Buffer.from(await webResponse.arrayBuffer());
    if (!mailConfigured && target.pathname === SIGN_UP_PATH && webResponse.ok) {
      this.logger.warn({ event: "mail.not_configured", route: "sign-up" }, "mail.not_configured");
      bodyBuffer = withEmailDeliveryMarker(bodyBuffer, "not_configured");
    }
    response.end(bodyBuffer);
  }

  private needsMailCheck(pathname: string): boolean {
    return (
      pathname === SIGN_UP_PATH ||
      pathname === FORGET_PASSWORD_PATH ||
      pathname === SEND_VERIFICATION_PATH
    );
  }
}

/**
 * Adds `emailDelivery` to a better-auth JSON body without disturbing any other
 * field. A non-JSON or malformed body is returned untouched.
 */
function withEmailDeliveryMarker(body: Buffer, emailDelivery: string): Buffer {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return body;
    }
    return Buffer.from(JSON.stringify({ ...parsed, emailDelivery }), "utf8");
  } catch {
    return body;
  }
}
