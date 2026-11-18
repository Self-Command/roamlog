import { describe, expect, it } from "vitest";
import type { Response } from "express";

import { AdminUsersController } from "../admin-users.controller.js";
import { AdminWorkspacesController } from "../admin-workspaces.controller.js";
import { USER_ADMIN_ID, makeActor } from "../../../../test/identity-fixtures.js";

interface FakeResponse {
  headers: Record<string, string>;
  chunks: string[];
  ended: boolean;
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => boolean;
  end: () => void;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    headers: {},
    chunks: [],
    ended: false,
    setHeader: (name, value) => {
      response.headers[name] = value;
    },
    write: (chunk) => {
      response.chunks.push(chunk);
      return true;
    },
    end: () => {
      response.ended = true;
    },
  };
  return response;
}

const actor = makeActor(USER_ADMIN_ID, { platformRole: "admin" });

describe("Admin export controllers", () => {
  it("streams user CSV chunks with attachment headers", async () => {
    async function* exportCsv() {
      yield "\uFEFFid,email\r\n";
      yield '"01942f30-1200-7000-8000-000000000001","admin@roamlog.test"\r\n';
    }
    const controller = new AdminUsersController({ exportCsv } as never);
    const response = fakeResponse();

    await controller.exportCsv(
      actor,
      { q: "admin" },
      response as unknown as Response,
    );

    expect(response.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["Content-Disposition"]).toMatch(
      /^attachment; filename="roamlog-admin-users-.*\.csv"$/,
    );
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.chunks.join("")).toContain("admin@roamlog.test");
    expect(response.ended).toBe(true);
  });

  it("streams workspace CSV chunks with attachment headers", async () => {
    async function* exportCsv() {
      yield "\uFEFFid,name\r\n";
      yield '"01942f30-1200-7000-8000-000000000002","Atlas Studio"\r\n';
    }
    const controller = new AdminWorkspacesController({ exportCsv } as never);
    const response = fakeResponse();

    await controller.exportCsv(actor, {}, response as unknown as Response);

    expect(response.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["Content-Disposition"]).toMatch(
      /^attachment; filename="roamlog-admin-workspaces-.*\.csv"$/,
    );
    expect(response.chunks.join("")).toContain("Atlas Studio");
    expect(response.ended).toBe(true);
  });

  it("does not send CSV headers when validation or permission fails before the first chunk", async () => {
    async function* exportCsv(fail = true): AsyncGenerator<string> {
      if (fail) {
        throw new Error("validation failed");
      }
      yield "should-not-be-reached";
    }
    const controller = new AdminUsersController({ exportCsv } as never);
    const response = fakeResponse();

    await expect(
      controller.exportCsv(actor, { limit: 0 }, response as unknown as Response),
    ).rejects.toThrow("validation failed");
    expect(response.headers).toEqual({});
    expect(response.chunks).toEqual([]);
    expect(response.ended).toBe(false);
  });
});