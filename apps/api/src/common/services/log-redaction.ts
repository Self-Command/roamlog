export function redactUrlPathForLogging(rawUrl: string): string {
  try {
    return new URL(rawUrl, "http://roamlog.invalid").pathname;
  } catch {
    return "/[redacted]";
  }
}

export const REDACTED_INVITATION_ACCEPT_PATH = "/v1/invitations/[redacted]/accept";
