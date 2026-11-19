import { describe, expect, it } from "vitest";

import type { AdminSettingItem } from "@roamlog/contracts";

import {
  SETTINGS_CONSUMPTION,
  collectGroupUpdates,
  draftFromItem,
  dirtySettingKeys,
  localSettingError,
  normalizeSettingsGroup,
  parseJsonDraft,
  settingValueSource,
  settingsGroupHref,
} from "../../lib/admin-settings";

function item(overrides: Partial<AdminSettingItem> & Pick<AdminSettingItem, "key" | "type" | "label">): AdminSettingItem {
  return {
    group: "general",
    default: "",
    isSecret: false,
    isPublic: false,
    envLocked: false,
    updatedAt: null,
    updatedById: null,
    ...overrides,
  } as AdminSettingItem;
}

describe("admin settings helpers", () => {
  it("normalizes deep-link groups and falls back to general", () => {
    expect(normalizeSettingsGroup("mail")).toBe("mail");
    expect(normalizeSettingsGroup(undefined)).toBe("general");
    expect(normalizeSettingsGroup("nope")).toBe("general");
    expect(settingsGroupHref("seo")).toBe("/admin/settings?group=seo");
  });

  it("maps every group to its real consumption status", () => {
    expect(SETTINGS_CONSUMPTION.general.label).toBe("前端已消费（标题/描述/主题）");
    expect(SETTINGS_CONSUMPTION.seo.label).toBe("前端已消费（标题/描述/主题）");
    expect(SETTINGS_CONSUMPTION.theme.label).toBe("前端已消费（标题/描述/主题）");
    for (const group of ["mail", "storage", "media", "ai", "places", "limits"] as const) {
      expect(SETTINGS_CONSUMPTION[group].label).toBe("已接入后端，前端/Worker 消费待完成");
    }
  });

  it("derives the value source from envLocked and updatedAt, never from guesses", () => {
    const base = item({ key: "site.title", type: "string", label: "Title", value: "x" });
    expect(settingValueSource(base)).toBe("default");
    expect(settingValueSource({ ...base, updatedAt: "2026-11-19T00:00:00.000Z" })).toBe(
      "database",
    );
    expect(settingValueSource({ ...base, envLocked: true })).toBe("environment");
  });

  it("collects number, boolean, string and json values with their real types", () => {
    const items = [
      item({ key: "mail.smtpPort", type: "number", label: "Port", value: 587, default: 587 }),
      item({
        key: "general.registrationEnabled",
        type: "boolean",
        label: "Registration",
        value: false,
        default: false,
      }),
      item({ key: "site.title", type: "string", label: "Title", value: "Roamlog", default: "Roamlog" }),
      item({
        key: "general.metadata",
        type: "json",
        label: "Metadata",
        value: { theme: "dark" },
        default: {},
      }),
    ];

    const values = {
      "mail.smtpPort": "2525",
      "general.registrationEnabled": true,
      "site.title": "Roamlog 2",
      "general.metadata": { mode: "object" as const, rows: [{ id: "r1", key: "theme", valueText: '"light"' }] },
    };

    const { updates, errors } = collectGroupUpdates(items, values, {});
    expect(errors).toEqual({});
    expect(updates).toEqual([
      { key: "mail.smtpPort", value: 2525 },
      { key: "general.registrationEnabled", value: true },
      { key: "site.title", value: "Roamlog 2" },
      { key: "general.metadata", value: { theme: "light" } },
    ]);
    expect(updates.some((update) => typeof update.value === "string")).toBe(true);
    expect(typeof updates[0]?.value).toBe("number");
    expect(typeof updates[1]?.value).toBe("boolean");
    expect(typeof updates[3]?.value).toBe("object");
  });

  it("never round-trips an existing secret and only sends a typed replacement", () => {
    const secret = item({
      key: "mail.resendApiKey",
      type: "secret",
      label: "Resend key",
      default: null,
      isSecret: true,
      secret: { hasValue: true, last4: "abcd" },
    });
    expect(draftFromItem(secret)).toBe("");
    expect(collectGroupUpdates([secret], {}, {}).updates).toEqual([]);
    expect(dirtySettingKeys([secret], {}, { "mail.resendApiKey": "" })).toEqual([]);
    expect(collectGroupUpdates([secret], {}, { "mail.resendApiKey": "re_new" }).updates).toEqual([
      { key: "mail.resendApiKey", value: "re_new" },
    ]);
    expect(dirtySettingKeys([secret], {}, { "mail.resendApiKey": "re_new" })).toEqual([
      "mail.resendApiKey",
    ]);
  });

  it("maps nullable strings to null and flags empty required strings", () => {
    const nullable = item({
      key: "seo.ogImageUrl",
      type: "string",
      label: "OG image",
      default: null,
      value: "https://example.com/og.png",
    });
    const required = item({ key: "site.title", type: "string", label: "Title", value: "Roamlog" });

    expect(localSettingError(nullable, "")).toBeNull();
    expect(collectGroupUpdates([nullable], { "seo.ogImageUrl": "" }, {}).updates).toEqual([
      { key: "seo.ogImageUrl", value: null },
    ]);
    expect(localSettingError(required, "")).toBe("不能为空。");
  });

  it("rejects malformed JSON in place and accepts the structured editor", () => {
    expect(parseJsonDraft({ mode: "raw", text: "{bad" }).ok).toBe(false);
    expect(parseJsonDraft({ mode: "raw", text: '{"ok":true}' })).toEqual({
      ok: true,
      value: { ok: true },
    });

    const invalid = parseJsonDraft({
      mode: "object",
      rows: [{ id: "1", key: "count", valueText: "two" }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.message).toContain("不是合法 JSON");
      expect(invalid.rowIndex).toBe(0);
    }

    expect(
      parseJsonDraft({
        mode: "object",
        rows: [
          { id: "1", key: "count", valueText: "2" },
          { id: "2", key: "label", valueText: '"two"' },
        ],
      }),
    ).toEqual({ ok: true, value: { count: 2, label: "two" } });
  });

  it("reports empty and non-numeric number drafts before any request", () => {
    const number = item({ key: "mail.smtpPort", type: "number", label: "Port", value: 587, default: 587 });
    expect(localSettingError(number, "")).toBe("请输入数字。");
    expect(localSettingError(number, "abc")).toBe("必须是有效数字。");
    expect(localSettingError(number, "2525")).toBeNull();
  });
});