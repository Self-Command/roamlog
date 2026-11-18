/**
 * Shared helpers for the workspace top bar.
 *
 * The top bar may only render data that really exists. These helpers describe
 * the small visual vocabulary the avatars use, and keep CJK names to a single
 * glyph so two adjacent avatars can never read as one word ("同行编辑").
 */

const CJK_CHAR =
  /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * One glyph for CJK names, initials for latin names.
 * English names take the first letter of the first and last word; a single
 * latin word takes one letter, so the avatar never truncates mid-glyph.
 */
export function initialsFor(name: string): string {
  const trimmed = name.trim();
  const first = Array.from(trimmed)[0];

  if (!first) {
    return "?";
  }

  if (CJK_CHAR.test(first)) {
    return first;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return first.toUpperCase();
  }

  const last = words.at(-1) ?? first;
  return `${Array.from(first)[0] ?? ""}${Array.from(last)[0] ?? ""}`.toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑",
  viewer: "访客",
};

export function roleLabelFor(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
