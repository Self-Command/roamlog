import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_TOTP_REQUIRED_MESSAGE,
  assertBootstrapTwoFactorReady,
} from "../bootstrap-two-factor.js";
import { NOW } from "../../../../test/identity-fixtures.js";

describe("bootstrap CLI TOTP policy", () => {
  it("rejects an account without 2FA enabled", () => {
    expect(() =>
      assertBootstrapTwoFactorReady({
        twoFactorEnabled: false,
        twoFactors: [
          {
            secret: "encrypted-secret",
            backupCodes: "encrypted-codes",
            verified: true,
            lockedUntil: null,
          },
        ],
      }),
    ).toThrow(BOOTSTRAP_TOTP_REQUIRED_MESSAGE);
  });

  it("rejects an unverified TOTP enrollment", () => {
    expect(() =>
      assertBootstrapTwoFactorReady({
        twoFactorEnabled: true,
        twoFactors: [
          {
            secret: "encrypted-secret",
            backupCodes: "encrypted-codes",
            verified: false,
            lockedUntil: null,
          },
        ],
      }),
    ).toThrow(BOOTSTRAP_TOTP_REQUIRED_MESSAGE);
  });

  it("accepts a verified TOTP factor", () => {
    expect(() =>
      assertBootstrapTwoFactorReady(
        {
          twoFactorEnabled: true,
          twoFactors: [
            {
              secret: "encrypted-secret",
              backupCodes: "encrypted-codes",
              verified: true,
              lockedUntil: null,
            },
          ],
        },
        NOW,
      ),
    ).not.toThrow();
  });

  it("rejects a currently locked TOTP factor", () => {
    expect(() =>
      assertBootstrapTwoFactorReady(
        {
          twoFactorEnabled: true,
          twoFactors: [
            {
              secret: "encrypted-secret",
              backupCodes: "encrypted-codes",
              verified: true,
              lockedUntil: new Date(NOW.getTime() + 60_000),
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/temporarily locked/i);
  });
});
