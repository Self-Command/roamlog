import { afterEach, describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { MailRuntime, MailSettingsSource } from "../../settings/mail-settings.consumer.js";
import {
  MailDeliveryError,
  MailService,
  MAIL_TRANSPORT_TTL_MS,
  RESEND_TIMEOUT_MS,
} from "../mail.service.js";

type Fn = ReturnType<typeof vi.fn>;

interface FakeLogger {
  log: Fn;
  warn: Fn;
  error: Fn;
  debug: Fn;
}

function logger(): FakeLogger & PinoLoggerService {
  const fake = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return fake as unknown as FakeLogger & PinoLoggerService;
}

function createTransportSpy() {
  return vi.spyOn(
    MailService.prototype as unknown as {
      createSmtpTransport: (runtime: { host: string }) => Promise<unknown>;
    },
    "createSmtpTransport",
  );
}

function sourceReturning(...runtimes: MailRuntime[]): MailSettingsSource & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    resolve: async () => {
      const runtime = runtimes[Math.min(calls, runtimes.length - 1)]!;
      calls += 1;
      return runtime;
    },
  };
}

function smtpRuntime(overrides: Partial<Extract<MailRuntime, { provider: "smtp" }>> = {}) {
  return {
    configured: true,
    provider: "smtp",
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    from: "Roamlog <verify@roamlog.test>",
    source: "db",
    ...overrides,
  } as MailRuntime;
}

const MESSAGE = {
  to: "recipient@roamlog.test",
  subject: "Test",
  html: "<p>Hello</p>",
  text: "Hello",
};

function installTransport(sendMail: Fn) {
  return createTransportSpy().mockResolvedValue({ sendMail } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MailService", () => {
  it("sends over SMTP and reports the provider latency", async () => {
    const log = logger();
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<msg-1@roamlog.test>" });
    installTransport(sendMail);
    const service = new MailService(sourceReturning(smtpRuntime()), log);

    const result = await service.send(MESSAGE);

    expect(result.provider).toBe("smtp");
    expect(result.providerId).toBe("<msg-1@roamlog.test>");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Roamlog <verify@roamlog.test>",
        to: "recipient@roamlog.test",
        subject: "Test",
      }),
    );
    // The log line names the domain, never the full recipient.
    const logged = JSON.stringify(log.log.mock.calls);
    expect(logged).not.toContain("recipient@roamlog.test");
    expect(logged).toContain("roamlog.test");
  });

  it("sends over the Resend HTTPS API and never logs the API key", async () => {
    const log = logger();
    const apiKey = "re_sentinel_api_key_123456";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "re_provider_id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = new MailService(
      sourceReturning({
        configured: true,
        provider: "resend",
        apiKey,
        from: "Roamlog <verify@roamlog.test>",
        source: "db",
      }),
      log,
    );
    (service as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchMock;

    const result = await service.send(MESSAGE);

    expect(result.provider).toBe("resend");
    expect(result.providerId).toBe("re_provider_id");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.stringify(log.log.mock.calls)).not.toContain(apiKey);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(apiKey);
  });

  it("bounds Resend requests with a 10 second abort signal and classifies a timeout as retryable", async () => {
    const log = logger();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const service = new MailService(
      sourceReturning({
        configured: true,
        provider: "resend",
        apiKey: "re_key",
        from: "Roamlog <verify@roamlog.test>",
        source: "db",
      }),
      log,
    );
    (service as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchMock as never;

    const error = await service.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).code).toBe("CONNECTION_FAILED");
    expect((error as MailDeliveryError).retryable).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Fixed 10s ceiling; the exact delay is documented next to RESEND_TIMEOUT_MS.
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
  });

  it("classifies EAUTH as a permanent authentication failure without echoing the password", async () => {
    const log = logger();
    const password = "smtp-password-sentinel-value";
    const authError = Object.assign(new Error("535 auth failed for recipient@roamlog.test"), {
      code: "EAUTH",
      responseCode: 535,
    });
    const service = new MailService(
      sourceReturning(smtpRuntime({ user: "roamlog", password })),
      log,
    );
    createTransportSpy().mockResolvedValue({
      sendMail: vi.fn().mockRejectedValue(authError),
    } as never);

    const error = await service.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).code).toBe("AUTH_FAILED");
    expect((error as MailDeliveryError).retryable).toBe(false);
    const everything = JSON.stringify({
      logged: [...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls],
      message: (error as Error).message,
    });
    expect(everything).not.toContain(password);
    expect(everything).not.toContain("recipient@roamlog.test");
  });

  it("classifies ETIMEDOUT as a retryable connection failure", async () => {
    const log = logger();
    const service = new MailService(sourceReturning(smtpRuntime()), log);
    createTransportSpy().mockResolvedValue({
      sendMail: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
    } as never);

    const error = await service.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).code).toBe("CONNECTION_FAILED");
    expect((error as MailDeliveryError).retryable).toBe(true);
  });

  it("classifies EENVELOPE as a permanent rejection", async () => {
    const service = new MailService(sourceReturning(smtpRuntime()), logger());
    createTransportSpy().mockResolvedValue({
      sendMail: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("envelope"), { code: "EENVELOPE" })),
    } as never);

    const error = await service.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).code).toBe("REJECTED");
    expect((error as MailDeliveryError).retryable).toBe(false);
  });

  it("never pretends a send worked when mail is not configured", async () => {
    const log = logger();
    const runtime: MailRuntime = {
      configured: false,
      provider: "smtp",
      missing: ["mail.smtpHost", "mail.from"],
      source: "default",
    };
    const service = new MailService(sourceReturning(runtime), log);

    const error = await service.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).code).toBe("NOT_CONFIGURED");
    expect((error as MailDeliveryError).retryable).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "mail.not_configured", missing: runtime.missing }),
      "mail.not_configured",
    );
  });

  it("re-resolves the transport within the 30s window so an admin change applies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00.000Z"));
    const log = logger();
    const create = createTransportSpy().mockImplementation(async (runtime) => {
      return { sendMail: vi.fn().mockResolvedValue({ messageId: `<${runtime.host}>` }) } as never;
    });
    const service = new MailService(
      sourceReturning(
        smtpRuntime({ host: "first.relay.example" }),
        smtpRuntime({ host: "second.relay.example" }),
      ),
      log,
    );

    const first = await service.send(MESSAGE);
    expect(first.providerId).toBe("<first.relay.example>");

    // A settings save during the same 30s window must reach the next send.
    await vi.advanceTimersByTimeAsync(5_000);
    const second = await service.send(MESSAGE);
    expect(second.providerId).toBe("<second.relay.example>");
    expect(create).toHaveBeenCalledTimes(2);

    // Unchanged config reuses the transport until 30s have elapsed, then rebuilds.
    await vi.advanceTimersByTimeAsync(MAIL_TRANSPORT_TTL_MS);
    const third = await service.send(MESSAGE);
    expect(third.providerId).toBe("<second.relay.example>");
    expect(create).toHaveBeenCalledTimes(3);
  });
});