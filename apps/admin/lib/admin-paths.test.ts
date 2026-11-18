import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ADMIN_LOGIN_PATH, getAdminLoginPath } from "./admin-paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdminLoginPath", () => {
  it("uses the local /login route when no same-domain path is configured", () => {
    expect(getAdminLoginPath()).toBe(DEFAULT_ADMIN_LOGIN_PATH);
  });

  it("uses the configured same-domain login route", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_LOGIN_PATH", "/admin/login");

    expect(getAdminLoginPath()).toBe("/admin/login");
  });

  it("normalizes a configured path that omits the leading slash", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_LOGIN_PATH", "admin/login");

    expect(getAdminLoginPath()).toBe("/admin/login");
  });
});
