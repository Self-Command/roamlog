"use client";

import {
  AI_REWRITE_INSTRUCTIONS,
  AI_REWRITE_MAX_INPUT_CHARS,
  type AiRewriteInstruction,
} from "@roamlog/contracts";
import type { Editor } from "@tiptap/react";
import { AlertCircle, Check, Loader2, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  hashSelection,
  rewriteBlockMessage,
  rewriteBlockReason,
  REWRITE_INSTRUCTION_LABELS,
} from "@/lib/ai/selection";
import {
  rewriteFailureMessage,
  rewriteSelection,
  selectionStillMatches,
} from "@/lib/ai/rewrite";
import { describeSegments, isUnchanged, previewSegments, type DiffSegment } from "@/lib/ai/rewrite-preview";

/**
 * Copies the selection into a rewrite preview anchored to the text.
 *
 * Interaction model, ported from Novel's `ai-selector` +
 * `ai-completion-command` (github.com/steven-tey/novel,
 * `apps/web/components/tailwind/selectors/ai-selector.tsx` and
 * `.../selectors/generative/ai-completion-command.tsx`
 * @ fa95098e66476c466faebb8211baa5869c101a9c):
 *
 * - the entry is a toolbar button that stays in place and is disabled, with the
 *   reason in its label, instead of disappearing when nothing is selected;
 * - the instruction list is a small panel next to the selection, not a dialog;
 * - the result is shown as `删除`/`新增` segments and only the explicit accept
 *   writes into the document (`insertContentAt`), so an abandoned preview can
 *   never reach autosave.
 *
 * Two deliberate deviations from Novel:
 * - Novel writes into a separate preview editor surface; this product has no
 *   second editor, so the panel itself is the preview. In-place *text*
 *   decoration is not available: `@tiptap/pm` is not resolvable from `apps/web`
 *   (it is not a dependency and `apps/web/package.json` is outside this task),
 *   so no custom ProseMirror plugin can be registered.
 * - Novel formats the result as Markdown (bold, lists). Here the replacement is
 *   plain text inserted over the selection, matching the API contract, which
 *   returns plain `replacement` text.
 */

type Phase = "choosing" | "loading" | "preview" | "error";

interface PendingSelection {
  from: number;
  to: number;
  /** The exact string that was sent; the accept path re-checks it. */
  text: string;
  /** SHA-256 of `text`, as the server computed it. */
  hash: string;
}

interface Preview {
  instruction: AiRewriteInstruction;
  replacement: string;
  segments: DiffSegment[];
  model: string;
}

export interface JournalAiRewriteProps {
  editor: Editor;
  /** `null` while the entry is not attached to a workspace yet. */
  workspaceId: string | null;
  tripId?: string;
  readOnly?: boolean;
  /** Called after the replacement is written, so the sheet can save at once. */
  onApplied?: () => void;
}

const PANEL_WIDTH = 344;
const PANEL_MARGIN = 12;

/** Viewport position for the panel: just under the end of the selection. */
function panelPosition(editor: Editor, pos: number) {
  const fallback = { top: 0, left: PANEL_MARGIN };
  if (typeof window === "undefined") return fallback;
  try {
    const limit = editor.state.doc.content.size;
    const coords = editor.view.coordsAtPos(Math.max(1, Math.min(pos, limit)));
    const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN);
    return {
      top: coords.bottom + 8,
      left: Math.min(Math.max(coords.left, PANEL_MARGIN), maxLeft),
    };
  } catch {
    // Measuring has no fallback of its own (detached DOM, mid-transition); the
    // panel is still usable at the top-left corner instead of crashing the sheet.
    return fallback;
  }
}

export function JournalAiRewrite({
  editor,
  workspaceId,
  tripId,
  readOnly = false,
  onApplied,
}: JournalAiRewriteProps) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, bumpScrollTick] = useState(0);
  const [, refresh] = useState(0);

  // The control has to notice selection changes on its own: a transaction only
  // re-renders this component through its parent today, and the entry's enabled
  // state must never lag behind what the user has selected.
  useEffect(() => {
    const onTransaction = () => refresh((tick) => tick + 1);
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const selection = editor.state.selection;
  const selectedText = selection.empty
    ? ""
    : editor.state.doc.textBetween(selection.from, selection.to, "\n");
  const blockReason = rewriteBlockReason({ text: selectedText, readOnly, workspaceId });
  const blockMessage = rewriteBlockMessage(blockReason);

  const close = useCallback(() => {
    setPhase(null);
    setPending(null);
    setPreview(null);
    setErrorMessage(null);
  }, []);

  // Keep the panel glued to the text while the sheet scrolls under it.
  useEffect(() => {
    if (!phase) return;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => bumpScrollTick((tick) => tick + 1));
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [phase]);

  // Escape always leaves the preview without writing.
  useEffect(() => {
    if (!phase) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      editor.commands.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, editor, phase]);

  const run = useCallback(
    async (target: PendingSelection, instruction: AiRewriteInstruction) => {
      if (!workspaceId) return;
      setPhase("loading");
      setErrorMessage(null);
      try {
        const response = await rewriteSelection(workspaceId, {
          text: target.text,
          instruction,
          selectionHash: target.hash,
          tripId,
        });
        setPreview({
          instruction,
          replacement: response.replacement,
          segments: previewSegments(target.text, response.replacement),
          model: response.model,
        });
        setPhase("preview");
      } catch (cause) {
        setErrorMessage(rewriteFailureMessage(cause));
        setPhase("error");
      }
    },
    [tripId, workspaceId],
  );

  const start = useCallback(async () => {
    if (blockReason !== null) return;
    const from = selection.from;
    const to = selection.to;
    const text = editor.state.doc.textBetween(from, to, "\n");
    try {
      const hash = await hashSelection(text);
      setPending({ from, to, text, hash });
      setPreview(null);
      setErrorMessage(null);
      setPhase("choosing");
    } catch {
      setPending(null);
      setErrorMessage("当前浏览器无法校验原文，暂时不能使用 AI 改写。");
      setPhase("error");
    }
  }, [blockReason, editor, selection.from, selection.to]);

  const accept = useCallback(async () => {
    if (!pending || !preview) return;
    const limit = editor.state.doc.content.size;
    const current = editor.state.doc.textBetween(
      Math.min(pending.from, limit),
      Math.min(pending.to, limit),
      "\n",
    );
    let unchanged: boolean;
    try {
      unchanged = await selectionStillMatches(pending.hash, current);
    } catch {
      unchanged = false;
    }
    if (!unchanged) {
      setErrorMessage("原文已变化，请重试");
      setPhase("error");
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pending.from, to: pending.to }, preview.replacement, {
        updateSelection: true,
      })
      .run();
    close();
    onApplied?.();
  }, [close, editor, onApplied, pending, preview]);

  const open = phase !== null;
  const position = pending ? panelPosition(editor, pending.to) : null;

  // The panel is only meaningful while the range it was built from still reads
  // the same; drift is surfaced immediately, not just at accept time.
  const liveText =
    pending === null
      ? ""
      : editor.state.doc.textBetween(
          Math.min(pending.from, editor.state.doc.content.size),
          Math.min(pending.to, editor.state.doc.content.size),
          "\n",
        );
  const drifted = pending !== null && liveText !== pending.text;
  const unchangedResult =
    preview !== null && isUnchanged(pending?.text ?? "", preview.replacement);

  return (
    <>
      <button
        type="button"
        aria-label={blockReason ? `AI 改写，不可用：${blockMessage}` : "AI 改写选中文字"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={blockMessage ?? "AI 改写选中文字"}
        disabled={blockReason !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          void start();
        }}
        className="flex h-9 items-center gap-1.5 rounded-[5px] border border-transparent px-2 text-muted outline-none transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none disabled:opacity-35 aria-expanded:border-hairline-strong aria-expanded:bg-surface-2 aria-expanded:text-ink"
      >
        <Sparkles aria-hidden="true" className="size-4" />
        <span className="text-[11px] tracking-wide">AI 改写</span>
      </button>

      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="false"
              aria-label="AI 改写"
              onMouseDown={(event) => event.preventDefault()}
              style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
              className="fixed z-50 overflow-hidden rounded-control border border-hairline-strong bg-surface-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)] motion-safe:transition-opacity"
            >
              <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink">
                  <Sparkles aria-hidden="true" className="size-3.5" />
                  AI 改写
                  {preview ? (
                    <span className="font-normal text-muted">
                      · {REWRITE_INSTRUCTION_LABELS[preview.instruction]}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-stone">
                  {pending ? `${pending.text.length}/${AI_REWRITE_MAX_INPUT_CHARS}` : null}
                  <button
                    type="button"
                    aria-label="关闭预览"
                    onClick={() => {
                      close();
                      editor.commands.focus();
                    }}
                    className="rounded-[3px] p-0.5 text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </span>
              </div>

              {phase === "choosing" ? (
                <div className="space-y-2 px-3 py-2.5">
                  <p className="text-[10px] leading-4 text-muted">
                    选一种改法，结果会先在这里预览，不会直接写入正文。
                  </p>
                  <div role="group" aria-label="选择改写方式" className="grid grid-cols-2 gap-1.5">
                    {AI_REWRITE_INSTRUCTIONS.map((instruction) => (
                      <button
                        key={instruction}
                        type="button"
                        onClick={() => {
                          if (pending) void run(pending, instruction);
                        }}
                        className="rounded-[5px] border border-hairline px-2 py-1.5 text-left text-[11px] text-body outline-none transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        {REWRITE_INSTRUCTION_LABELS[instruction]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {phase === "loading" ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 px-3 py-4 text-xs text-muted"
                >
                  <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                  正在改写…
                </div>
              ) : null}

              {phase === "preview" && preview ? (
                <div className="space-y-2 px-3 py-2.5">
                  {drifted ? (
                    <p role="alert" className="text-[11px] text-accent-red">
                      原文已变化，请重试
                    </p>
                  ) : null}
                  <div className="max-h-56 overflow-y-auto rounded-[5px] border border-hairline bg-black/30 px-2.5 py-2 text-[12px] leading-6">
                    <p aria-hidden="true" className="text-body">
                      {preview.segments.map((segment, index) =>
                        segment.kind === "delete" ? (
                          <del
                            key={index}
                            className="mr-0.5 text-accent-red/80 decoration-accent-red/60"
                          >
                            {segment.text}
                          </del>
                        ) : segment.kind === "insert" ? (
                          <ins
                            key={index}
                            className="ml-0.5 text-accent-green/90 no-underline [background:color-mix(in_oklab,var(--color-accent-green)_16%,transparent)]"
                          >
                            {segment.text}
                          </ins>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )}
                    </p>
                    <p className="sr-only">{describeSegments(preview.segments)}</p>
                  </div>
                  {unchangedResult ? (
                    <p className="text-[11px] text-muted">改写结果与原文一致，可以不采纳。</p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10px] text-stone">{preview.model}</span>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          editor.commands.focus();
                        }}
                        className="rounded-[5px] border border-hairline px-2.5 py-1 text-[11px] text-muted outline-none transition-colors hover:border-hairline-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        disabled={drifted}
                        onClick={() => void accept()}
                        className="flex items-center gap-1 rounded-[5px] bg-ink px-2.5 py-1 text-[11px] font-medium text-canvas outline-none transition-colors hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Check aria-hidden="true" className="size-3.5" />
                        接受
                      </button>
                    </span>
                  </div>
                </div>
              ) : null}

              {phase === "error" ? (
                <div className="space-y-2 px-3 py-2.5">
                  <p role="alert" className="flex items-start gap-1.5 text-[11px] text-accent-red">
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    {errorMessage}
                  </p>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        editor.commands.focus();
                      }}
                      className="flex items-center gap-1 rounded-[5px] border border-hairline px-2.5 py-1 text-[11px] text-muted outline-none transition-colors hover:border-hairline-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                      关闭
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!pending) {
                          void start();
                          return;
                        }
                        // Re-hash first: a retry must start from the current text.
                        void (async () => {
                          try {
                            const hash = await hashSelection(liveText);
                            const next = { ...pending, text: liveText, hash };
                            setPending(next);
                            setPhase("choosing");
                          } catch {
                            setErrorMessage("当前浏览器无法校验原文，暂时不能使用 AI 改写。");
                          }
                        })();
                      }}
                      className="rounded-[5px] border border-hairline-strong px-2.5 py-1 text-[11px] text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      重试
                    </button>
                  </div>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
