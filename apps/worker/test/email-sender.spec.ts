import { UnrecoverableError } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerLoggerLike } from "../src/jobs/types.js";
import {
  createEmailSender,
  EmailDeliveryError,
  NonRetryableEmailError,
} from "../src/dependencies.js";

interface LoggedCall {
  level: "debug" | "info" | "warn" | "error";
  context: Record<string, unknown>;
  message: string;
}

const ORIGINAL_ENV = { ...process.env };

const message = {
  to: "explorer@roamlog.test",
  subject: "验证你的 Roamlog 邮箱",
  html: "<p>打开链接完成验证</p>",
  text: "打开链接完成验证",
  idempotencyKey: "email-job-42",
};

function configure(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createLoggerSpy(): { logger: WorkerLoggerLike; calls: LoggedCall[] } {
  const calls: LoggedCall[] = [];
  const record =
    (level: LoggedCall["level"]) => (context: Record<string, unknown>, text: string) => {
      calls.push({ level, context, message: text });
    };

  return {
    calls,
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
}

const productionResend = {
  APP_ENV: "production",
  NODE_ENV: "production",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "Roamlog <no-reply@roamlog.app>",
  RESEND_API_KEY: "re_live_worker_key",
  SMTP_HOST: undefined,
} as const;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("worker email sender: Resend", () => {
  it("posts to Resend and returns the provider id", async () => {
    configure({ ...productionResend, APP_ENV: "staging" });
    const { logger, calls } = createLoggerSpy();
    const fetchMock = vi.fn(async () => Response.json({ id: "resend-email-id" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createEmailSender(logger)(message);

    expect(result).toEqual({ providerId: "resend-email-id" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("email-job-42");
    expect((init.headers as Record<string, string>).Authorization).toContain("re_live_worker_key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: "Roamlog <no-reply@roamlog.app>",
      to: ["explorer@roamlog.test"],
      subject: message.subject,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toMatchObject({
      transport: "resend",
      status: 200,
      providerId: "resend-email-id",
    });
  });

  it("falls back to the idempotency key when Resend omits an id", async () => {
    configure(productionResend);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 202 })),
    );

    await expect(createEmailSender()(message)).resolves.toEqual({
      providerId: "email-job-42",
    });
  });

  it("treats 5xx and rate limits as retryable", async () => {
    configure(productionResend);

    for (const status of [500, 503, 429]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({}, { status })),
      );
      const error = await createEmailSender()(message).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect(error).not.toBeInstanceOf(UnrecoverableError);
      expect((error as EmailDeliveryError).status).toBe(status);
      expect((error as EmailDeliveryError).transport).toBe("resend");
    }
  });

  it("treats bad credentials and rejected senders as permanent", async () => {
    configure(productionResend);

    for (const status of [401, 403, 422]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({}, { status })),
      );
      const error = await createEmailSender()(message).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NonRetryableEmailError);
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect((error as NonRetryableEmailError).status).toBe(status);
    }
  });

  it("retries when the request never reaches Resend", async () => {
    configure(productionResend);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).message).toContain("before a response");
  });

  it("fails permanently without an API key", async () => {
    configure({ ...productionResend, RESEND_API_KEY: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect((error as Error).message).toContain("RESEND_API_KEY is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a .local sender in production", async () => {
    configure({ ...productionResend, EMAIL_FROM: "Roamlog <hello@roamlog.local>" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect((error as Error).message).toContain(".local");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs the API key or the provider response body", async () => {
    configure(productionResend);
    const { logger, calls } = createLoggerSpy();
    const providerBody =
      "validation_error: API key re_LIVE_SECRET is invalid for explorer@roamlog.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: providerBody }), { status: 401 })),
    );

    const error = await createEmailSender(logger)(message).catch((caught: unknown) => caught);
    const logged = JSON.stringify(calls);

    expect((error as Error).message).not.toContain("re_LIVE_SECRET");
    expect((error as Error).message).not.toContain("explorer@roamlog.test");
    expect(logged).not.toContain("re_LIVE_SECRET");
    expect(logged).not.toContain(providerBody);
    expect(logged).not.toContain("re_live_worker_key");
    expect(calls[0]?.context).toMatchObject({ transport: "resend", status: 401, retryable: false });
  });
});

describe("worker email sender: transport guardrails", () => {
  it("rejects the mailpit transport in production without calling the catcher", async () => {
    configure({
      APP_ENV: "production",
      NODE_ENV: "production",
      EMAIL_PROVIDER: "mailpit",
      EMAIL_FROM: "Roamlog <no-reply@roamlog.app>",
      MAILPIT_URL: "http://mailpit-catcher:8025",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toContain("mailpit is disabled in production");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the legacy NODE_ENV=production guard for the old staging override", async () => {
    configure({
      APP_ENV: undefined,
      NODE_ENV: "production",
      EMAIL_PROVIDER: "mailpit",
      MAILPIT_URL: "http://mailpit-catcher:8025",
    });
    vi.stubGlobal("fetch", vi.fn());

    await expect(createEmailSender()(message)).rejects.toBeInstanceOf(NonRetryableEmailError);
  });

  it("allows mailpit when a deployment declares APP_ENV=staging", async () => {
    configure({
      APP_ENV: "staging",
      NODE_ENV: "production",
      EMAIL_PROVIDER: "mailpit",
      EMAIL_FROM: "Roamlog Staging <staging@staging.roamlog.app>",
      MAILPIT_URL: "http://mailpit-catcher:8025/",
    });
    const fetchMock = vi.fn(async () => Response.json({ ID: "mailpit-id" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createEmailSender()(message)).resolves.toEqual({ providerId: "mailpit-id" });
    const [requestedUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(requestedUrl).toBe("http://mailpit-catcher:8025/api/v1/send");
  });

  it("explains that the worker image has no SMTP client", async () => {
    configure({ APP_ENV: "production", NODE_ENV: "production", EMAIL_PROVIDER: "smtp" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect((error as Error).message).toContain("not supported by the worker image");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown provider value", async () => {
    configure({ EMAIL_PROVIDER: "sendgrid" });
    vi.stubGlobal("fetch", vi.fn());

    const error = await createEmailSender()(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect((error as Error).message).toContain("Unsupported EMAIL_PROVIDER");
  });
});
