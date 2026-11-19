import { AI_REWRITE_MAX_INPUT_CHARS, type AiRewriteInstruction } from "@roamlog/contracts";

/**
 * Selection identity for the AI rewrite flow.
 *
 * The server re-hashes the text it receives and refuses a mismatch, so the hash
 * is the wire-level proof of *which* selection a rewrite belongs to. The client
 * keeps the same hash next to the pending preview; when the user accepts, the
 * current selection is hashed again and compared. A mismatch means the paragraph
 * changed under the preview — the only safe answer is to discard the preview and
 * ask the user to select again, never to write the stale replacement.
 *
 * SHA-256 is the platform implementation (`crypto.subtle`), not a bundled
 * algorithm: the same digest is what `node:crypto` produces on the server.
 *
 * Spec: <https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest>
 */

export type SubtleLike = {
  digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
};

/** Copy text into a fresh ArrayBuffer-backed view, which `digest` accepts. */
function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

/**
 * Lowercase hex SHA-256 of `text`, byte-identical to the server's
 * `selectionHashOf` (`createHash("sha256").update(text, "utf8").digest("hex")`).
 *
 * @param text The exact selected string, untrimmed: trimming would make the
 *   hash disagree with what the editor actually replaces.
 * @param subtle Injectable for tests and for environments where `crypto.subtle`
 *   is not on the global object.
 */
export async function hashSelection(text: string, subtle?: SubtleLike): Promise<string> {
  const engine = subtle ?? (globalThis.crypto?.subtle as SubtleLike | undefined);
  if (typeof engine?.digest !== "function") {
    // A secure context (https or localhost) always has it; LAN-IP http previews
    // do not, and silently falling back to a weaker check would defeat the guard.
    throw new Error("Web Crypto is unavailable, so the selection cannot be hashed.");
  }

  const digest = await engine.digest("SHA-256", encodeUtf8(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Why the rewrite entry is disabled, or `null` when it is available. */
export type RewriteBlockReason = "empty" | "too_long" | "read_only" | "no_workspace";

/**
 * Single source of truth for whether "AI 改写" can run on the current selection.
 * The toolbar renders the reason instead of hiding the button, so a user who
 * selects nothing still learns the feature exists.
 */
export function rewriteBlockReason(input: {
  text: string;
  readOnly: boolean;
  workspaceId: string | null | undefined;
}): RewriteBlockReason | null {
  if (input.readOnly) return "read_only";
  if (!input.workspaceId) return "no_workspace";
  if (input.text.trim().length === 0) return "empty";
  if (input.text.length > AI_REWRITE_MAX_INPUT_CHARS) return "too_long";
  return null;
}

/** Chinese copy for the disabled state; `null` reason means "enabled". */
export function rewriteBlockMessage(reason: RewriteBlockReason | null): string | null {
  switch (reason) {
    case null:
      return null;
    case "empty":
      return "先选中一段文字，再让 AI 改写";
    case "too_long":
      return `选中文本超过 ${AI_REWRITE_MAX_INPUT_CHARS} 字，请分段改写`;
    case "read_only":
      return "你没有编辑权限，无法改写这段文字";
    case "no_workspace":
      return "仍在加载，请稍候";
  }
}

export const REWRITE_INSTRUCTION_LABELS: Readonly<Record<AiRewriteInstruction, string>> = {
  shorten: "更简短",
  expand: "更详细",
  polish: "润色",
  tone_formal: "更正式",
  tone_casual: "更口语",
  fix_grammar: "修正语法",
};
