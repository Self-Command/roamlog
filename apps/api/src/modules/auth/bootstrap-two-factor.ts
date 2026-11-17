export interface BootstrapTwoFactorState {
  twoFactorEnabled: boolean;
  twoFactors: Array<{
    secret: string;
    backupCodes: string;
    verified: boolean;
    lockedUntil: Date | null;
  }>;
}

export const BOOTSTRAP_TOTP_REQUIRED_MESSAGE =
  "The target account must have a verified TOTP factor before promotion.";

export function assertBootstrapTwoFactorReady(
  user: BootstrapTwoFactorState,
  now = new Date(),
): void {
  const verifiedFactor = user.twoFactors.find(
    (factor) =>
      factor.verified && factor.secret.trim().length > 0 && factor.backupCodes.trim().length > 0,
  );

  if (!user.twoFactorEnabled || !verifiedFactor) {
    throw new Error(BOOTSTRAP_TOTP_REQUIRED_MESSAGE);
  }

  if (verifiedFactor.lockedUntil && verifiedFactor.lockedUntil > now) {
    throw new Error(
      "The target account's TOTP factor is temporarily locked; resolve the lockout before promotion.",
    );
  }
}
