"use client";

import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  GitCompare,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";

import { Button } from "@roamlog/ui";

import { ArtifactCodeEditor } from "./code-editor";
import { ArtifactDiffView } from "./diff-view";
import { ArtifactImageEditor } from "./image-editor";
import { ArtifactSheetEditor } from "./sheet-editor";
import { ArtifactTextEditor } from "./text-editor";
import { useAiArtifact } from "./artifact-context";

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
        <ArtifactCodeEditor
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
  if (!visible) return null;

  return (
    <aside
      aria-label="Artifact 面板"
      className="fixed inset-0 z-50 flex h-dvh w-dvw flex-col overflow-hidden border-hairline-strong bg-surface-0 md:static md:z-auto md:h-full md:w-[min(58%,780px)] md:min-w-[420px] md:border-l"
      data-testid="artifact"
    >
      <ArtifactHeader />
      <ArtifactContent />
      <ArtifactFooter />
    </aside>
  );
}
