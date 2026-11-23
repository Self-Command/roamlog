"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  getAiArtifact,
  listAiArtifactSuggestions,
  listAiArtifactVersions,
  restoreAiArtifactVersion,
  setAiArtifactSuggestionResolved,
  updateAiArtifact,
  type AiArtifact,
  type AiArtifactKind,
  type AiArtifactSuggestion,
  type AiArtifactVersion,
} from "../../../lib/api/ai-artifacts";

export type ArtifactMode = "edit" | "diff";
export type ArtifactStatus = "idle" | "loading" | "saving" | "error";

export interface ArtifactReference {
  readonly id: string;
  readonly title?: string;
  readonly kind?: AiArtifactKind;
}

interface ArtifactContextValue {
  artifact: AiArtifact | null;
  versions: readonly AiArtifactVersion[];
  suggestions: readonly AiArtifactSuggestion[];
  visible: boolean;
  mode: ArtifactMode;
  versionIndex: number;
  status: ArtifactStatus;
  error: string | null;
  currentContent: string;
  isCurrentVersion: boolean;
  openArtifact: (reference: ArtifactReference | string) => Promise<void>;
  closeArtifact: () => void;
  setMode: (mode: ArtifactMode) => void;
  setVersionIndex: (index: number) => void;
  /** Resolves true when this content is on the server (or nothing was pending). */
  saveContent: (content: string, debounce?: boolean) => Promise<boolean>;
  restoreVersion: (version: number) => Promise<void>;
  applySuggestion: (suggestion: AiArtifactSuggestion) => Promise<void>;
  resolveSuggestion: (suggestionId: string, resolved: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Artifact 请求失败，请重试。";
}

export function AiArtifactProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [artifact, setArtifact] = useState<AiArtifact | null>(null);
  const [versions, setVersions] = useState<readonly AiArtifactVersion[]>([]);
  const [suggestions, setSuggestions] = useState<readonly AiArtifactSuggestion[]>([]);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ArtifactMode>("edit");
  const [versionIndex, setVersionIndex] = useState(0);
  const [status, setStatus] = useState<ArtifactStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const saveChain = useRef<Promise<boolean> | null>(null);
  const artifactRef = useRef<AiArtifact | null>(null);
  artifactRef.current = artifact;

  const currentContent =
    pendingDraft ?? versions[versionIndex]?.content ?? artifact?.content ?? "";
  const isCurrentVersion = !artifact || versionIndex === versions.length - 1;

  const loadDetails = useCallback(
    async (artifactId: string): Promise<void> => {
      setStatus("loading");
      setError(null);
      if (artifactRef.current && artifactRef.current.id !== artifactId) {
        setArtifact(null);
        setVersions([]);
        setSuggestions([]);
        setPendingDraft(null);
        pendingContent.current = null;
      }
      try {
        const [nextArtifact, nextVersions, nextSuggestions] = await Promise.all([
          getAiArtifact(workspaceId, artifactId),
          listAiArtifactVersions(workspaceId, artifactId),
          listAiArtifactSuggestions(workspaceId, artifactId),
        ]);
        setArtifact(nextArtifact);
        setVersions(nextVersions);
        setSuggestions(nextSuggestions);
        setPendingDraft(null);
        setVersionIndex(Math.max(0, nextVersions.length - 1));
        setStatus("idle");
      } catch (cause) {
        setStatus("error");
        setError(messageOf(cause));
        throw cause;
      }
    },
    [workspaceId],
  );

  const openArtifact = useCallback(
    async (reference: ArtifactReference | string): Promise<void> => {
      const id = typeof reference === "string" ? reference : reference.id;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      await flushSaveRef.current();
      setVisible(true);
      setMode("edit");
      await loadDetails(id);
    },
    [loadDetails],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!artifactRef.current) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // A retry after a save conflict adopts the server version. Keeping the
    // rejected client draft would retry the same stale optimistic version.
    pendingContent.current = null;
    setPendingDraft(null);
    await loadDetails(artifactRef.current.id);
  }, [loadDetails]);

  const closeArtifact = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingContent.current !== null) void flushSaveRef.current();
    setVisible(false);
  }, []);

  const commitPending = useCallback(async (): Promise<boolean> => {
    const latest = artifactRef.current;
    const nextContent = pendingContent.current;
    if (!latest || nextContent === null) return true;

    // Clear before the request so edits made while it is in flight become the
    // next item on the chain instead of being dropped when the first response
    // returns.
    pendingContent.current = null;
    setStatus("saving");
    setError(null);
    try {
      const updated = await updateAiArtifact(workspaceId, latest.id, {
        content: nextContent,
        version: latest.version,
      });
      artifactRef.current = updated;
      setArtifact(updated);
      setStatus("idle");
      if (pendingContent.current === null) setPendingDraft(null);
      try {
        const nextVersions = await listAiArtifactVersions(workspaceId, updated.id);
        setVersions(nextVersions);
        setVersionIndex(Math.max(0, nextVersions.length - 1));
      } catch {
        setStatus("error");
        setError("文档已保存，但版本列表加载失败，请重新加载。");
      }
      return true;
    } catch (cause) {
      // Preserve the draft for a retry, but never overwrite a newer edit that
      // arrived while this request was in flight.
      if (pendingContent.current === null) pendingContent.current = nextContent;
      setStatus("error");
      setError(messageOf(cause));
      return false;
    }
  }, [workspaceId]);

  const flushSave = useCallback((): Promise<boolean> => {
    const previous = saveChain.current ?? Promise.resolve(true);
    const next = previous.then(async () => {
      let ok = true;
      while (pendingContent.current !== null) {
        ok = await commitPending();
        if (!ok) break;
      }
      return ok;
    });
    saveChain.current = next;
    void next.then(() => {
      if (saveChain.current === next) saveChain.current = null;
    });
    return next;
  }, [commitPending]);

  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  const saveContent = useCallback(
    async (content: string, debounce = true): Promise<boolean> => {
      const current = artifactRef.current;
      if (!current || !isCurrentVersion) return false;

      pendingContent.current = content;
      setPendingDraft(content);
      if (saveTimer.current) clearTimeout(saveTimer.current);

      if (!debounce) {
        return flushSave();
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void flushSaveRef.current();
      }, 2000);
      return true;
    },
    [flushSave, isCurrentVersion],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const restoreVersion = useCallback(
    async (version: number): Promise<void> => {
      if (!(await flushSaveRef.current())) return;
      const current = artifactRef.current;
      if (!current) return;
      setStatus("saving");
      setError(null);
      try {
        const restored = await restoreAiArtifactVersion(workspaceId, current.id, version);
        setArtifact(restored);
        setPendingDraft(null);
        setMode("edit");
        const nextVersions = await listAiArtifactVersions(workspaceId, restored.id);
        setVersions(nextVersions);
        setVersionIndex(Math.max(0, nextVersions.length - 1));
        setStatus("idle");
      } catch (cause) {
        setStatus("error");
        setError(messageOf(cause));
      }
    },
    [workspaceId],
  );

  const resolveSuggestion = useCallback(
    async (suggestionId: string, resolved: boolean): Promise<void> => {
      const current = artifactRef.current;
      if (!current) return;
      try {
        const saved = await setAiArtifactSuggestionResolved(
          workspaceId,
          current.id,
          suggestionId,
          resolved,
        );
        // The REST list returns only unresolved suggestions; mirror that in
        // the panel so applying/ignoring removes the row instead of leaving a
        // disabled "0 待处理" section behind.
        setSuggestions((rows) =>
          resolved
            ? rows.filter((row) => row.id !== saved.id)
            : rows.map((row) => (row.id === saved.id ? saved : row)),
        );
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [workspaceId],
  );

  const applySuggestion = useCallback(
    async (suggestion: AiArtifactSuggestion): Promise<void> => {
      await flushSaveRef.current();
      const current = artifactRef.current;
      if (!current || !isCurrentVersion) return;
      if (!current.content.includes(suggestion.originalText)) {
        setError("原文已经变化，无法应用这条建议。");
        return;
      }
      const nextContent = current.content.replace(
        suggestion.originalText,
        suggestion.suggestedText,
      );
      const saved = await saveContent(nextContent, false);
      if (!saved) return;
      await resolveSuggestion(suggestion.id, true);
    },
    [isCurrentVersion, resolveSuggestion, saveContent],
  );

  const value = useMemo<ArtifactContextValue>(
    () => ({
      applySuggestion,
      artifact,
      closeArtifact,
      currentContent,
      error,
      isCurrentVersion,
      mode,
      openArtifact,
      refresh,
      resolveSuggestion,
      restoreVersion,
      saveContent,
      setMode,
      setVersionIndex,
      status,
      suggestions,
      versionIndex,
      versions,
      visible,
    }),
    [
      applySuggestion,
      artifact,
      closeArtifact,
      currentContent,
      error,
      isCurrentVersion,
      mode,
      openArtifact,
      refresh,
      resolveSuggestion,
      restoreVersion,
      saveContent,
      status,
      suggestions,
      versionIndex,
      versions,
      visible,
    ],
  );

  return <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>;
}

export function useAiArtifact(): ArtifactContextValue {
  const context = useContext(ArtifactContext);
  if (!context) {
    throw new Error("useAiArtifact must be used within AiArtifactProvider");
  }
  return context;
}

export function useOptionalAiArtifact(): ArtifactContextValue | null {
  return useContext(ArtifactContext);
}
