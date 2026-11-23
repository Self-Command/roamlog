"use client";

import DiffMatchPatch from "diff-match-patch";
import { useMemo } from "react";

const dmp = new DiffMatchPatch.diff_match_patch();

export function ArtifactDiffView({
  oldContent,
  newContent,
}: {
  oldContent: string;
  newContent: string;
}) {
  const parts = useMemo(() => {
    const diffs = dmp.diff_main(oldContent, newContent);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
  }, [newContent, oldContent]);

  return (
    <div
      className="min-h-full whitespace-pre-wrap break-words px-4 py-6 font-[var(--font-body)] text-sm leading-7 text-body md:px-10 md:py-8"
      data-testid="artifact-diff-view"
    >
      {parts.map(([operation, text], index) => {
        if (operation === 0) {
          return <span key={index}>{text}</span>;
        }
        if (operation === 1) {
          return (
            <ins
              className="rounded-sm bg-accent-green/15 px-0.5 text-ink no-underline"
              key={index}
            >
              {text}
            </ins>
          );
        }
        return (
          <del
            className="rounded-sm bg-accent-red/10 px-0.5 text-muted opacity-80"
            key={index}
          >
            {text}
          </del>
        );
      })}
    </div>
  );
}
