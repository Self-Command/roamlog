/**
 * Types for the vendored `diff.js` (see the provenance header inside it).
 *
 * The implementation is plain JavaScript so that the port stays byte-for-byte
 * comparable with upstream fast-diff@1.3.0, and `apps/web` compiles with
 * `allowJs: false`, so this declaration file is the only surface `tsc` sees.
 */

/** Means "this text is only in the old string". */
export declare const DIFF_DELETE: -1;
/** Means "this text is identical in both strings". */
export declare const DIFF_EQUAL: 0;
/** Means "this text is only in the new string". */
export declare const DIFF_INSERT: 1;

export type DiffOperation = -1 | 0 | 1;

export type DiffTuple = [DiffOperation, string];

export interface DiffCursorRange {
  index: number;
  length: number;
}

export interface DiffCursor {
  oldRange: DiffCursorRange;
  newRange?: DiffCursorRange | null;
}

/**
 * Diff two strings.
 *
 * @param text1 Old string to be diffed.
 * @param text2 New string to be diffed.
 * @param cursorPos Optional caret position in `text1`, or a pair of ranges. The
 *   rewrite preview never passes one; it is part of the vendored surface.
 * @param cleanup Apply semantic cleanup before returning (the preview relies on
 *   it: without it the tuples are character-level noise).
 * @returns Non-empty diff tuples, e.g.
 *   `[[DIFF_DELETE, "Hello"], [DIFF_INSERT, "Goodbye"], [DIFF_EQUAL, " world."]]`.
 */
export declare function diff(
  text1: string,
  text2: string,
  cursorPos?: number | DiffCursor | null,
  cleanup?: boolean,
): DiffTuple[];
