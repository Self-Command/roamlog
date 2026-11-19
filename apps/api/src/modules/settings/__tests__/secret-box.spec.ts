import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SecretBox, SecretBoxError, keyIdFor } from "../secret-box.js";

function key(): string {
  return randomBytes(32).toString("base64");
}

function expectCode(fn: () => unknown, code: SecretBoxError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretBoxError);
    expect((error as SecretBoxError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SecretBoxError ${code}`);
}

describe("SecretBox", () => {
  it("round-trips a secret with the documented v1 envelope", () => {
    const raw = key();
    const box = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: raw });
    const encrypted = box.encrypt("mail.smtpPassword", "hunter2-smtp");

    expect(encrypted.ciphertext.startsWith(`v1:${keyIdFor(Buffer.from(raw, "base64"))}:`)).toBe(
      true,
    );
    expect(encrypted.ciphertext).not.toContain("hunter2");
    expect(box.decrypt("mail.smtpPassword", encrypted.ciphertext)).toBe("hunter2-smtp");
    expect(encrypted.keyVersion).toBe(1);
  });

  it("fails loudly with the wrong key instead of returning an empty string", () => {
    const box = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key() });
    const foreign = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key() });
    const encrypted = box.encrypt("storage.secretKey", "s3-secret");

    expectCode(
      () => foreign.decrypt("storage.secretKey", encrypted.ciphertext),
      "SECRET_DECRYPT_FAILED",
    );
  });

  it("keeps old ciphertext readable after a key rotation", () => {
    const oldKey = key();
    const newKey = key();
    const before = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: oldKey });
    const encrypted = before.encrypt("places.apiKey", "geo-key-1234");

    const rotated = SecretBox.fromEnvironment({
      CONFIG_ENCRYPTION_KEYS: `${newKey},${oldKey}`,
    });
    expect(rotated.decrypt("places.apiKey", encrypted.ciphertext)).toBe("geo-key-1234");

    const fresh = rotated.encrypt("places.apiKey", "new-key");
    expect(fresh.keyId).toBe(keyIdFor(Buffer.from(newKey, "base64")));
    // The old-only box cannot read the newly rotated ciphertext; the rotated
    // ring can.
    expectCode(() => before.decrypt("places.apiKey", fresh.ciphertext), "SECRET_DECRYPT_FAILED");
    expect(rotated.decrypt("places.apiKey", fresh.ciphertext)).toBe("new-key");
  });

  it("binds ciphertext to its setting key through AAD", () => {
    const box = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key() });
    const encrypted = box.encrypt("mail.resendApiKey", "re_secret");

    expectCode(
      () => box.decrypt("mail.smtpPassword", encrypted.ciphertext),
      "SECRET_DECRYPT_FAILED",
    );
  });

  it("rejects tampered, truncated, and malformed ciphertext", () => {
    const box = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key() });
    const encrypted = box.encrypt("storage.accessKey", "access-key");
    const [version, keyId, payload] = encrypted.ciphertext.split(":");

    const tampered = Buffer.from(payload ?? "", "base64");
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;

    expectCode(
      () => box.decrypt("storage.accessKey", `${version}:${keyId}:${tampered.toString("base64")}`),
      "SECRET_DECRYPT_FAILED",
    );
    expectCode(
      () => box.decrypt("storage.accessKey", `v1:${keyId}:AAAA`),
      "SECRET_CIPHERTEXT_INVALID",
    );
    expectCode(() => box.decrypt("storage.accessKey", "plaintext"), "SECRET_CIPHERTEXT_INVALID");
    expectCode(() => box.decrypt("storage.accessKey", "v2:abcd:AAAA"), "SECRET_CIPHERTEXT_INVALID");
  });

  it("refuses to construct without usable key material", () => {
    expectCode(() => SecretBox.fromEnvironment({}), "CONFIG_ENCRYPTION_KEY_MISSING");
    expectCode(
      () => SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: "not-base64" }),
      "CONFIG_ENCRYPTION_KEY_INVALID",
    );
    expectCode(
      () =>
        SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: randomBytes(16).toString("base64") }),
      "CONFIG_ENCRYPTION_KEY_INVALID",
    );
  });

  it("never echoes key material or plaintext in errors", () => {
    const raw = key();
    const box = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: raw });
    const encrypted = box.encrypt("mail.smtpPassword", "super-sensitive");
    const foreign = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key() });

    try {
      foreign.decrypt("mail.smtpPassword", encrypted.ciphertext);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("super-sensitive");
      expect(message).not.toContain(encrypted.ciphertext);
      expect(message).not.toContain(raw);
    }
  });
});
