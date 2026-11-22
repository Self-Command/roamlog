import { describe, expect, it, vi } from "vitest";

import type { AdminSettingsResponse } from "@roamlog/contracts";

import type { AdminSettingsApi } from "./admin-settings-api";
import { createCachedAdminSettingsApi } from "./cached-admin-settings-api";

function settingsFixture(title = "Roamlog"): AdminSettingsResponse {
  return {
    groups: [
      {
        group: "general",
        label: "通用",
        items: [
          {
            key: "site.title",
            group: "general",
            type: "string",
            label: "站点标题",
            default: "Roamlog",
            isSecret: false,
            isPublic: true,
            envLocked: false,
            value: title,
            updatedAt: null,
            updatedById: null,
          },
        ],
      },
    ],
    generatedAt: "2026-11-22T12:00:00.000Z",
  };
}

function fakeApi() {
  const list = vi.fn<AdminSettingsApi["list"]>();
  const update = vi.fn<AdminSettingsApi["update"]>();
  const reveal = vi.fn<AdminSettingsApi["reveal"]>();
  return {
    api: { list, update, reveal } satisfies AdminSettingsApi,
    list,
    update,
    reveal,
  };
}

describe("createCachedAdminSettingsApi", () => {
  it("shares one in-flight and cached list response", async () => {
    const fake = fakeApi();
    fake.list.mockResolvedValue(settingsFixture());
    const api = createCachedAdminSettingsApi(fake.api);

    const [first, second] = await Promise.all([api.list(), api.list()]);
    const third = await api.list();

    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(fake.list).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected pending request so retry can recover", async () => {
    const fake = fakeApi();
    fake.list
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(settingsFixture("Recovered"));
    const api = createCachedAdminSettingsApi(fake.api);

    await expect(api.list()).rejects.toThrow("network");
    await expect(api.list()).resolves.toMatchObject({
      groups: [{ items: [{ value: "Recovered" }] }],
    });
    expect(fake.list).toHaveBeenCalledTimes(2);
  });

  it("invalidates the snapshot after a successful update", async () => {
    const fake = fakeApi();
    fake.list
      .mockResolvedValueOnce(settingsFixture())
      .mockResolvedValueOnce(settingsFixture("Updated"));
    fake.update.mockResolvedValue({
      updated: [{ key: "site.title", secret: false, updatedAt: "2026-11-22T12:01:00.000Z" }],
      version: 2,
      generatedAt: "2026-11-22T12:01:00.000Z",
    });
    const api = createCachedAdminSettingsApi(fake.api);

    await api.list();
    await api.update([{ key: "site.title", value: "Updated" }]);
    const fresh = await api.list();

    expect(fresh.groups[0]?.items[0]?.value).toBe("Updated");
    expect(fake.list).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate the snapshot when update fails", async () => {
    const fake = fakeApi();
    fake.list.mockResolvedValue(settingsFixture());
    fake.update.mockRejectedValue(new Error("rejected"));
    const api = createCachedAdminSettingsApi(fake.api);

    await api.list();
    await expect(api.update([{ key: "site.title", value: "Nope" }])).rejects.toThrow("rejected");
    await api.list();

    expect(fake.list).toHaveBeenCalledTimes(1);
  });

  it("delegates reveal unchanged", async () => {
    const fake = fakeApi();
    fake.reveal.mockResolvedValue({
      key: "mail.resendApiKey",
      value: "secret",
      revealedAt: "2026-11-22T12:00:00.000Z",
    });
    const api = createCachedAdminSettingsApi(fake.api);

    await expect(api.reveal("mail.resendApiKey")).resolves.toMatchObject({
      key: "mail.resendApiKey",
    });
    expect(fake.reveal).toHaveBeenCalledWith("mail.resendApiKey");
  });
});
