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
import {
  settingFieldConsumption,
  settingsGroupConsumption,
} from "./settings-consumption";

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
    expect(settingsGroupHref("seo")).toBe("/admin/settings");
    expect(settingsGroupHref("mail")).toBe("/admin/services/mail");
  });

  it("maps every group to its real consumption status without the old vague claim", () => {
    expect(SETTINGS_CONSUMPTION.general).toMatchObject({ status: "frontend" });
    expect(SETTINGS_CONSUMPTION.seo).toMatchObject({ status: "frontend" });
    expect(SETTINGS_CONSUMPTION.theme).toMatchObject({ status: "frontend" });
    expect(SETTINGS_CONSUMPTION.places).toMatchObject({ status: "backend" });
    expect(SETTINGS_CONSUMPTION.places.label).toContain("后端已消费");
    expect(SETTINGS_CONSUMPTION.ai).toEqual({
      status: "backend",
      label: "后端已消费（AI 模块运行期读取）",
    });
    expect(SETTINGS_CONSUMPTION.ai.label).not.toContain("不生效");

    for (const group of ["mail", "storage"] as const) {
      expect(SETTINGS_CONSUMPTION[group]).toEqual({
        status: "backend",
        label:
          group === "mail"
            ? "后端已消费，任务进程仍读环境变量"
            : "后端已消费（API 运行期读取；保存前会跑连通性探测）",
      });
    }
    // The old reverse distortion: these groups were wired but still labelled
    // unwired. A backend badge must never carry the unwired wording.
    expect(SETTINGS_CONSUMPTION.mail.label).not.toContain("不生效");
    expect(SETTINGS_CONSUMPTION.storage.label).not.toContain("不生效");

    // `limits` is partially wired: the group badge must stay yellow, and the
    // label must name which half works instead of claiming the whole group.
    expect(SETTINGS_CONSUMPTION.limits.status).toBe("unwired");
    expect(SETTINGS_CONSUMPTION.limits.label).toContain("搜索限流已生效");
    expect(SETTINGS_CONSUMPTION.limits.label).toContain("上传限流");
    expect(SETTINGS_CONSUMPTION.limits.label).toContain("不生效");
    // The deployment-config implementation detail must not leak into copy.
    expect(SETTINGS_CONSUMPTION.limits.label).not.toContain("环境变量");
    expect(SETTINGS_CONSUMPTION.limits.label).toContain("部分接入");
    expect(SETTINGS_CONSUMPTION.limits.label).not.toMatch(/^未接入/u);

    const rendered = [
      ...Object.values(SETTINGS_CONSUMPTION).map((entry) => entry.label),
      ...(["general", "seo", "theme", "mail", "storage", "media", "ai", "places", "limits"] as const).map(
        (group) => settingsGroupConsumption(group).label,
      ),
    ].join("\n");
    expect(rendered).not.toContain("前端/Worker 消费待完成");
    // The phrase that shipped with the old false green badge. Split so the
    // phrase itself stays out of the source, where it would look like a claim.
    expect(rendered).not.toContain(["已接入", "后端"].join(""));
  });

  it("labels the seven mail keys backend and keeps the worker limit explicit", () => {
    for (const key of [
      "mail.provider",
      "mail.from",
      "mail.resendApiKey",
      "mail.smtpHost",
      "mail.smtpPort",
      "mail.smtpUser",
      "mail.smtpPassword",
    ]) {
      expect(settingFieldConsumption(key)).toEqual({
        status: "backend",
        label: "后端已消费（邮件设置）；任务进程导出通知不生效（任务进程未接入）",
      });
    }
    // Group badge must still say the worker reads the environment, so a green
    // API path is not read as “every mail path”.
    expect(SETTINGS_CONSUMPTION.mail.label).toContain("任务进程仍读环境变量");
    expect(settingsGroupConsumption("mail")).toBe(SETTINGS_CONSUMPTION.mail);
  });

  it("keeps media's exact 4/6 split and spells out group-level exceptions", () => {
    const media = settingsGroupConsumption("media");
    expect(media.status).toBe("frontend");
    expect(media.label).toContain("前端已消费 4/6 个键");
    expect(media.label).toContain("保留原图与实况照片未接入（不生效）");

    const general = settingsGroupConsumption("general");
    expect(general.status).toBe("frontend");
    expect(general.label).toContain("注册开关未接入（不生效）");

    const seo = settingsGroupConsumption("seo");
    expect(seo.status).toBe("frontend");
    expect(seo.label).toContain("站点地图未接入（不生效）");

    expect(settingsGroupConsumption("mail")).toBe(SETTINGS_CONSUMPTION.mail);
    expect(settingsGroupConsumption("places")).toBe(SETTINGS_CONSUMPTION.places);
    expect(settingsGroupConsumption("ai")).toBe(SETTINGS_CONSUMPTION.ai);
    expect(settingsGroupConsumption("ai").label).not.toContain("不生效");
  });

  it("labels the six media keys one by one instead of one group badge", () => {
    for (const key of [
      "media.maxEdge",
      "media.quality",
      "media.targetBytes",
      "media.maxUploadBytes",
    ]) {
      expect(settingFieldConsumption(key)).toEqual({
        status: "frontend",
        label: "前端已消费",
      });
    }
    for (const key of [
      "media.keepOriginal",
      "media.livePhotoEnabled",
      "general.registrationEnabled",
      "seo.sitemapEnabled",
    ]) {
      expect(settingFieldConsumption(key)).toEqual({
        status: "unwired",
        label: "未接入（不生效）",
      });
    }
    for (const key of [
      "places.provider",
      "places.apiKey",
      "places.lang",
      "places.limit",
      "places.cacheTtlSeconds",
      "places.dailyQuota",
      "ai.defaultProvider",
      "ai.timeoutMs",
      "ai.maxOutputTokens",
      "ai.dailyQuota",
    ]) {
      expect(settingFieldConsumption(key)).toEqual({
        status: "backend",
        label: "后端已消费",
      });
    }
    expect(settingFieldConsumption("site.title")).toBeNull();
  });

  it("never labels limits.uploadPerMinute backend while the presign limiter is unwired", () => {
    expect(settingFieldConsumption("limits.searchPerMinute")).toEqual({
      status: "backend",
      label: "后端已消费（地点搜索限流，按请求解析）",
    });
    expect(settingFieldConsumption("limits.uploadPerMinute")).toEqual({
      status: "unwired",
      label: "未接入（上传签名限流在部署配置中固定，在此修改不生效）",
    });
    // Guard against a future "make the group green" shortcut: the group badge
    // may only turn green when both keys are consumed.
    expect(SETTINGS_CONSUMPTION.limits.status).not.toBe("backend");
    expect(settingsGroupConsumption("limits").status).toBe("unwired");
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
    const required = item({
      key: "site.title",
      type: "string",
      label: "Title",
      default: "Roamlog",
      value: "Roamlog",
    });

    const optionalEmpty = item({
      key: "mail.smtpUser",
      type: "string",
      label: "SMTP user",
      default: "",
      value: "",
    });

    expect(localSettingError(nullable, "")).toBeNull();
    expect(localSettingError(optionalEmpty, "")).toBeNull();
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