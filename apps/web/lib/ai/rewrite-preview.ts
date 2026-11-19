import { DIFF_DELETE, DIFF_INSERT, diff } from "./diff";

/**
 * Turns the vendored diff into the segments the preview renders.
 *
 * The preview is decoration only: it never touches the document, and accepting
 * replaces the whole selection with `replacement` in one `insertContentAt`. That
 * is why the segments are computed from two plain strings instead of mapping
 * ProseMirror positions — a position-mapped highlight would have to survive
 * concurrent edits to the surrounding paragraphs, and a stale highlight that
 * still looks right is worse than a preview that is simply text.
 */

export type DiffSegmentKind = "equal" | "delete" | "insert";

export interface DiffSegment {
  kind: DiffSegmentKind;
  text: string;
}

const KIND_BY_OPERATION: Readonly<Record<number, DiffSegmentKind>> = {
  [DIFF_DELETE]: "delete",
  [DIFF_INSERT]: "insert",
  [0]: "equal",
};

/** Splits a diff into renderable segments, merging adjacent same-kind text. */
export function toDiffSegments(tuples: readonly (readonly [number, string])[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (const [operation, text] of tuples) {
    if (!text) continue;
    const kind = KIND_BY_OPERATION[operation] ?? "equal";
    const previous = segments[segments.length - 1];
    if (previous && previous.kind === kind) {
      previous.text += text;
    } else {
      segments.push({ kind, text });
    }
  }
  return segments;
}

/** Diff of the original selection against the rewrite. */
export function previewSegments(original: string, replacement: string): DiffSegment[] {
  if (original === replacement) {
    return replacement ? [{ kind: "equal", text: replacement }] : [];
  }
  return toDiffSegments(diff(original, replacement));
}

/** True when the replacement is byte-identical, so the UI can say "没有变化". */
export function isUnchanged(original: string, replacement: string): boolean {
  return original === replacement;
}

/** Plain-text summary for screen readers, which cannot see the highlight. */
export function describeSegments(segments: readonly DiffSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== "equal")
    .map((segment) => (segment.kind === "delete" ? `删除「${segment.text}」` : `新增「${segment.text}」`))
    .join("；");
}
