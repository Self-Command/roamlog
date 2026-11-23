"use client";

import {
  AlertTriangle,
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  FileCode2,
  GitCompare,
  ListChecks,
  Loader2,
  MessageSquareText,
  PenLine,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@roamlog/ui";

import type { AiArtifactKind } from "../../../lib/api/ai-artifacts";
import { ArtifactCodeWorkspace } from "./code-workspace";
import { ArtifactDiffView } from "./diff-view";
import { ArtifactImageEditor } from "./image-editor";
import { ArtifactSheetEditor } from "./sheet-editor";
import { ArtifactTextEditor } from "./text-editor";
import { useAiArtifact } from "./artifact-context";

const TOOLBAR_ACTIONS: Readonly<
  Record<
    AiArtifactKind,
    readonly { label: string; prompt: string; icon: typeof PenLine }[]
  >
> = {
  text: [
    {
      label: "最终润色",
      icon: PenLine,
      prompt:
        "请对当前旅行文档做最终润色：检查语法、补足小标题、理顺段落，并保持事实和信息不变。",
    },
    {
      label: "生成建议",
      icon: MessageSquareText,
      prompt: "请为当前旅行文档生成具体、可应用的改进建议。",
    },
  ],
  code: [
    {
      label: "添加注释",
      icon: FileCode2,
      prompt: "请给当前代码添加简洁的中文注释，帮助读者理解关键步骤。",
    },
    {
      label: "添加日志",
      icon: ListChecks,
      prompt: "请给当前代码添加必要的调试日志，不改变原有行为。",
    },
  ],
  sheet: [
    {
      label: "清洗数据",
      icon: Sparkles,
      prompt: "请格式化和清理当前表格数据，保留真实内容并统一格式。",
    },
    {
      label: "分析可视化",
      icon: ChartNoAxesCombined,
      prompt: "请分析当前表格数据，并创建一个 Python 代码文档来可视化。",
    },
  ],
  image: [],
};

function ArtifactToolbarActions() {
  const { artifact, currentContent, isCurrentVersion } = useAiArtifact();
  const aui = useAui();
  const running = useAuiState((state) => state.thread.isRunning);
  const [copied, setCopied] = useState(false);

  if (!artifact || !isCurrentVersion) return null;
  const actions = TOOLBAR_ACTIONS[artifact.kind];

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      {artifact.kind === "image" ? null : (
        <Button
          aria-label="复制文档内容"
          className="size-8 px-0"
          onClick={() => void copy()}
          size="sm"
          title={copied ? "已复制" : "复制内容"}
          type="button"
          variant="ghost"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4 text-accent-green" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
        </Button>
      )}
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            aria-label={action.label}
            className="size-8 px-0"
            disabled={running}
            key={action.label}
            onClick={() => {
              aui.composer().setText(action.prompt);
              void aui.composer().send();
            }}
            size="sm"
            title={action.label}
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" className="size-4" />
          </Button>
        );
      })}
    </>
  );
}

function ArtifactErrorBanner() {
  const { error, refresh, status } = useAiArtifact();
  if (status !== "error" || !error) return null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red md:px-4"
      data-testid="artifact-error"
      role="alert"
    >
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{error}</span>
      </span>
      <Button
        onClick={() => {
          void refresh().catch(() => undefined);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        重新加载
      </Button>
    </div>
  );
}

function ArtifactHeader() {
  const {
    artifact,
    closeArtifact,
    error,
    mode,
    setMode,
    status,
    versionIndex,
    versions,
    isCurrentVersion,
  } = useAiArtifact();

  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline px-3 py-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          aria-label="关闭 Artifact"
          className="size-8 shrink-0 px-0"
          onClick={closeArtifact}
          size="sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {artifact?.title ?? "正在载入 Artifact"}
          </p>
          <p className="truncate type-meta text-stone">
            {status === "loading"
              ? "正在载入…"
              : status === "saving"
                ? "正在保存…"
                : status === "error"
                  ? error ?? "保存失败"
                  : `${artifact?.kind ?? "document"} · v${String(versionIndex + 1)}/${String(
                      Math.max(versions.length, 1),
                    )}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ArtifactToolbarActions />
        {artifact?.kind !== "image" ? (
          <Button
            aria-label={mode === "diff" ? "返回编辑" : "查看改动"}
            className="size-8 px-0"
            disabled={versionIndex === 0 && mode === "edit"}
            onClick={() => setMode(mode === "diff" ? "edit" : "diff")}
            size="sm"
            title={mode === "diff" ? "返回编辑" : "查看改动"}
            type="button"
            variant="ghost"
          >
            {mode === "diff" ? (
              <Columns2 aria-hidden="true" className="size-4" />
            ) : (
              <GitCompare aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}
        {status === "loading" || status === "saving" ? (
          <Loader2 aria-label="处理中" className="size-4 animate-spin text-muted" />
        ) : null}
        {!isCurrentVersion ? (
          <Button
            onClick={() => setMode("edit")}
            size="sm"
            type="button"
            variant="outline"
          >
            最新
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function ArtifactContent() {
  const {
    applySuggestion,
    artifact,
    currentContent,
    isCurrentVersion,
    mode,
    resolveSuggestion,
    saveContent,
    suggestions,
    versionIndex,
    versions,
  } = useAiArtifact();

  if (!artifact) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted" role="status">
        正在载入 Artifact…
      </div>
    );
  }

  if (mode === "diff") {
    const previous = versionIndex > 0 ? versions[versionIndex - 1]?.content ?? "" : currentContent;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ArtifactDiffView newContent={currentContent} oldContent={previous} />
      </div>
    );
  }

  const editable = isCurrentVersion && artifact.kind !== "image";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-slot="artifact-content">
      {artifact.kind === "text" ? (
        <ArtifactTextEditor
          content={currentContent}
          editable={editable}
          onApplySuggestion={(suggestion) => void applySuggestion(suggestion)}
          onResolveSuggestion={(suggestionId, resolved) =>
            void resolveSuggestion(suggestionId, resolved)
          }
          onSave={(content, debounce) => void saveContent(content, debounce)}
          suggestions={isCurrentVersion ? suggestions : []}
        />
      ) : artifact.kind === "code" ? (
        <ArtifactCodeWorkspace
          key={artifact.id}
          content={currentContent}
          editable={editable}
          onSave={(content, debounce) => void saveContent(content, debounce)}
        />
      ) : artifact.kind === "sheet" ? (
        <ArtifactSheetEditor
          content={currentContent}
          editable={editable}
          onSave={(content, debounce) => void saveContent(content, debounce)}
        />
      ) : (
        <ArtifactImageEditor
          content={currentContent}
          mediaId={artifact.mediaId}
          title={artifact.title}
        />
      )}
    </div>
  );
}

function ArtifactFooter() {
  const {
    artifact,
    isCurrentVersion,
    restoreVersion,
    setMode,
    setVersionIndex,
    versionIndex,
    versions,
  } = useAiArtifact();

  if (!artifact || artifact.kind === "image") return null;
  const isFirst = versionIndex === 0;
  const isLast = versionIndex >= versions.length - 1;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2">
      <div className="flex items-center gap-1">
        <Button
          aria-label="上一版"
          className="size-7 px-0"
          disabled={isFirst}
          onClick={() => setVersionIndex(versionIndex - 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <span className="min-w-16 text-center font-mono text-[10px] text-muted">
          {versions.length > 0 ? `${String(versionIndex + 1)} / ${String(versions.length)}` : "—"}
        </span>
        <Button
          aria-label="下一版"
          className="size-7 px-0"
          disabled={isLast}
          onClick={() => setVersionIndex(versionIndex + 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {!isCurrentVersion ? (
          <>
            <Button
              onClick={() =>
                void restoreVersion(
                  versions[versionIndex]?.version ?? artifact.version,
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              恢复
            </Button>
            <Button
              onClick={() => {
                setVersionIndex(Math.max(0, versions.length - 1));
                setMode("edit");
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              最新
            </Button>
          </>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
            自动保存
          </span>
        )}
      </div>
    </footer>
  );
}

export function ArtifactPanel() {
  const { visible } = useAiArtifact();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setPortalTarget(query.matches ? document.body : null);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!visible) return null;

  const panel = (
    <aside
      aria-label="Artifact 面板"
      className={
        portalTarget
          ? "fixed inset-0 z-[100] flex h-dvh w-dvw flex-col overflow-hidden border-hairline-strong bg-surface-1"
          : "flex h-full w-[min(46%,720px)] min-w-[380px] shrink-0 flex-col overflow-hidden border-l border-hairline-strong bg-surface-1"
      }
      data-testid="artifact"
    >
      <ArtifactHeader />
      <ArtifactErrorBanner />
      <ArtifactContent />
      <ArtifactFooter />
    </aside>
  );

  return portalTarget ? createPortal(panel, portalTarget) : panel;
}
