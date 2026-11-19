import { describe, expect, it } from "vitest";

import { toAdminApiFailure } from "./admin-api-error";

/**
 * Regression guard for a structured field that was already dropped once:
 * `toAdminApiFailure` normalizes a problem body down to five fields, so a new
 * field only survives if it is copied deliberately. When `probe` goes missing
 * the settings console does not error — it quietly falls back to "configuration
 * rejected", which is exactly the regression this test exists to prevent.
 */
describe("toAdminApiFailure", () => {
  it("keeps the probe payload so the console can explain the failure", () => {
    const probe = {
      target: "mail",
      code: "AUTH_FAILED",
      checks: [{ name: "verify", ok: false }],
    };

    const failure = toAdminApiFailure(422, {
      type: "https://roamlog.app/errors/settings-probe-failed",
      title: "Configuration rejected",
      status: 422,
      code: "SETTINGS_PROBE_FAILED",
      detail: "The SMTP server rejected the credentials.",
      probe,
    });

    expect(failure.code).toBe("SETTINGS_PROBE_FAILED");
    expect(failure.probe).toEqual(probe);
  });

  it("omits probe for ordinary problem responses", () => {
    const failure = toAdminApiFailure(403, {
      title: "Forbidden",
      status: 403,
      code: "ADMIN_ACCESS_DENIED",
      detail: "This Admin action is not available for your platform role.",
    });

    expect(failure).not.toHaveProperty("probe");
  });
});