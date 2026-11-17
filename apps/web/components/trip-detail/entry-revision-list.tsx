"use client";

import type { EntryRevision } from "@roamlog/contracts";
import { Button } from "@roamlog/ui";
import { History, RotateCcw } from "lucide-react";

interface EntryRevisionListProps {
  revisions: EntryRevision[];
  onRestore: (revision: EntryRevision) => void;
  restoringId?: string | null;
  disabled?: boolean;
  loading?: boolean;
}

function revisionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function EntryRevisionList({
  revisions,
  onRestore,
  restoringId = null,
  disabled = false,
  loading = false,
}: EntryRevisionListProps) {
  return (
    <section aria-labelledby="entry-revisions-title" className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="type-eyebrow">REVISIONS</p>
          <h3 id="entry-revisions-title" className="mt-1 font-serif text-xl text-ink">
            版本历史
          </h3>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
          {loading ? "LOADING" : `${String(revisions.length).padStart(2, "0")} SNAPSHOTS`}
        </span>
      </div>

      {loading ? (
        <p className="rounded-card border border-hairline bg-surface-1 px-3 py-4 text-xs text-muted">
          正在读取版本…
        </p>
      ) : revisions.length === 0 ? (
        <p className="flex items-center gap-2 rounded-card border border-dashed border-hairline-strong px-3 py-4 text-xs text-muted">
          <History aria-hidden="true" className="size-3.5 text-stone" />
          还没有历史版本。第一次保存后会在这里留下快照。
        </p>
      ) : (
        <ol className="space-y-1.5">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex items-center gap-3 rounded-control border border-hairline bg-surface-1 px-3 py-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 font-mono text-[9px] text-ink">
                v{revision.version}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-body">{revision.title}</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-stone">
                  {revisionTime(revision.createdAt)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || restoringId === revision.id}
                onClick={() => onRestore(revision)}
                aria-label={`恢复版本 ${revision.version}`}
              >
                <RotateCcw aria-hidden="true" />
                {restoringId === revision.id ? "恢复中…" : "恢复"}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
