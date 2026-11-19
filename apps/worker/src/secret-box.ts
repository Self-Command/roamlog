import { createDecipheriv, createHash } from "node:crypto";

/**
 * Read-only copy of the API's secret envelope.
 *
 * This is deliberately a SECOND implementation. The worker is an independent
 * process and must not import `apps/api`, and the API's `secret-box.ts` is not
 * in a shared package. The ciphertext contract is frozen:
 *
 *   v1:<keyId>:<base64(iv|ct|tag)>   AES-256-GCM, AAD = the setting key
 *
 * `apps/worker/test/secret-box.consistency.spec.ts` encrypts with the real API
 * implementation and decrypts here, so the two cannot drift silently. Any
 * change to the API format or key-ring rules must land in both files and keep
 * that test green.
 *
 * Decryption failures throw `SecretBoxError`; returning an empty string would
 * make an unreadable SMTP password indistinguishable from "not configured".
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_CIPHERTEXT_CHARS = 16_384;

export type SecretBoxErrorCode =
  | "CONFIG_ENCRYPTION_KEY_MISSING"
  | "CONFIG_ENCRYPTION_KEY_INVALID"
  | "SECRET_CIPHERTEXT_INVALID"
  | "SECRET_DECRYPT_FAILED";

export class SecretBoxError extends Error {
  constructor(
    readonly code: SecretBoxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export interface SecretBoxEnvironment {
  CONFIG_ENCRYPTION_KEY?: string;
  CONFIG_ENCRYPTION_KEYS?: string;
}

interface KeyMaterial {
  readonly id: string;
  readonly key: Buffer;
  readonly version: number;
}

export function keyIdFor(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function parseKey(raw: string, source: string): Buffer {
  const value = raw.trim();
  if (!value) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_INVALID",
      `${source} contains an empty encryption key.`,
    );
  }

  const decoded = Buffer.from(value, "base64");
  // Buffer.from(..., "base64") silently skips invalid characters, so round-trip
  // the canonical form before trusting the length check.
  if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== value) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_INVALID",
      `${source} must be a base64-encoded 32-byte key.`,
    );
  }
  return decoded;
}

function parseKeyRing(environment: SecretBoxEnvironment): KeyMaterial[] {
  const list = environment.CONFIG_ENCRYPTION_KEYS?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const sources = list && list.length > 0 ? list : [environment.CONFIG_ENCRYPTION_KEY?.trim() ?? ""];

  if (sources.length === 0 || sources.every((source) => !source)) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_MISSING",
      "CONFIG_ENCRYPTION_KEY (or CONFIG_ENCRYPTION_KEYS) must be set before reading secrets.",
    );
  }

  const ring: KeyMaterial[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = parseKey(source, "CONFIG_ENCRYPTION_KEYS");
    const id = keyIdFor(key);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ring.push({ id, key, version: ring.length + 1 });
  }

  // Mirror the API: when both variables are set, the KEYS list is authoritative
  // and the singular key is kept as a decrypt-only fallback for rotation.
  const singular = environment.CONFIG_ENCRYPTION_KEY?.trim();
  if (list && list.length > 0 && singular) {
    const fallback = parseKey(singular, "CONFIG_ENCRYPTION_KEY");
    const id = keyIdFor(fallback);
    if (!seen.has(id)) {
      seen.add(id);
      ring.push({ id, key: fallback, version: ring.length + 1 });
    }
  }

  if (ring.length === 0) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_MISSING",
      "No usable encryption key was configured.",
    );
  }
  return ring;
}

export class SecretBox {
  private readonly byId: ReadonlyMap<string, KeyMaterial>;

  constructor(ring: readonly KeyMaterial[]) {
    if (ring.length === 0) {
      throw new SecretBoxError(
        "CONFIG_ENCRYPTION_KEY_MISSING",
        "SecretBox requires at least one encryption key.",
      );
    }
    this.byId = new Map(ring.map((entry) => [entry.id, entry]));
  }

  static fromEnvironment(environment: SecretBoxEnvironment): SecretBox {
    return new SecretBox(parseKeyRing(environment));
  }

  decrypt(settingKey: string, ciphertext: string): string {
    const [version, keyId, payload, ...rest] = ciphertext.split(":");
    if (
      version !== VERSION ||
      !keyId ||
      !payload ||
      rest.length > 0 ||
      ciphertext.length > MAX_CIPHERTEXT_CHARS
    ) {
      throw new SecretBoxError(
        "SECRET_CIPHERTEXT_INVALID",
        "The stored secret is not a valid v1 ciphertext envelope.",
      );
    }

    const key = this.byId.get(keyId);
    if (!key) {
      throw new SecretBoxError(
        "SECRET_DECRYPT_FAILED",
        "The configured encryption key ring does not contain the key that encrypted this secret.",
      );
    }

    const raw = Buffer.from(payload, "base64");
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new SecretBoxError(
        "SECRET_CIPHERTEXT_INVALID",
        "The stored secret ciphertext is truncated.",
      );
    }

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, key.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(settingKey, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretBoxError(
        "SECRET_DECRYPT_FAILED",
        "The stored secret could not be decrypted with the configured key ring.",
      );
    }
  }
}