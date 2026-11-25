import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, defaultSettingKeys } from "@roamlog/db";

import {
  SETTINGS_BY_KEY,
  SETTINGS_REGISTRY,
  publicSettingDefinitions,
} from "../settings.registry.js";

describe("SETTINGS_REGISTRY", () => {
  it("registers exactly the code-owned default keys, once each", () => {
    const registered = SETTINGS_REGISTRY.map((entry) => entry.key);
    expect(new Set(registered).size).toBe(registered.length);
    expect([...registered].sort()).toEqual([...defaultSettingKeys()].sort());
    expect(SETTINGS_BY_KEY.size).toBe(registered.length);
  });

  it("keeps every non-null default valid for its own schema", () => {
    for (const entry of SETTINGS_REGISTRY) {
      const defaultValue = DEFAULT_SETTINGS[entry.key as keyof typeof DEFAULT_SETTINGS];
      if (defaultValue === null) {
        continue;
      }
      const parsed = entry.schema.safeParse(defaultValue);
      expect(parsed.success, `${entry.key}: ${parsed.error?.issues.map((i) => i.message)}`).toBe(
        true,
      );
    }
  });

  it("exposes exactly the public, non-secret keys the anonymous shell consumes", () => {
    const publicKeys = publicSettingDefinitions()
      .map((entry) => entry.key)
      .sort();
    expect(publicKeys).toEqual(
      [
        "site.title",
        "site.description",
        "general.defaultLanguage",
        "general.defaultTimeZone",
        "seo.titleTemplate",
        "seo.descriptionTemplate",
        "seo.ogImageUrl",
        "seo.robots",
        "theme.accent",
        "theme.defaultSkin",
        "theme.defaultMode",
        "theme.defaultFont",
        "theme.allowUserOverride",
        "theme.loginTagline",
        "ai.defaultReasoningEffort",
        "ai.suggestedPrompts",
        "media.maxEdge",
        "media.quality",
        "media.targetBytes",
        "media.maxUploadBytes",
      ].sort(),
    );
    for (const key of publicKeys) {
      expect(SETTINGS_BY_KEY.get(key)?.isSecret, key).toBe(false);
    }
  });

  it("keeps credentials, internal AI parameters and rate limits private", () => {
    const mustStayPrivate = [
      "mail.resendApiKey",
      "mail.smtpPassword",
      "mail.smtpUser",
      "mail.smtpHost",
      "mail.provider",
      "storage.accessKey",
      "storage.secretKey",
      "storage.endpoint",
      "storage.bucket",
      "storage.publicEndpoint",
      "places.apiKey",
      "places.provider",
      "ai.defaultProvider",
      "ai.timeoutMs",
      "ai.maxOutputTokens",
      "ai.dailyQuota",
      "ai.baseUrl",
      "ai.model",
      "ai.apiKey",
      "limits.searchPerMinute",
      "limits.uploadPerMinute",
      // Behavior switches that are still unimplemented must not be public:
      // publishing them would let the web client imply they take effect.
      "media.keepOriginal",
      "media.livePhotoEnabled",
    ];
    for (const key of mustStayPrivate) {
      expect(SETTINGS_BY_KEY.get(key)?.isPublic, key).toBe(false);
    }
    expect(publicSettingDefinitions()).not.toContainEqual(
      expect.objectContaining({ key: "mail.resendApiKey" }),
    );
    expect(publicSettingDefinitions()).not.toContainEqual(
      expect.objectContaining({ key: "media.keepOriginal" }),
    );
    expect(publicSettingDefinitions()).not.toContainEqual(
      expect.objectContaining({ key: "media.livePhotoEnabled" }),
    );
  });

  it("labels the two unwired media switches as not wired, in their help text", () => {
    for (const key of ["media.keepOriginal", "media.livePhotoEnabled"]) {
      const entry = SETTINGS_BY_KEY.get(key);
      expect(entry?.isPublic, key).toBe(false);
      expect(entry?.help, key).toContain("当前未接入");
      expect(entry?.help, key).toContain("改动不影响上传行为");
    }
  });

  it("caps the upload setting at the server-enforced 25 MB boundary", () => {
    const entry = SETTINGS_BY_KEY.get("media.maxUploadBytes");
    expect(entry).toBeDefined();

    // 25,000,000 is the largest value the presign endpoint's 25 MiB hard cap can
    // honour for every file, so the setting must accept it...
    expect(entry?.schema.safeParse(25_000_000).success).toBe(true);
    expect(entry?.defaultValue).toBe(25_000_000);

    // ...and refuse one byte more instead of storing a limit the server ignores.
    const overLimit = entry?.schema.safeParse(25_000_001);
    expect(overLimit?.success).toBe(false);
    if (overLimit && !overLimit.success) {
      const issue = overLimit.error.issues[0];
      expect(issue?.code).toBe("too_big");
      expect(issue?.message).toMatch(/25000000|25[,_]000[,_]000/u);
    }

    // The old 100 MB ceiling is gone and the 1 MB floor still holds.
    expect(entry?.schema.safeParse(100_000_000).success).toBe(false);
    expect(entry?.schema.safeParse(1_000_000).success).toBe(true);
    expect(entry?.schema.safeParse(999_999).success).toBe(false);
  });

  it("documents that the server enforces the upload cap", () => {
    const help = SETTINGS_BY_KEY.get("media.maxUploadBytes")?.help ?? "";
    expect(help).toContain("上限 25 MB");
    expect(help).toContain("由服务端强制");
    expect(help).toContain("客户端会先拦一次");
  });

  it("offers light, dark and system appearance modes", () => {
    const entry = SETTINGS_BY_KEY.get("theme.defaultMode");

    expect(entry?.options).toEqual(["system", "light", "dark"]);
    expect(entry?.defaultValue).toBe("system");
    expect(entry?.schema.safeParse("dark").success).toBe(true);
    expect(entry?.schema.safeParse("system").success).toBe(true);
    expect(entry?.schema.safeParse("light").success).toBe(true);
  });

  it("covers every requested group and first-release key", () => {
    const groups = new Set(SETTINGS_REGISTRY.map((entry) => entry.group));
    expect([...groups].sort()).toEqual([
      "ai",
      "general",
      "limits",
      "mail",
      "media",
      "places",
      "seo",
      "storage",
      "theme",
    ]);

    for (const key of [
      "general.registrationEnabled",
      "seo.titleTemplate",
      "seo.descriptionTemplate",
      "seo.ogImageUrl",
      "seo.robots",
      "seo.sitemapEnabled",
      "theme.defaultSkin",
      "theme.defaultMode",
      "theme.defaultFont",
      "theme.allowUserOverride",
      "mail.provider",
      "mail.from",
      "mail.smtpPort",
      "mail.smtpUser",
      "storage.forcePathStyle",
      "media.maxEdge",
      "media.quality",
      "media.targetBytes",
      "media.keepOriginal",
      "media.livePhotoEnabled",
      "media.maxUploadBytes",
      "ai.defaultProvider",
      "ai.timeoutMs",
      "ai.maxOutputTokens",
      "ai.dailyQuota",
      "ai.baseUrl",
      "ai.model",
      "ai.apiKey",
      "places.provider",
      "places.lang",
      "places.limit",
      "places.cacheTtlSeconds",
      "places.dailyQuota",
      "limits.searchPerMinute",
      "limits.uploadPerMinute",
    ]) {
      expect(SETTINGS_BY_KEY.has(key), key).toBe(true);
    }
  });

  it("registers the console-configurable AI endpoint, model and key in the ai group", () => {
    const baseUrl = SETTINGS_BY_KEY.get("ai.baseUrl");
    const model = SETTINGS_BY_KEY.get("ai.model");
    const apiKey = SETTINGS_BY_KEY.get("ai.apiKey");

    expect(baseUrl?.group).toBe("ai");
    expect(baseUrl?.type).toBe("string");
    expect(baseUrl?.isSecret).toBe(false);
    expect(baseUrl?.envLocked).toBe(false);
    // Null default + nullable schema: the key stays absent until an operator saves one.
    expect(baseUrl?.defaultValue).toBeNull();
    expect(baseUrl?.schema.safeParse(null).success).toBe(true);
    expect(baseUrl?.schema.safeParse("https://api.openai.com/v1").success).toBe(true);
    expect(baseUrl?.schema.safeParse("").success).toBe(false);
    expect(baseUrl?.schema.safeParse("x".repeat(201)).success).toBe(false);

    expect(model?.group).toBe("ai");
    expect(model?.type).toBe("string");
    expect(model?.isSecret).toBe(false);
    expect(model?.envLocked).toBe(false);
    expect(model?.defaultValue).toBeNull();
    expect(model?.schema.safeParse("gpt-4o-mini").success).toBe(true);
    expect(model?.schema.safeParse("x".repeat(81)).success).toBe(false);

    expect(apiKey?.group).toBe("ai");
    expect(apiKey?.type).toBe("secret");
    expect(apiKey?.isSecret).toBe(true);
    expect(apiKey?.envLocked).toBe(false);
    expect(apiKey?.defaultValue).toBeNull();
    expect(apiKey?.schema.safeParse(12345).success).toBe(false);
  });

  it("marks exactly the credential keys as secret", () => {
    const secretKeys = SETTINGS_REGISTRY.filter((entry) => entry.isSecret).map(
      (entry) => entry.key,
    );
    expect(secretKeys.sort()).toEqual([
      "ai.apiKey",
      "mail.resendApiKey",
      "mail.smtpPassword",
      "places.apiKey",
      "storage.accessKey",
      "storage.secretKey",
    ]);
    for (const entry of SETTINGS_REGISTRY.filter((item) => item.isSecret)) {
      expect(entry.type).toBe("secret");
      expect(entry.isPublic).toBe(false);
      expect(entry.schema.safeParse(12345).success).toBe(false);
    }
  });

  it("keeps the first release free of environment-locked keys while retaining the field", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.envLocked, entry.key).toBe(false);
    }
  });

  it("exposes enum options for every select-style setting", () => {
    for (const key of [
      "general.defaultLanguage",
      "theme.accent",
      "theme.defaultSkin",
      "theme.defaultMode",
      "theme.defaultFont",
      "mail.provider",
      "places.provider",
    ]) {
      const entry = SETTINGS_BY_KEY.get(key);
      expect(entry?.options?.length, key).toBeGreaterThan(1);
      for (const option of entry?.options ?? []) {
        expect(entry?.schema.safeParse(option).success, `${key}=${option}`).toBe(true);
      }
    }
  });

  it("localizes every label, help string and validation message", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.label, entry.key).toMatch(/[\u4e00-\u9fa5]/u);
      expect(entry.help, entry.key).toMatch(/[\u4e00-\u9fa5]/u);

      // Wrong-type input exercises the schema's custom `error` message; every
      // setting type must answer in Chinese instead of Zod's English default.
      const parsed = entry.schema.safeParse({ __invalid: true });
      expect(parsed.success, entry.key).toBe(false);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          expect(issue.message, `${entry.key}: ${issue.message}`).toMatch(/[\u4e00-\u9fa5]/u);
        }
      }
    }

    const url = SETTINGS_BY_KEY.get("storage.endpoint")?.schema.safeParse("ftp://example.com");
    expect(url?.success).toBe(false);
    if (url && !url.success) {
      expect(url.error.issues[0]?.message).toBe("必须是 http(s) URL。");
    }

    const timeZone = SETTINGS_BY_KEY.get("general.defaultTimeZone")?.schema.safeParse("Mars/Base");
    expect(timeZone?.success).toBe(false);
    if (timeZone && !timeZone.success) {
      expect(timeZone.error.issues[0]?.message).toContain("IANA 时区");
    }

    const tooLong = SETTINGS_BY_KEY.get("site.title")?.schema.safeParse("x".repeat(81));
    expect(tooLong?.success).toBe(false);
    if (tooLong && !tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toBe("站点标题不能超过 80 个字符。");
    }

    const tooSmall = SETTINGS_BY_KEY.get("mail.smtpPort")?.schema.safeParse(0);
    expect(tooSmall?.success).toBe(false);
    if (tooSmall && !tooSmall.success) {
      expect(tooSmall.error.issues[0]?.message).toBe("SMTP 端口不能小于 1。");
    }

    const badEnum = SETTINGS_BY_KEY.get("mail.provider")?.schema.safeParse("pigeon");
    expect(badEnum?.success).toBe(false);
    if (badEnum && !badEnum.success) {
      expect(badEnum.error.issues[0]?.message).toContain("邮件服务商必须是以下选项之一");
    }
  });
});
