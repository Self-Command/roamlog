import { ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { NOW, makeActor } from "../../../../test/identity-fixtures.js";
import { AppearanceService } from "../appearance.service.js";

interface Row {
  userId: string;
  mode: string | null;
  skin: string | null;
  fontPairing: string | null;
  updatedAt: Date;
}

function setup(input: { row?: Row | null; canOverride?: boolean } = {}) {
  let row = input.row ?? null;
  const delegate = {
    findUnique: vi.fn(async () => row),
    upsert: vi.fn(
      async (args: {
        create: Omit<Row, "updatedAt">;
        update: Partial<Omit<Row, "userId" | "updatedAt">>;
      }) => {
        if (row) {
          row = { ...row, ...args.update, updatedAt: NOW };
        } else {
          row = { ...args.create, updatedAt: NOW };
        }
        return row;
      },
    ),
    deleteMany: vi.fn(async () => {
      const count = row ? 1 : 0;
      row = null;
      return { count };
    }),
  };
  const prisma = {
    client: {
      userAppearancePreference: delegate,
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ userAppearancePreference: delegate }),
      ),
    },
  };
  const settings = {
    getGroup: vi.fn(async () => ({
      "theme.defaultSkin": "editorial-noir",
      "theme.defaultMode": "system",
      "theme.defaultFont": "editorial-classic",
      "theme.allowUserOverride": input.canOverride ?? true,
    })),
  };
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) };
  const service = new AppearanceService(prisma as never, settings as never, audit as never);
  return {
    service,
    prisma,
    settings,
    audit,
    get row() {
      return row;
    },
  };
}

describe("AppearanceService", () => {
  it("returns platform defaults when the user has no preference", async () => {
    const { service } = setup();
    const result = await service.get(makeActor());

    expect(result.appearance).toMatchObject({
      mode: "system",
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
      source: "platform",
      canOverride: true,
      updatedAt: null,
    });
    expect(result.cookie).toBeNull();
  });

  it("persists overrides, returns the resolved preference and a cookie", async () => {
    const { service, audit } = setup();
    const result = await service.update(makeActor(), { mode: "light" });

    expect(result.appearance).toMatchObject({
      mode: "light",
      skin: "editorial-noir",
      source: "user",
      updatedAt: NOW.toISOString(),
    });
    expect(result.cookie).toMatchObject({
      v: 1,
      mode: "light",
      uid: makeActor().user.id,
      updatedAt: NOW.toISOString(),
    });
    expect(result.cookie).not.toHaveProperty("skin");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.appearance.updated",
        metadata: { changedFields: ["mode"] },
      }),
      expect.anything(),
    );
  });

  it("clears one field without clearing the other overrides", async () => {
    const actor = makeActor();
    const { service } = setup({
      row: {
        userId: actor.user.id,
        mode: "dark",
        skin: "kanagawa",
        fontPairing: null,
        updatedAt: NOW,
      },
    });
    const result = await service.update(actor, { mode: null });

    expect(result.appearance).toMatchObject({
      mode: "system",
      skin: "kanagawa",
      source: "user",
    });
    expect(result.cookie).toMatchObject({ skin: "kanagawa" });
    expect(result.cookie).not.toHaveProperty("mode");
  });

  it("rejects override attempts when the platform disables them", async () => {
    const { service, prisma } = setup({ canOverride: false });
    await expect(service.update(makeActor(), { mode: "dark" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("reports platform defaults and ignores a stored row when overrides are disabled", async () => {
    const actor = makeActor();
    const { service } = setup({
      canOverride: false,
      row: {
        userId: actor.user.id,
        mode: "dark",
        skin: "catppuccin",
        fontPairing: "swiss-modern",
        updatedAt: NOW,
      },
    });
    const result = await service.get(actor);

    expect(result.appearance).toMatchObject({
      mode: "system",
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
      source: "platform",
      canOverride: false,
      updatedAt: null,
    });
    expect(result.cookie).toBeNull();
  });

  it("resets the row and audits the fields that were actually set", async () => {
    const actor = makeActor();
    const { service, audit } = setup({
      row: {
        userId: actor.user.id,
        mode: null,
        skin: "rose-pine",
        fontPairing: "literary-warm",
        updatedAt: NOW,
      },
    });
    const result = await service.reset(actor);

    expect(result.appearance).toMatchObject({ source: "platform", updatedAt: null });
    expect(result.cookie).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { reset: true, changedFields: ["skin", "fontPairing"] },
      }),
      expect.anything(),
    );
  });

  it("rejects unknown appearance IDs before writing", async () => {
    const { service, prisma } = setup();
    await expect(service.update(makeActor(), { skin: "not-a-skin" })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });
});
