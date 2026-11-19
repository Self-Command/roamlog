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
        "theme.defaultMode",
        "theme.loginTagline",
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

  it("offers only the color modes that actually render", () => {
    const entry = SETTINGS_BY_KEY.get("theme.defaultMode");

    expect(entry?.options).toEqual(["dark", "system"]);
    expect(entry?.defaultValue).toBe("system");
    expect(entry?.schema.safeParse("dark").success).toBe(true);
    expect(entry?.schema.safeParse("system").success).toBe(true);
    expect(entry?.schema.safeParse("light").success).toBe(false);
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

  it("marks exactly the credential keys as secret", () => {
    const secretKeys = SETTINGS_REGISTRY.filter((entry) => entry.isSecret).map(
      (entry) => entry.key,
    );
    expect(secretKeys.sort()).toEqual([
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
      "theme.defaultMode",
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
});
