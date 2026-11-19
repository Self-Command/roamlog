import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AdminSettingItem,
  AdminSettingUpdate,
  AdminSettingsResponse,
  UpdateAdminSettingsResponse,
} from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import { AdminSettingsError, type AdminSettingsApi } from "../../lib/admin-settings-api";
import { SettingsConsole } from "./settings-console";

const RESEND_PLAINTEXT = "re_plaintext_that_must_not_leak_9876";

function makeItem(
  overrides: Partial<AdminSettingItem> & Pick<AdminSettingItem, "key" | "type" | "label">,
): AdminSettingItem {
  const { type } = overrides;
  const secret = type === "secret";
  return {
    group: "general",
    default: type === "boolean" ? false : type === "number" ? 0 : secret ? null : "",
    isSecret: secret,
    isPublic: false,
    envLocked: false,
    ...(secret
      ? { secret: { hasValue: false, last4: null } }
      : { value: type === "boolean" ? false : type === "number" ? 0 : "" }),
    updatedAt: null,
    updatedById: null,
    ...overrides,
  } as AdminSettingItem;
}

const generalItems: AdminSettingItem[] = [
  makeItem({
    key: "site.title",
    type: "string",
    label: "Site title",
    default: "Roamlog",
    value: "Roamlog",
    isPublic: true,
    help: "Shown in the browser tab and public header.",
  }),
  makeItem({
    key: "general.defaultLanguage",
    type: "string",
    label: "Default language",
    default: "zh-CN",
    value: "zh-CN",
    options: ["zh-CN", "en"],
  }),
  makeItem({
    key: "general.registrationEnabled",
    type: "boolean",
    label: "Registration open",
    default: false,
    value: false,
  }),
  makeItem({
    key: "general.defaultTimeZone",
    type: "string",
    label: "Default time zone",
    default: "Asia/Shanghai",
    value: "Asia/Shanghai",
    envLocked: true,
  }),
  makeItem({
    key: "general.metadata",
    type: "json",
    label: "Metadata",
    default: {},
    value: { theme: "dark" },
  }),
];

const mailItems: AdminSettingItem[] = [
  makeItem({
    key: "mail.provider",
    type: "string",
    label: "Mail provider",
    group: "mail",
    default: "resend",
    value: "resend",
    options: ["resend", "smtp"],
  }),
  makeItem({
    key: "mail.smtpPort",
    type: "number",
    label: "SMTP port",
    group: "mail",
    default: 587,
    value: 587,
  }),
  makeItem({
    key: "mail.resendApiKey",
    type: "secret",
    label: "Resend API key",
    group: "mail",
    default: null,
    secret: { hasValue: true, last4: "abcd" },
  }),
  makeItem({
    key: "mail.smtpPassword",
    type: "secret",
    label: "SMTP password",
    group: "mail",
    default: null,
    secret: { hasValue: false, last4: null },
  }),
];

const storageItems: AdminSettingItem[] = [
  makeItem({
    key: "storage.endpoint",
    type: "string",
    label: "S3 endpoint",
    group: "storage",
    default: null,
    value: "http://localhost:9000",
  }),
  makeItem({
    key: "storage.publicEndpoint",
    type: "string",
    label: "Public endpoint",
    group: "storage",
    default: null,
    value: "",
  }),
  makeItem({
    key: "storage.bucket",
    type: "string",
    label: "Bucket",
    group: "storage",
    default: "roamlog",
    value: "roamlog",
  }),
  makeItem({
    key: "storage.accessKey",
    type: "string",
    label: "Access key",
    group: "storage",
    default: null,
    value: "",
  }),
  makeItem({
    key: "storage.secretKey",
    type: "secret",
    label: "Secret key",
    group: "storage",
    default: null,
    secret: { hasValue: false, last4: null },
  }),
];

const mediaItems: AdminSettingItem[] = [
  makeItem({
    key: "media.maxEdge",
    type: "number",
    label: "Max edge (px)",
    group: "media",
    default: 2000,
    value: 2000,
    isPublic: true,
  }),
  makeItem({
    key: "media.quality",
    type: "number",
    label: "WebP quality",
    group: "media",
    default: 0.82,
    value: 0.82,
    isPublic: true,
  }),
  makeItem({
    key: "media.targetBytes",
    type: "number",
    label: "Target bytes",
    group: "media",
    default: 1_500_000,
    value: 1_500_000,
    isPublic: true,
  }),
  makeItem({
    key: "media.maxUploadBytes",
    type: "number",
    label: "Max upload bytes",
    group: "media",
    default: 25 * 1024 * 1024,
    value: 25 * 1024 * 1024,
    isPublic: true,
  }),
  makeItem({
    key: "media.keepOriginal",
    type: "boolean",
    label: "Keep originals",
    group: "media",
    default: false,
    value: false,
  }),
  makeItem({
    key: "media.livePhotoEnabled",
    type: "boolean",
    label: "Live Photos",
    group: "media",
    default: false,
    value: false,
  }),
];

const placesItems: AdminSettingItem[] = [
  makeItem({
    key: "places.provider",
    type: "string",
    label: "Places provider",
    group: "places",
    default: "geoapify",
    value: "geoapify",
    options: ["geoapify", "photon"],
  }),
  makeItem({
    key: "places.apiKey",
    type: "secret",
    label: "Places API key",
    group: "places",
    default: null,
    secret: { hasValue: false, last4: null },
  }),
  makeItem({
    key: "places.lang",
    type: "string",
    label: "Search language",
    group: "places",
    default: "zh",
    value: "zh",
  }),
  makeItem({
    key: "places.limit",
    type: "number",
    label: "Result limit",
    group: "places",
    default: 6,
    value: 6,
  }),
  makeItem({
    key: "places.cacheTtlSeconds",
    type: "number",
    label: "Cache TTL (seconds)",
    group: "places",
    default: 900,
    value: 900,
  }),
  makeItem({
    key: "places.dailyQuota",
    type: "number",
    label: "Daily quota",
    group: "places",
    default: 2500,
    value: 2500,
  }),
];

const aiItems: AdminSettingItem[] = [
  makeItem({
    key: "ai.defaultProvider",
    type: "string",
    label: "Default AI provider",
    group: "ai",
    default: "openai-chat",
    value: "openai-chat",
  }),
  makeItem({
    key: "ai.timeoutMs",
    type: "number",
    label: "Request timeout (ms)",
    group: "ai",
    default: 60_000,
    value: 60_000,
  }),
  makeItem({
    key: "ai.maxOutputTokens",
    type: "number",
    label: "Max output tokens",
    group: "ai",
    default: 6_000,
    value: 6_000,
  }),
  makeItem({
    key: "ai.dailyQuota",
    type: "number",
    label: "Daily quota",
    group: "ai",
    default: 20,
    value: 20,
  }),
];

function responseOf(): AdminSettingsResponse {
  return {
    groups: [
      { group: "general", label: "General", items: generalItems },
      { group: "mail", label: "Mail", items: mailItems },
      { group: "media", label: "Media", items: mediaItems },
      { group: "ai", label: "AI", items: aiItems },
      { group: "places", label: "Places", items: placesItems },
      { group: "storage", label: "Storage", items: storageItems },
    ],
    generatedAt: "2026-11-19T05:00:00.000Z",
  };
}

function updateResult(keys: readonly string[]): UpdateAdminSettingsResponse {
  return {
    updated: keys.map((key) => ({ key, secret: false, updatedAt: "2026-11-19T05:01:00.000Z" })),
    version: 1,
    generatedAt: "2026-11-19T05:01:00.000Z",
  };
}

function createApi(initial: AdminSettingsResponse) {
  let current = initial;
  const list = vi.fn(async () => current);
  const update = vi.fn(async (updates: readonly AdminSettingUpdate[]) =>
    updateResult(updates.map((entry) => entry.key)),
  );
  const reveal = vi.fn(async (key: string) => ({
    key,
    value: RESEND_PLAINTEXT,
    revealedAt: "2026-11-19T05:02:00.000Z",
  }));
  const api: AdminSettingsApi = { list, update, reveal };
  return {
    api,
    list,
    update,
    reveal,
    setCurrent: (next: AdminSettingsResponse) => {
      current = next;
    },
  };
}

async function renderConsole(
  initialGroup: "general" | "mail" | "media" | "ai" | "places" | "storage" = "general",
  role: "super_admin" | "analyst" = "super_admin",
) {
  const fake = createApi(responseOf());
  render(<SettingsConsole role={role} initialGroup={initialGroup} api={fake.api} />);
  const headings: Record<typeof initialGroup, string> = {
    general: "General",
    mail: "Mail",
    media: "Media",
    ai: "AI",
    places: "Places",
    storage: "Storage",
  };
  await screen.findByRole("heading", { name: headings[initialGroup] });
  return fake;
}

/** 422 SETTINGS_PROBE_FAILED as the API client now surfaces it. */
function probeFailure(probe: unknown, detail = "The settings save probe failed.") {
  return new AdminSettingsError({
    code: "SETTINGS_PROBE_FAILED",
    status: 422,
    title: "Configuration rejected",
    detail,
    degraded: [],
    probe,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SettingsConsole", () => {
  it("renders every field type from the API payload with its source", async () => {
    await renderConsole("general");

    expect(screen.getByLabelText("Site title")).toHaveValue("Roamlog");
    expect(screen.getByLabelText("Default language")).toHaveValue("zh-CN");
    expect(screen.getByRole("switch", { name: "Registration open" })).not.toBeChecked();
    expect(
      within(screen.getByRole("article", { name: "设置项 Registration open" })).getByLabelText(
        "Registration open 消费状态",
      ),
    ).toHaveTextContent("未接入（不生效）");
    expect(screen.getByLabelText("Default time zone")).toBeDisabled();
    expect(screen.getByText("由环境变量锁定，界面不可改。")).toBeInTheDocument();
    expect(screen.getByLabelText("Metadata JSON 键 1")).toHaveValue("theme");
    expect(screen.getByLabelText("Metadata JSON 值 1")).toHaveValue('"dark"');
    expect(screen.getByText("Shown in the browser tab and public header.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "设置项 Site title" })).getByText(
        /当前值来源：代码默认/,
      ),
    ).toBeInTheDocument();
  });

  it("marks the wired mail group as backend and keeps the worker limit visible", async () => {
    const user = userEvent.setup();
    await renderConsole("mail");

    expect(screen.getByRole("heading", { name: "Mail" })).toBeInTheDocument();
    const status = screen.getByText("后端已消费，worker 仍读环境变量");
    expect(status).toHaveAttribute("data-consumption-status", "backend");
    expect(status.className).toContain("text-accent-blue");
    expect(status.className).not.toContain("text-accent-yellow");
    expect(status.textContent).not.toContain("不生效，仍读环境变量");

    for (const label of ["Mail provider", "SMTP port", "Resend API key", "SMTP password"]) {
      const field = screen.getByRole("article", { name: `设置项 ${label}` });
      expect(within(field).getByLabelText(`${label} 消费状态`)).toHaveTextContent(
        "后端已消费",
      );
      expect(within(field).getByText(/worker 导出通知不生效/)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("SMTP port")).toHaveValue(587);

    await user.click(screen.getByRole("link", { name: /General/ }));
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "前端已消费（标题/描述/主题）；general.registrationEnabled 未接入（不生效）",
      ),
    ).toBeInTheDocument();
    expect(window.location.search).toBe("?group=general");
  });

  it("shows places as backend-consumed and labels all six keys", async () => {
    await renderConsole("places");

    const status = screen.getByText("后端已消费（PlacesModule 运行期读取）");
    expect(status).toHaveAttribute("data-consumption-status", "backend");
    expect(status.className).toContain("text-accent-blue");
    expect(status.className).not.toContain("text-accent-green");

    for (const label of [
      "Places provider",
      "Places API key",
      "Search language",
      "Result limit",
      "Cache TTL (seconds)",
      "Daily quota",
    ]) {
      const field = screen.getByRole("article", { name: `设置项 ${label}` });
      expect(within(field).getByLabelText(`${label} 消费状态`)).toHaveTextContent(
        "后端已消费",
      );
    }
  });

  it("shows ai as backend-consumed and never as unwired", async () => {
    await renderConsole("ai");

    expect(screen.getByRole("heading", { name: "AI" })).toBeInTheDocument();
    const status = screen.getByText("后端已消费（AiModule 运行期读取）");
    expect(status).toHaveAttribute("data-consumption-status", "backend");
    expect(status.className).toContain("text-accent-blue");
    expect(status.textContent).not.toContain("不生效");
    expect(screen.queryByText(/未接入（不生效/)).not.toBeInTheDocument();

    for (const label of [
      "Default AI provider",
      "Request timeout (ms)",
      "Max output tokens",
      "Daily quota",
    ]) {
      const field = screen.getByRole("article", { name: `设置项 ${label}` });
      expect(within(field).getByLabelText(`${label} 消费状态`)).toHaveTextContent(
        "后端已消费",
      );
    }
  });

  it("marks each media key truthfully instead of claiming the whole group is consumed", async () => {
    await renderConsole("media");

    expect(
      screen.getByText(/前端已消费 4\/6 个键（maxEdge、quality、targetBytes、maxUploadBytes）/),
    ).toBeInTheDocument();
    expect(screen.getByText(/keepOriginal 与 livePhotoEnabled 未接入（不生效）/)).toBeInTheDocument();

    for (const label of [
      "Max edge (px)",
      "WebP quality",
      "Target bytes",
      "Max upload bytes",
    ]) {
      const field = screen.getByRole("article", { name: `设置项 ${label}` });
      expect(within(field).getByLabelText(`${label} 消费状态`)).toHaveTextContent(
        "前端已消费",
      );
    }

    for (const label of ["Keep originals", "Live Photos"]) {
      const field = screen.getByRole("article", { name: `设置项 ${label}` });
      expect(within(field).getByLabelText(`${label} 消费状态`)).toHaveTextContent(
        "未接入（不生效）",
      );
    }
  });

  it("keeps save disabled until something actually changed", async () => {
    const user = userEvent.setup();
    await renderConsole("general");
    const save = screen.getByRole("button", { name: "保存更改" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Site title"), "!");
    expect(save).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(save).toBeDisabled();
  });

  it("submits a number as a number, a boolean as a boolean, a select as a string, and JSON as an object", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("general");

    await user.click(screen.getByRole("switch", { name: "Registration open" }));
    fireEvent.change(screen.getByLabelText("Metadata JSON 值 1"), { target: { value: '"light"' } });
    fireEvent.change(screen.getByLabelText("Default language"), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText("Metadata JSON 键 1"), { target: { value: "theme" } });

    const updated = responseOf();
    updated.groups[0] = {
      ...updated.groups[0]!,
      items: generalItems.map((item) =>
        item.key === "general.registrationEnabled"
          ? { ...item, value: true }
          : item.key === "general.defaultLanguage"
            ? { ...item, value: "en" }
            : item.key === "general.metadata"
              ? { ...item, value: { theme: "light" } }
              : item,
      ),
    };
    fake.setCurrent(updated);
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(fake.update).toHaveBeenCalledWith([
      { key: "general.defaultLanguage", value: "en" },
      { key: "general.registrationEnabled", value: true },
      { key: "general.metadata", value: { theme: "light" } },
    ]);
  });

  it("submits a number field as number 2525, not the string \"2525\"", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");

    fireEvent.change(screen.getByLabelText("SMTP port"), { target: { value: "2525" } });
    const updated = responseOf();
    updated.groups[1] = {
      ...updated.groups[1]!,
      items: mailItems.map((item) =>
        item.key === "mail.smtpPort" ? { ...item, value: 2525 } : item,
      ),
    };
    fake.setCurrent(updated);
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(fake.update).toHaveBeenCalledWith([{ key: "mail.smtpPort", value: 2525 }]);
    expect(fake.update.mock.calls[0]?.[0]?.[0]?.value).not.toBe("2525");
  });

  it("shows 未设置 or ••••last4 for secrets and never renders plaintext", async () => {
    await renderConsole("mail");

    const current = screen.getByLabelText("Resend API key 当前值");
    expect(current).toHaveValue("••••abcd");
    expect(screen.getByLabelText("SMTP password 当前值")).toHaveValue("未设置");
    expect(screen.queryByRole("button", { name: /显示 SMTP password/ })).not.toBeInTheDocument();

    expect(document.body.innerHTML).not.toContain(RESEND_PLAINTEXT);
    expect(screen.queryByDisplayValue(RESEND_PLAINTEXT)).not.toBeInTheDocument();
  });

  it("sends a typed secret replacement and only shows last4 after the server re-read", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    const newSecret = "re_replacement_secret_1234";

    await user.type(screen.getByLabelText("设置新值 Resend API key"), newSecret);
    const updated = responseOf();
    updated.groups[1] = {
      ...updated.groups[1]!,
      items: mailItems.map((item) =>
        item.key === "mail.resendApiKey"
          ? { ...item, secret: { hasValue: true, last4: "1234" }, updatedAt: "2026-11-19T05:01:00.000Z" }
          : item,
      ),
    };
    fake.setCurrent(updated);
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(fake.update).toHaveBeenCalledWith([{ key: "mail.resendApiKey", value: newSecret }]);
    expect(screen.getByLabelText("Resend API key 当前值")).toHaveValue("••••1234");
    expect(screen.queryByDisplayValue(newSecret)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(newSecret);
    expect(screen.getByRole("status")).toHaveTextContent("已保存并重新读取");
  });

  it("reveals a secret only after explicit confirmation and records the audit notice", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");

    await user.click(
      screen.getByRole("button", { name: "显示 Resend API key（记入审计）" }),
    );
    const dialog = screen.getByRole("dialog", { name: "显示敏感值" });
    expect(within(dialog).getByText(/这是一次带审计的操作/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认显示（记入审计）" }));

    expect(fake.reveal).toHaveBeenCalledWith("mail.resendApiKey");
    expect(await screen.findByDisplayValue(RESEND_PLAINTEXT)).toBeInTheDocument();
    expect(screen.getByText(/本次显示已记入审计/)).toBeInTheDocument();
  });

  it("maps 403 reveal failures to the permission/2FA reason", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    fake.reveal.mockRejectedValue(
      new AdminSettingsError({
        code: "ADMIN_2FA_REQUIRED",
        status: 403,
        title: "Forbidden",
        detail: "Enroll and verify TOTP.",
        degraded: [],
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "显示 Resend API key（记入审计）" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "显示敏感值" })).getByRole("button", {
        name: "确认显示（记入审计）",
      }),
    );

    expect(await screen.findByText(/需要完成 TOTP 2FA 验证后才能显示敏感值/)).toBeInTheDocument();
    expect(screen.getByLabelText("Resend API key 当前值")).toHaveValue("••••abcd");
  });

  it("auto-hides revealed plaintext after the 10 second audit window", async () => {
    vi.useFakeTimers();
    const fake = createApi(responseOf());
    render(<SettingsConsole role="super_admin" initialGroup="mail" api={fake.api} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "显示 Resend API key（记入审计）" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "显示敏感值" })).getByRole("button", {
        name: "确认显示（记入审计）",
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Resend API key 当前值")).toHaveValue(RESEND_PLAINTEXT);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByLabelText("Resend API key 当前值")).toHaveValue("••••abcd");
    expect(screen.queryByText(/本次显示已记入审计/)).not.toBeInTheDocument();
  });

  it("maps a 422 SETTINGS_INVALID errors[] onto fields and keeps typed values", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    fake.update.mockRejectedValue(
      new AdminSettingsError(
        {
          code: "SETTINGS_INVALID",
          status: 422,
          title: "Unprocessable Content",
          detail: "One or more settings were rejected.",
          degraded: [],
        },
        [
          {
            field: "mail.smtpPort",
            code: "INVALID_VALUE",
            message: "Number must be less than or equal to 65535",
          },
        ],
      ),
    );

    const port = screen.getByLabelText("SMTP port");
    fireEvent.change(port, { target: { value: "70000" } });
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const field = screen.getByRole("article", { name: "设置项 SMTP port" });
    expect(await within(field).findByText(/Number must be less than or equal to 65535/)).toBeInTheDocument();
    expect(port).toHaveValue(70000);
    expect(screen.getByText("有字段未通过服务端校验")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存更改" })).toBeEnabled();
  });

  it("shows a super-admin permission error on save and keeps the draft", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("general");
    fake.update.mockRejectedValue(
      new AdminSettingsError({
        code: "ADMIN_ACCESS_DENIED",
        status: 403,
        title: "Forbidden",
        detail: "This Admin action is not available for your platform role.",
        degraded: [],
      }),
    );

    const title = screen.getByLabelText("Site title");
    await user.type(title, "!");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(await screen.findByText("需要超级管理员权限。")).toBeInTheDocument();
    expect(title).toHaveValue("Roamlog!");
    expect(fake.update).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable failure for network/5xx without losing input", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("general");
    fake.update.mockRejectedValue(
      new AdminMutationError({
        code: "ADMIN_API_UNAVAILABLE",
        status: 503,
        title: "Service Unavailable",
        detail: "The API is down.",
        degraded: [],
      }),
    );

    const title = screen.getByLabelText("Site title");
    await user.type(title, "!");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(await screen.findByText("保存失败，可重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试保存" })).toBeInTheDocument();
    expect(title).toHaveValue("Roamlog!");
  });

  it("disables writes for non-super-admin roles", async () => {
    await renderConsole("general", "analyst");

    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
    expect(screen.getByText(/系统设置需要超级管理员权限/)).toBeInTheDocument();
  });

  it("shows the database source and updatedAt after a save re-read", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("general");

    await user.type(screen.getByLabelText("Site title"), "!");
    const updated = responseOf();
    updated.groups[0] = {
      ...updated.groups[0]!,
      items: generalItems.map((item) =>
        item.key === "site.title"
          ? { ...item, value: "Roamlog!", updatedAt: "2026-11-19T05:01:00.000Z" }
          : item,
      ),
    };
    fake.setCurrent(updated);
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(await screen.findByText("已保存并重新读取 1 项设置。")).toBeInTheDocument();
    const field = screen.getByRole("article", { name: "设置项 Site title" });
    expect(within(field).getByText(/当前值来源：数据库/)).toBeInTheDocument();
    expect(screen.getByText(/最近写入：/)).toBeInTheDocument();
  });

  it("explains a blocked storage save instead of a generic rejection", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("storage");
    fake.update.mockRejectedValue(
      probeFailure(
        {
          target: "storage",
          code: "STORAGE_ENDPOINT_UNREACHABLE",
          checks: [{ name: "HeadBucket", ok: false, ms: 117 }],
        },
        "The endpoint could not be reached (ECONNREFUSED). Check the endpoint.",
      ),
    );

    const endpoint = screen.getByLabelText("S3 endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://127.0.0.1:19999");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    // role=alert is what makes a screen reader announce the block immediately.
    const alert = await screen.findByRole("alert");
    const headline = alert.querySelector("[data-probe-headline]");
    expect(headline).toHaveTextContent(
      "存储服务无法连接：检查 endpoint 与网络（当前 endpoint: http://127.0.0.1:19999）",
    );
    expect(headline?.textContent).not.toContain("STORAGE_ENDPOINT_UNREACHABLE");
    expect(screen.queryByText("Configuration rejected")).not.toBeInTheDocument();

    // The step that failed is visible, with its measured latency.
    const checkRows = alert.querySelectorAll("[data-probe-check-ok]");
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0]).toHaveTextContent("✗ HeadBucket 117ms");

    // Raw code/target/failedAt live in a collapsed technical details block.
    const technical = alert.querySelector("details[data-probe-technical]");
    expect(technical).not.toBeNull();
    expect(technical).not.toHaveAttribute("open");
    expect(
      within(technical as HTMLElement).getByText("STORAGE_ENDPOINT_UNREACHABLE"),
    ).toBeInTheDocument();
    expect(within(technical as HTMLElement).getByText("HeadBucket")).toBeInTheDocument();

    // The retry action stays ghost/outline; the save button is the only white primary.
    const retry = within(alert).getByRole("button", { name: "重试保存" });
    expect(retry.className).not.toContain("bg-ink");
    expect(screen.getByRole("button", { name: "保存更改" }).className).toContain("bg-ink");

    // Nothing was reset: the draft that failed is still on screen.
    expect(endpoint).toHaveValue("http://127.0.0.1:19999");
  });

  it("lists every probe step, including the ones that passed", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("storage");
    fake.update.mockRejectedValue(
      probeFailure({
        target: "storage",
        code: "STORAGE_READ_MISMATCH",
        checks: [
          { name: "HeadBucket", ok: true, ms: 95 },
          { name: "PutObject", ok: false },
        ],
      }),
    );

    await user.type(screen.getByLabelText("Bucket"), "-tmp");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    const rows = alert.querySelectorAll("[data-probe-check-ok]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-probe-check-ok", "true");
    expect(rows[0]).toHaveTextContent("✓ HeadBucket 95ms");
    expect(rows[1]).toHaveAttribute("data-probe-check-ok", "false");
    expect(rows[1]).toHaveTextContent("✗ PutObject —");
    expect(
      (rows[1] as HTMLElement).querySelector(".text-accent-red"),
    ).not.toBeNull();

    // Unknown storage code falls back to the bucket/permission hint.
    expect(alert).toHaveTextContent("Bucket 不存在或无权访问：检查 bucket 名称与权限");
  });

  it("marks missing credentials inline and clears the note once the field is filled", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("storage");
    fake.update.mockRejectedValue(
      probeFailure({ target: "storage", code: "MISSING_CREDENTIALS", checks: [] }),
    );

    await user.type(screen.getByLabelText("Bucket"), "-tmp");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("缺少访问凭据：请先填写 Access Key 与 Secret Key");

    const accessField = screen.getByRole("article", { name: "设置项 Access key" });
    const secretField = screen.getByRole("article", { name: "设置项 Secret key" });
    expect(within(accessField).getByRole("note")).toHaveTextContent(
      "保存探测缺少访问凭据：请填写 Access Key。",
    );
    expect(within(secretField).getByRole("note")).toHaveTextContent(
      "保存探测缺少访问凭据：请填写 Secret Key。",
    );

    await user.type(screen.getByLabelText("设置新值 Secret key"), "sk_test_value");
    expect(within(secretField).queryByRole("note")).not.toBeInTheDocument();
    expect(within(accessField).getByRole("note")).toBeInTheDocument();
    expect(screen.getByLabelText("设置新值 Secret key")).toHaveValue("sk_test_value");
  });

  it("explains an SMTP auth rejection on the mail group", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    fake.update.mockRejectedValue(
      probeFailure({
        target: "mail",
        code: "AUTH_FAILED",
        checks: [],
      }),
    );

    const port = screen.getByLabelText("SMTP port");
    fireEvent.change(port, { target: { value: "2526" } });
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "SMTP 认证被拒：检查用户名与应用专用密码（不是账号登录密码）",
    );
    expect(alert).toHaveTextContent("保存被拦截 · 邮件");
    expect(port).toHaveValue(2526);
  });

  it("shows the server detail for an unknown probe code without using the raw code", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    const detail = "The SMTP transport timed out after 10 seconds.";
    fake.update.mockRejectedValue(
      probeFailure({ target: "mail", code: "SMTP_TIMEOUT_UNKNOWN", checks: [] }, detail),
    );

    fireEvent.change(screen.getByLabelText("SMTP port"), { target: { value: "2526" } });
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    const headline = alert.querySelector("[data-probe-headline]");
    expect(headline).toHaveTextContent(detail);
    expect(headline?.textContent).not.toContain("SMTP_TIMEOUT_UNKNOWN");

    const technical = alert.querySelector("details[data-probe-technical]");
    expect(technical).not.toHaveAttribute("open");
    expect(within(technical as HTMLElement).getByText("SMTP_TIMEOUT_UNKNOWN")).toBeInTheDocument();
  });

  it("explains an unavailable probe service and keeps every typed value", async () => {
    const user = userEvent.setup();
    const fake = await renderConsole("mail");
    fake.update.mockRejectedValue(
      probeFailure(
        { target: "mail", code: "PROBE_UNAVAILABLE", checks: [] },
        "The settings probe is temporarily unavailable.",
      ),
    );

    const port = screen.getByLabelText("SMTP port");
    fireEvent.change(port, { target: { value: "2526" } });
    const secret = screen.getByLabelText("设置新值 Resend API key");
    await user.type(secret, "re_typed_secret_1234");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("探测服务不可用，配置未保存。可稍后重试");
    expect(port).toHaveValue(2526);
    expect(secret).toHaveValue("re_typed_secret_1234");
    expect(fake.update).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: "mail.resendApiKey", value: "re_typed_secret_1234" }]),
    );
  });
});