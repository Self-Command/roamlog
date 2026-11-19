import { describe, expect, it } from "vitest";

import { AdminSettingsError } from "../../lib/admin-settings-api";
import {
  PROBE_COPY_TABLE,
  credentialNotesFor,
  failedAtOf,
  probeCopyFor,
  probeFallbackCopy,
  settingsProbeFromError,
  type SettingsProbe,
} from "./probe-error-copy";

function probeOf(
  target: SettingsProbe["target"],
  code: string,
  checks: SettingsProbe["checks"] = [],
): SettingsProbe {
  return { target, code, checks };
}

const NATIVE_CODE = (headline: string): boolean =>
  /^[A-Z][A-Z0-9_]{3,}$/.test(headline.split(/[：:]/)[0]?.trim() ?? "");

describe("probeCopyFor", () => {
  it("names the current endpoint when the storage endpoint is unreachable", () => {
    const copy = probeCopyFor(probeOf("storage", "STORAGE_ENDPOINT_UNREACHABLE"), {
      endpoint: "http://127.0.0.1:19999",
      detail: "The endpoint could not be reached (ECONNREFUSED).",
    });

    expect(copy.headline).toBe(
      "存储服务无法连接：检查 endpoint 与网络（当前 endpoint: http://127.0.0.1:19999）",
    );
    expect(copy.eyebrow).toBe("保存被拦截 · 存储");
    expect(copy.headline).not.toContain("STORAGE_ENDPOINT_UNREACHABLE");
    expect(NATIVE_CODE(copy.headline)).toBe(false);
  });

  it("says 未配置 instead of an empty endpoint placeholder", () => {
    const copy = probeCopyFor(probeOf("storage", "STORAGE_ENDPOINT_UNREACHABLE"));

    expect(copy.headline).toContain("当前 endpoint: 未配置");
  });

  it("asks for the storage credential pair when nothing is configured", () => {
    const copy = probeCopyFor(probeOf("storage", "MISSING_CREDENTIALS"));

    expect(copy.headline).toBe("缺少访问凭据：请先填写 Access Key 与 Secret Key");
    expect(copy.credentialNotes).toMatchObject({
      "storage.accessKey": expect.stringContaining("Access Key"),
      "storage.secretKey": expect.stringContaining("Secret Key"),
    });
  });

  it("explains the public endpoint / CORS failure", () => {
    const copy = probeCopyFor(
      probeOf("storage", "STORAGE_PUBLIC_ENDPOINT_UNREACHABLE", [
        { name: "PresignedGet", ok: false, ms: 5_102 },
      ]),
    );

    expect(copy.headline).toBe(
      "对外访问地址不可达：浏览器可能无法加载图片，检查 publicEndpoint 与 CORS",
    );
    expect(copy.failedAt).toBe("PresignedGet");
  });

  it("maps every other storage code to the bucket/permission hint", () => {
    const checks = [
      { name: "HeadBucket", ok: true, ms: 95 },
      { name: "PutObject", ok: false, ms: 41 },
    ];
    const copy = probeCopyFor(probeOf("storage", "STORAGE_READ_MISMATCH", checks), {
      detail: "The probe object could not be written.",
    });

    expect(copy.headline).toBe("Bucket 不存在或无权访问：检查 bucket 名称与权限");
    expect(copy.failedAt).toBe("PutObject");
    expect(copy.body).toContain("The probe object could not be written.");
    expect(copy.headline).not.toContain("STORAGE_READ_MISMATCH");
  });

  it("uses the HeadBucket step as the bucket hint even before the code is known", () => {
    const copy = probeCopyFor(
      probeOf("storage", "SOMETHING_NEW_FROM_THE_API", [
        { name: "HeadBucket", ok: false, ms: 117 },
      ]),
    );

    expect(copy.headline).toBe("Bucket 不存在或无权访问：检查 bucket 名称与权限");
    expect(copy.failedAt).toBe("HeadBucket");
  });

  it("tells the operator which mail port/TLS mode to check", () => {
    const copy = probeCopyFor(probeOf("mail", "CONNECTION_FAILED"));

    expect(copy.headline).toBe(
      "无法连接邮件服务器：检查 host 与 port（465 用隐式 TLS，587 用 STARTTLS）",
    );
    expect(copy.eyebrow).toBe("保存被拦截 · 邮件");
  });

  it("distinguishes SMTP auth from the account login password", () => {
    const copy = probeCopyFor(probeOf("mail", "AUTH_FAILED"), {
      detail: "The SMTP server rejected the credentials.",
    });

    expect(copy.headline).toBe("SMTP 认证被拒：检查用户名与应用专用密码（不是账号登录密码）");
    // The English server detail is technical only; it must not replace the copy.
    expect(copy.body).toBeUndefined();
  });

  it("flags mail.from plus the resend key for the default provider", () => {
    const copy = probeCopyFor(probeOf("mail", "MISSING_CREDENTIALS"), {
      provider: "resend",
    });

    expect(copy.headline).toBe("缺少 mail.from 或凭据配置");
    expect(Object.keys(copy.credentialNotes).sort()).toEqual([
      "mail.from",
      "mail.resendApiKey",
    ]);
  });

  it("flags the SMTP pair when the provider is smtp", () => {
    const notes = credentialNotesFor("mail", "smtp");

    expect(Object.keys(notes).sort()).toEqual([
      "mail.from",
      "mail.smtpPassword",
      "mail.smtpUser",
    ]);
  });

  it("explains an unavailable probe for both transports", () => {
    for (const target of ["storage", "mail"] as const) {
      const copy = probeCopyFor(probeOf(target, "PROBE_UNAVAILABLE"));

      expect(copy.headline).toBe("探测服务不可用，配置未保存。可稍后重试");
    }
    expect(PROBE_COPY_TABLE.storage.PROBE_UNAVAILABLE).toBe(
      PROBE_COPY_TABLE.mail.PROBE_UNAVAILABLE,
    );
  });

  it("shows the server detail for an unknown mail code instead of the raw code", () => {
    const detail = "The SMTP transport timed out after 10 seconds.";
    const copy = probeCopyFor(probeOf("mail", "SMTP_TIMEOUT_UNKNOWN"), { detail });

    expect(copy.headline).toBe(detail);
    expect(copy.headline).not.toContain("SMTP_TIMEOUT_UNKNOWN");
    expect(copy.body).toBe("邮件探测未通过：检查 host、端口、用户名与密码");
  });

  it("never leaks an unknown code into the headline when the server sent no detail", () => {
    const copy = probeCopyFor(probeOf("mail", "SOME_FUTURE_CODE"));

    expect(copy.headline).toBe("邮件探测未通过：检查 host、端口、用户名与密码");
    expect(copy.headline).not.toContain("SOME_FUTURE_CODE");
    expect(copy.credentialNotes).toEqual({});
  });

  it("does not attach credential notes unless the code says they are missing", () => {
    const copy = probeCopyFor(probeOf("storage", "STORAGE_ENDPOINT_UNREACHABLE"));

    expect(copy.credentialNotes).toEqual({});
  });
});

describe("failedAtOf", () => {
  it("returns the first failing step and null when everything passed", () => {
    expect(
      failedAtOf([
        { name: "HeadBucket", ok: true, ms: 95 },
        { name: "PutObject", ok: false, ms: 41 },
        { name: "GetObject", ok: false, ms: 12 },
      ]),
    ).toBe("PutObject");
    expect(failedAtOf([{ name: "HeadBucket", ok: true, ms: 95 }])).toBeNull();
    expect(failedAtOf([])).toBeNull();
  });
});

describe("probeFallbackCopy", () => {
  it("still explains the block when the probe payload is missing", () => {
    const copy = probeFallbackCopy("The upstream probe failed.");

    expect(copy.headline).toBe("保存前探测失败，配置未写入");
    expect(copy.body).toBe("The upstream probe failed.");
    expect(copy.headline).not.toContain("SETTINGS_PROBE_FAILED");
  });
});

describe("settingsProbeFromError", () => {
  const probe = {
    target: "storage" as const,
    code: "STORAGE_ENDPOINT_UNREACHABLE",
    checks: [{ name: "HeadBucket", ok: false, ms: 117 }],
  };

  it("reads the probe off AdminSettingsError.failure", () => {
    const error = new AdminSettingsError({
      code: "SETTINGS_PROBE_FAILED",
      status: 422,
      title: "Configuration rejected",
      detail: "The endpoint could not be reached.",
      degraded: [],
      probe,
    });

    expect(settingsProbeFromError(error)).toEqual(probe);
  });

  it("also finds a probe nested under a transport wrapper", () => {
    const wrapped = Object.assign(new Error("boom"), {
      cause: { body: { probe } },
    });

    expect(settingsProbeFromError(wrapped)).toEqual(probe);
    expect(settingsProbeFromError({ response: { data: { probe } } })).toEqual(probe);
  });

  it("normalizes checks and drops malformed entries", () => {
    const parsed = settingsProbeFromError({
      probe: {
        target: "mail",
        code: "AUTH_FAILED",
        checks: [
          { name: "verify", ok: false, ms: 12 },
          { name: "missing-ok" },
          { ok: true },
          "nope",
        ],
      },
    });

    expect(parsed?.checks).toEqual([{ name: "verify", ok: false, ms: 12 }]);
  });

  it("rejects probes without a known target or code", () => {
    expect(settingsProbeFromError({ probe: { target: "cdn", code: "X" } })).toBeNull();
    expect(settingsProbeFromError({ probe: { target: "mail", code: "   " } })).toBeNull();
    expect(settingsProbeFromError({ code: "SETTINGS_PROBE_FAILED" })).toBeNull();
    expect(settingsProbeFromError(new Error("plain"))).toBeNull();
    expect(settingsProbeFromError(null)).toBeNull();
  });

  it("survives self-referencing payloads without recursing forever", () => {
    const cyclic: Record<string, unknown> = { probe: undefined };
    cyclic.probe = { target: "mail", code: "AUTH_FAILED", checks: [], self: cyclic };

    expect(settingsProbeFromError(cyclic)?.code).toBe("AUTH_FAILED");
  });
});