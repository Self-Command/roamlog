import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SecretBox as ApiSecretBox } from "../../api/src/modules/settings/secret-box.js";
import { SecretBox as WorkerSecretBox, SecretBoxError } from "../src/secret-box.js";
import { createMailSettingsReader, type MailSettingRow } from "../src/settings-reader.js";

/**
 * The worker owns a read-only copy of the API's AES-256-GCM envelope. This file
 * is the contract test between the two implementations: ciphertext produced by
 * the real API code must decrypt in the worker, including key-ring rotation and
 * the setting-key AAD binding.
 */

const SETTING_KEY = "mail.smtpPassword";
const PLAINTEXT = "correct horse battery staple / smtp pass";

function freshKey(): string {
  return randomBytes(32).toString("base64");
}

function rowDatabase(rows: MailSettingRow[]): {
  systemSetting: { findMany(): Promise<MailSettingRow[]> };
} {
  return { systemSetting: { findMany: async () => rows } };
}

describe("worker secret box: cross-implementation consistency", () => {
  it("decrypts ciphertext produced by the API secret box", () => {
    const key = freshKey();
    const apiBox = ApiSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key });
    const encrypted = apiBox.encrypt(SETTING_KEY, PLAINTEXT);

    const workerBox = WorkerSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key });

    expect(workerBox.decrypt(SETTING_KEY, encrypted.ciphertext)).toBe(PLAINTEXT);
    expect(encrypted.ciphertext).toMatch(/^v1:[0-9a-f]{8}:/u);
  });

  it("decrypts an API-encrypted stored secret through the mail settings reader", async () => {
    const key = freshKey();
    const apiBox = ApiSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key });
    const encrypted = apiBox.encrypt(SETTING_KEY, PLAINTEXT);
    const rows: MailSettingRow[] = [
      { key: "mail.from", value: "Roamlog <db@roamlog.test>" },
      { key: "mail.smtpHost", value: "127.0.0.1" },
      { key: "mail.smtpPort", value: 1025 },
      { key: "mail.smtpUser", value: "relay-user" },
      { key: "mail.smtpPassword", secretCipher: encrypted.ciphertext },
    ];
    const reader = createMailSettingsReader({
      db: rowDatabase(rows),
      environment: {
        CONFIG_ENCRYPTION_KEY: key,
        // A different environment password must lose to the stored secret.
        SMTP_PASSWORD: "env-password",
      },
    });

    const runtime = await reader.resolve();

    expect(runtime).toMatchObject({
      configured: true,
      provider: "smtp",
      user: "relay-user",
      password: PLAINTEXT,
    });
    expect(JSON.stringify(runtime)).not.toContain("env-password");
  });

  it("rejects a ciphertext decrypted under the wrong setting key (AAD)", () => {
    const key = freshKey();
    const apiBox = ApiSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key });
    const encrypted = apiBox.encrypt(SETTING_KEY, PLAINTEXT);
    const workerBox = WorkerSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key });

    expect(() => workerBox.decrypt("mail.resendApiKey", encrypted.ciphertext)).toThrowError(
      expect.objectContaining({ code: "SECRET_DECRYPT_FAILED" }),
    );
  });

  it("follows the same key ring rotation rules as the API", () => {
    const oldKey = freshKey();
    const newKey = freshKey();
    const encrypted = ApiSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: oldKey }).encrypt(
      SETTING_KEY,
      PLAINTEXT,
    );

    const wrongRing = WorkerSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: newKey });
    expect(() => wrongRing.decrypt(SETTING_KEY, encrypted.ciphertext)).toThrowError(
      expect.objectContaining({ code: "SECRET_DECRYPT_FAILED" }),
    );

    const rotatingRing = WorkerSecretBox.fromEnvironment({
      CONFIG_ENCRYPTION_KEYS: `${newKey},${oldKey}`,
    });
    expect(rotatingRing.decrypt(SETTING_KEY, encrypted.ciphertext)).toBe(PLAINTEXT);
  });

  it("refuses malformed envelopes instead of returning an empty string", () => {
    const workerBox = WorkerSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: freshKey() });

    for (const ciphertext of ["", "v2:abcd:payload", "v1:only-two-parts", "v1:abcd:!!!"]) {
      const error = (() => {
        try {
          workerBox.decrypt(SETTING_KEY, ciphertext);
          return null;
        } catch (caught: unknown) {
          return caught;
        }
      })();

      expect(error).toBeInstanceOf(SecretBoxError);
      expect(["SECRET_CIPHERTEXT_INVALID", "SECRET_DECRYPT_FAILED"]).toContain(
        (error as SecretBoxError).code,
      );
    }
  });
});