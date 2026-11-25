import type { AdminApiFailure } from "../../lib/admin-api-error";

/**
 * Operator-facing copy for the `422 SETTINGS_PROBE_FAILED` body the settings
 * save endpoint returns when a live storage/mail probe blocks the write.
 *
 * The server deliberately uses stable codes (`probe.target` + `probe.code`) so
 * the console can explain *which* step failed — "the bucket is wrong" instead
 * of "the configuration was rejected". Raw codes never become the main copy;
 * they stay inside the collapsed technical details.
 */
export const SETTINGS_PROBE_FAILED_CODE = "SETTINGS_PROBE_FAILED";

/** The two transports the save probe checks. */
export type SettingsProbeTarget = "storage" | "mail";

/** One step of the probe, e.g. `HeadBucket` or `PutObject`. */
export interface SettingsProbeCheck {
  name: string;
  ok: boolean;
  ms?: number;
}

/** Subset of the failure body this UI is allowed to render. */
export interface SettingsProbe {
  target: SettingsProbeTarget;
  code: string;
  checks: readonly SettingsProbeCheck[];
}

export interface ProbeCopyContext {
  /** Current `storage.endpoint`, so the copy names the address that failed. */
  endpoint?: string | null;
  /** Current `mail.provider`, used to pick the credential fields to flag. */
  provider?: string | null;
  /** Server `detail`; English, technical, and only ever a fallback. */
  detail?: string | null;
}

export interface ProbeCopy {
  /** Mono eyebrow above the headline, e.g. `保存被拦截 · 存储`. */
  eyebrow: string;
  headline: string;
  /** Optional second line (generic next step or the raw server detail). */
  body?: string;
  /** First failed check name, mirrored into the technical details. */
  failedAt: string | null;
  /** key → inline note rendered next to the credential field that is missing. */
  credentialNotes: Readonly<Record<string, string>>;
}

const TARGET_LABELS: Record<SettingsProbeTarget, string> = {
  storage: "存储",
  mail: "邮件",
};

const BUCKET_COPY = "存储桶不存在或无权访问：请检查存储桶名称与访问权限";
const UNAVAILABLE_COPY = "探测服务不可用，配置未保存。可稍后重试";
const MAIL_GENERIC_COPY = "邮件连接检查未通过：请检查服务器地址、端口、用户名与密码";

/**
 * target + code → actionable copy. Add rows here, never inline strings in the
 * component. `{endpoint}` is substituted from the form's current draft.
 */
export const PROBE_COPY_TABLE: Readonly<
  Record<SettingsProbeTarget, Readonly<Record<string, string>>>
> = {
  storage: {
    STORAGE_ENDPOINT_UNREACHABLE:
      "存储服务无法连接：请检查服务地址与网络（当前地址：{endpoint}）",
    STORAGE_PUBLIC_ENDPOINT_UNREACHABLE:
      "公开访问地址不可达：图片可能无法加载，请检查公开地址与跨域访问设置",
    MISSING_CREDENTIALS: "缺少访问凭据：请填写访问密钥与私有密钥",
    PROBE_UNAVAILABLE: UNAVAILABLE_COPY,
  },
  mail: {
    CONNECTION_FAILED:
      "无法连接邮件服务器：请检查服务器地址与端口（465 使用隐式加密，587 使用 STARTTLS）",
    AUTH_FAILED: "SMTP 认证被拒：检查用户名与应用专用密码（不是账号登录密码）",
    MISSING_CREDENTIALS: "缺少发件地址或访问凭据",
    MAIL_NOT_CONFIGURED: "邮件配置不完整：请检查发件服务、发件地址与访问凭据",
    PROBE_UNAVAILABLE: UNAVAILABLE_COPY,
  },
};

const CREDENTIAL_NOTES: Readonly<Record<string, string>> = {
  "storage.accessKey": "缺少访问凭据，请填写访问密钥。",
  "storage.secretKey": "缺少访问凭据，请填写私有密钥。",
  "mail.from": "缺少发件地址：保存探测需要用它确定收件人。",
  "mail.resendApiKey": "缺少 Resend 接口密钥：填好后再保存。",
  "mail.smtpUser": "缺少 SMTP 用户名：填好后再保存。",
  "mail.smtpPassword": "缺少 SMTP 密码：填好后再保存。",
};

/** First failed check, which is the step the probe stopped at. */
export function failedAtOf(checks: readonly SettingsProbeCheck[]): string | null {
  const failed = checks.find((check) => !check.ok);
  return failed ? failed.name : null;
}

/**
 * Credential fields to annotate inline. Only rendered for fields that are
 * actually present in the group, so a resend deployment never sees SMTP notes.
 */
export function credentialNotesFor(
  target: SettingsProbeTarget,
  provider?: string | null,
): Readonly<Record<string, string>> {
  if (target === "storage") {
    return {
      "storage.accessKey": CREDENTIAL_NOTES["storage.accessKey"]!,
      "storage.secretKey": CREDENTIAL_NOTES["storage.secretKey"]!,
    };
  }
  const notes: Record<string, string> = {
    "mail.from": CREDENTIAL_NOTES["mail.from"]!,
  };
  if (provider === "smtp") {
    notes["mail.smtpUser"] = CREDENTIAL_NOTES["mail.smtpUser"]!;
    notes["mail.smtpPassword"] = CREDENTIAL_NOTES["mail.smtpPassword"]!;
  } else {
    // `mail.provider` defaults to resend; an unknown/absent provider is treated
    // as the default rather than flagging every credential field at once.
    notes["mail.resendApiKey"] = CREDENTIAL_NOTES["mail.resendApiKey"]!;
  }
  return notes;
}

/**
 * Map a probe failure to operator copy.
 *
 * Resolution order: exact target+code → storage fallback (bucket/permissions,
 * also used when the failing step is `HeadBucket`) → server detail for mail →
 * a generic mail instruction. The raw code is never returned as `headline`.
 */
export function probeCopyFor(probe: SettingsProbe, context: ProbeCopyContext = {}): ProbeCopy {
  const target = probe.target;
  const mapped = PROBE_COPY_TABLE[target][probe.code];
  const failedAt = failedAtOf(probe.checks);
  const detail = context.detail?.trim() || null;

  let headline: string;
  let body: string | undefined;
  if (mapped) {
    headline = mapped;
  } else if (target === "storage") {
    // Every other storage code means "the bucket itself is the problem":
    // HeadBucket failures, PutObject 403, a missing bucket, a region mismatch.
    headline = BUCKET_COPY;
    body = detail ?? undefined;
  } else if (detail) {
    headline = detail;
    body = MAIL_GENERIC_COPY;
  } else {
    headline = MAIL_GENERIC_COPY;
  }

  const endpoint = context.endpoint?.trim() || "未配置";
  return {
    eyebrow: `保存被拦截 · ${TARGET_LABELS[target]}`,
    headline: headline.replace("{endpoint}", endpoint),
    ...(body === undefined ? {} : { body }),
    failedAt,
    credentialNotes:
      probe.code === "MISSING_CREDENTIALS"
        ? credentialNotesFor(target, context.provider)
        : {},
  };
}

/** Copy for a 422 `SETTINGS_PROBE_FAILED` whose `probe` field did not survive
 * the HTTP client (for example a proxy stripped it). Still never shows a code. */
export function probeFallbackCopy(detail?: string | null): ProbeCopy {
  return {
    eyebrow: "保存被拦截 · 探测",
    headline: "保存前探测失败，配置未写入",
    body: detail?.trim() || "保存前的检查没有返回详细信息，请稍后重试。",
    failedAt: null,
    credentialNotes: {},
  };
}

export function isSettingsProbeFailure(failure: AdminApiFailure): boolean {
  return failure.code === SETTINGS_PROBE_FAILED_CODE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCheck(value: unknown): SettingsProbeCheck[] {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.ok !== "boolean") {
    return [];
  }
  const ms = value.ms;
  return [
    {
      name: value.name,
      ok: value.ok,
      ...(typeof ms === "number" && Number.isFinite(ms) ? { ms } : {}),
    },
  ];
}

function parseProbe(value: unknown): SettingsProbe | null {
  if (!isRecord(value)) {
    return null;
  }
  const target = value.target;
  const code = value.code;
  if (target !== "storage" && target !== "mail") {
    return null;
  }
  if (typeof code !== "string" || code.trim().length === 0) {
    return null;
  }
  const checks = Array.isArray(value.checks) ? value.checks.flatMap(parseCheck) : [];
  return { target, code, checks };
}

/**
 * Containers a client may nest the raw problem body under. The admin HTTP
 * client currently keeps the body on `failure.probe`; the other keys make the
 * extractor survive a client refactor that wraps the payload differently.
 */
const NESTED_KEYS = [
  "probe",
  "body",
  "problem",
  "payload",
  "failure",
  "data",
  "response",
  "cause",
  "error",
] as const;
const MAX_DEPTH = 4;

/**
 * Defensively pull the probe out of whatever was thrown by `api.update`.
 *
 * `AdminSettingsError.failure.probe` is the intended path; the walk exists so a
 * transport wrapper (or a future client) cannot silently hide the detail again.
 */
export function settingsProbeFromError(error: unknown): SettingsProbe | null {
  const seen = new Set<object>();

  function visit(value: unknown, depth: number): SettingsProbe | null {
    if (depth > MAX_DEPTH || !isRecord(value) || seen.has(value)) {
      return null;
    }
    seen.add(value);

    const direct = parseProbe(value);
    if (direct) {
      return direct;
    }
    for (const key of NESTED_KEYS) {
      const nested = visit(value[key], depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  return visit(error, 0);
}
