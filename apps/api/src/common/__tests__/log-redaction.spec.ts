import { describe, expect, it } from "vitest";

import {
  REDACTED_INVITATION_ACCEPT_PATH,
  redactUrlPathForLogging,
} from "../services/log-redaction.js";

describe("request URL log redaction", () => {
  it("removes auth query tokens before an HTTP log is emitted", () => {
    expect(
      redactUrlPathForLogging("/v1/auth/verify-email?token=super-secret-token&callbackURL=app"),
    ).toBe("/v1/auth/verify-email");
    expect(redactUrlPathForLogging("/v1/auth/callback/github?code=oauth-code&state=state")).toBe(
      "/v1/auth/callback/github",
    );
  });

  it("provides a stable redacted invitation acceptance path", () => {
    expect(REDACTED_INVITATION_ACCEPT_PATH).not.toContain("token");
    expect(REDACTED_INVITATION_ACCEPT_PATH).toBe("/v1/invitations/[redacted]/accept");
  });
});
