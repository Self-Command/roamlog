import { describe, expect, it } from "vitest";

import {
  APPEARANCE_SETTING_KEYS,
  AdminSettingItemSchema,
  AdminSettingsResponseSchema,
  PublicSettingsResponseSchema,
  RevealAdminSettingRequestSchema,
  THEME_MODES,
  ThemeModeSchema,
  UpdateAdminSettingsRequestSchema,
} from "../api/admin-settings";

const UPDATED_AT = "2026-11-19T08:00:00.000Z";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    key: "site.title",
    group: "general",
    type: "string",
    label: "Site title",
    default: "Roamlog",
    isSecret: false,
    isPublic: true,
    envLocked: false,
    value: "Roamlog",
    updatedAt: UPDATED_AT,
    updatedById: null,
    ...overrides,
  };
}

describe("admin settings contracts", () => {
  it("accepts a masked secret item and rejects leaking a secret value", () => {
    const secret = baseItem({
      key: "mail.resendApiKey",
      group: "mail",
      type: "secret",
      label: "Resend API key",
      default: null,
      isSecret: true,
      isPublic: false,
      value: undefined,
      secret: { hasValue: true, last4: "abcd" },
    });
    // `value: undefined` is absent, matching the API presenter.
    const parsed = AdminSettingItemSchema.parse(secret);
    expect(parsed.secret).toEqual({ hasValue: true, last4: "abcd" });

    expect(() => AdminSettingItemSchema.parse({ ...secret, value: "re_live_plaintext" })).toThrow(
      /never include a value/u,
    );
    expect(() => AdminSettingItemSchema.parse({ ...secret, secret: undefined })).toThrow(
      /hasValue/u,
    );
  });

  it("requires a value for every non-secret item", () => {
    expect(() => AdminSettingItemSchema.parse(baseItem({ value: undefined }))).toThrow(
      /must include a value/u,
    );
    expect(
      AdminSettingItemSchema.parse(
        baseItem({ value: null, key: "seo.ogImageUrl", group: "seo", type: "json" }),
      ).value,
    ).toBeNull();
  });

  it("keeps group ordering and item metadata in the list response", () => {
    const response = AdminSettingsResponseSchema.parse({
      groups: [
        {
          group: "general",
          label: "General",
          items: [
            baseItem(),
            baseItem({
              key: "general.registrationEnabled",
              type: "boolean",
              label: "Registration",
              default: true,
              isPublic: false,
              value: true,
            }),
          ],
        },
      ],
      generatedAt: UPDATED_AT,
    });
    expect(response.groups[0]?.items.map((item) => item.key)).toEqual([
      "site.title",
      "general.registrationEnabled",
    ]);
  });

  it("validates PATCH batches without accepting unknown fields", () => {
    const request = UpdateAdminSettingsRequestSchema.parse({
      updates: [
        { key: "site.title", value: "Roamlog" },
        { key: "media.quality", value: 0.82 },
        { key: "seo.ogImageUrl", value: null },
      ],
    });
    expect(request.updates).toHaveLength(3);

    expect(() => UpdateAdminSettingsRequestSchema.parse({ updates: [] })).toThrow();
    expect(() =>
      UpdateAdminSettingsRequestSchema.parse({
        updates: [{ key: "site.title", value: "x", extra: true }],
      }),
    ).toThrow();
    expect(() =>
      UpdateAdminSettingsRequestSchema.parse({ updates: [{ key: "Site Title", value: "x" }] }),
    ).toThrow(/camelCase/u);
  });

  it("requires an explicit confirm:true for reveal", () => {
    expect(RevealAdminSettingRequestSchema.parse({ confirm: true })).toEqual({ confirm: true });
    expect(() => RevealAdminSettingRequestSchema.parse({ confirm: false })).toThrow();
    expect(() => RevealAdminSettingRequestSchema.parse({})).toThrow();
  });

  it("accepts the three appearance modes once the light palette ships", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"]);
    expect(ThemeModeSchema.parse("dark")).toBe("dark");
    expect(ThemeModeSchema.parse("system")).toBe("system");
    expect(ThemeModeSchema.parse("light")).toBe("light");
    expect(ThemeModeSchema.safeParse("auto").success).toBe(false);
  });

  it("freezes the four public appearance defaults", () => {
    expect(APPEARANCE_SETTING_KEYS).toEqual([
      "theme.defaultSkin",
      "theme.defaultMode",
      "theme.defaultFont",
      "theme.allowUserOverride",
    ]);
  });

  it("serves only key/value pairs on the public projection", () => {
    const parsed = PublicSettingsResponseSchema.parse({
      settings: {
        "site.title": "Roamlog",
        "general.defaultLanguage": "zh-CN",
        "general.registrationEnabled": true,
      },
      generatedAt: UPDATED_AT,
    });
    expect(parsed.settings["site.title"]).toBe("Roamlog");
    expect(() =>
      PublicSettingsResponseSchema.parse({
        settings: { "site.title": "Roamlog" },
        generatedAt: UPDATED_AT,
        secrets: {},
      }),
    ).toThrow();
  });
});
