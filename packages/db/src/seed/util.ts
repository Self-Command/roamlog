import { createHash } from "node:crypto";
import type { TiptapDoc, TiptapNode } from "./types.js";

const FIXTURE_CLOCK_START = Date.UTC(2026, 0, 1, 8, 0, 0);

export const DEMO_SHARE_TOKEN = "roamlog-demo-share-2026-kyoto";

export const demoShareTokenHash = createHash("sha256")
  .update(DEMO_SHARE_TOKEN)
  .digest("hex");

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Deterministic UUIDv7: 48 timestamp bits from a fixture clock plus hashed
 * randomness. Stable IDs make E2E links and idempotent upserts safe.
 */
export function deterministicId(namespace: string, key: string): string {
  const digest = createHash("sha256")
    .update(`roamlog:${namespace}:${key}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  const jitter = BigInt(digest.readUInt32BE(0)) % 86_400_000n;
  const timestamp = BigInt(FIXTURE_CLOCK_START) + jitter;

  for (let index = 0; index < 6; index += 1) {
    const shift = BigInt(8 * (5 - index));
    bytes[index] = Number((timestamp >> shift) & 0xffn);
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function timestamp(day: string, time = "09:00:00"): string {
  return `${day}T${time}.000Z`;
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function tiptapParagraphs(paragraphs: readonly string[]): TiptapDoc {
  const content: TiptapNode[] = paragraphs.map((paragraph) => ({
    type: "paragraph",
    content: [{ type: "text", text: paragraph }],
  }));
  return { type: "doc", content };
}

export function tiptapHtml(paragraphs: readonly string[]): string {
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

export interface EqualSplitShare {
  userId: string;
  shareAmountMinor: number;
}

export function equalSplit(
  amountMinor: number,
  participantIds: readonly string[],
  payerId: string,
): EqualSplitShare[] {
  if (participantIds.length === 0) {
    throw new Error("An expense must have at least one participant");
  }
  if (!participantIds.includes(payerId)) {
    throw new Error("The payer must be an expense participant");
  }

  const base = Math.floor(amountMinor / participantIds.length);
  let remainder = amountMinor - base * participantIds.length;

  return participantIds.map((userId) => {
    const extra = userId === payerId ? remainder : 0;
    remainder -= extra;
    return { userId, shareAmountMinor: base + extra };
  });
}

export function customSplit(
  amountMinor: number,
  weights: readonly { userId: string; weight: number }[],
): EqualSplitShare[] {
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("Custom split weights must be positive");
  }

  const shares = weights.map((entry, index) => {
    if (index === weights.length - 1) {
      const allocated = weights
        .slice(0, -1)
        .reduce(
          (sum, item) =>
            sum + Math.floor((amountMinor * item.weight) / totalWeight),
          0,
        );
      return {
        userId: entry.userId,
        shareAmountMinor: amountMinor - allocated,
      };
    }
    return {
      userId: entry.userId,
      shareAmountMinor: Math.floor((amountMinor * entry.weight) / totalWeight),
    };
  });

  const total = shares.reduce((sum, share) => sum + share.shareAmountMinor, 0);
  if (total !== amountMinor) {
    throw new Error("Custom split does not reconcile");
  }
  return shares;
}
