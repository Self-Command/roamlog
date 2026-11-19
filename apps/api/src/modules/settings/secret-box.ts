import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope used for every `secret` setting.
 *
 * Ciphertext format: `v1:<keyId>:<base64(iv|ct|tag)>`
 * - `keyId` is derived from the key bytes, so it is stable across restarts and
 *   independent of the order keys appear in configuration.
 * - The setting key is the AAD. A ciphertext copied onto another setting row
 *   fails authentication instead of decrypting there.
 *
 * Decryption failures throw `SecretBoxError`. Returning an empty string would
 * make an unreadable SMTP password indistinguishable from "not configured",
 * which is exactly the silent-config-loss behaviour this task forbids.
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
  /** 1-based position in the configured ring; informational `SystemSetting.keyVersion`. */
  readonly version: number;
}

export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly keyId: string;
  readonly keyVersion: number;
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
  const sources =
    list && list.length > 0 ? list : [environment.CONFIG_ENCRYPTION_KEY?.trim() ?? ""];

  if (sources.length === 0 || sources.every((source) => !source)) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_MISSING",
      "CONFIG_ENCRYPTION_KEY (or CONFIG_ENCRYPTION_KEYS) must be set before storing secrets.",
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

  // A single CONFIG_ENCRYPTION_KEY is a valid standalone current key. When both
  // variables are set, the KEYS list is authoritative and the singular key is
  // kept as a decrypt-only fallback so a half-finished rotation still reads.
  const singular = environment.CONFIG_ENCRYPTION_KEY?.trim();
  if (list && list.length > 0 && singular) {
    const fallback = parseKey(singular, "CONFIG_ENCRYPTION_KEY");
    const id = keyIdFor(fallback);
    if (!seen.has(id)) {
      seen.add(id);
      ring.push({ id, key: fallback, version: ring.length + 1 });
    }
  }

  if (ring.length === 0 || !ring[0]) {
    throw new SecretBoxError(
      "CONFIG_ENCRYPTION_KEY_MISSING",
      "No usable encryption key was configured.",
    );
  }
  return ring;
}

export class SecretBox {
  private readonly current: KeyMaterial;
  private readonly byId: ReadonlyMap<string, KeyMaterial>;

  constructor(ring: readonly KeyMaterial[]) {
    const [current] = ring;
    if (!current) {
      throw new SecretBoxError(
        "CONFIG_ENCRYPTION_KEY_MISSING",
        "SecretBox requires at least one encryption key.",
      );
    }
    this.current = current;
    this.byId = new Map(ring.map((entry) => [entry.id, entry]));
  }

  static fromEnvironment(environment: SecretBoxEnvironment): SecretBox {
    return new SecretBox(parseKeyRing(environment));
  }

  get keyId(): string {
    return this.current.id;
  }

  get keyVersion(): number {
    return this.current.version;
  }

  encrypt(settingKey: string, plaintext: string): EncryptedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.current.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(settingKey, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, ciphertext, tag]).toString("base64");

    return {
      ciphertext: `${VERSION}:${this.current.id}:${payload}`,
      keyId: this.current.id,
      keyVersion: this.current.version,
    };
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
