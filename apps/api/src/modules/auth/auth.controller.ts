import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { redactUrlPathForLogging } from "../../common/services/log-redaction.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AuthService } from "./auth.service.js";

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
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @All("*path")
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    const rawUrl = request.originalUrl || request.url;
    const target = new URL(rawUrl, this.config.betterAuthUrl);
    const logPath = redactUrlPathForLogging(rawUrl);
    request.url = logPath;
    request.originalUrl = logPath;
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

    const bodyBuffer = Buffer.from(await webResponse.arrayBuffer());
    response.end(bodyBuffer);
  }
}
