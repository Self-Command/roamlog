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
  saveContent: (content: string, debounce?: boolean) => Promise<void>;
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const artifactRef = useRef<AiArtifact | null>(null);
  artifactRef.current = artifact;

  const currentContent =
    versions[versionIndex]?.content ?? artifact?.content ?? "";
  const isCurrentVersion = !artifact || versionIndex === versions.length - 1;

  const loadDetails = useCallback(
    async (artifactId: string): Promise<void> => {
      setStatus("loading");
      setError(null);
      try {
        const [nextArtifact, nextVersions, nextSuggestions] = await Promise.all([
          getAiArtifact(workspaceId, artifactId),
          listAiArtifactVersions(workspaceId, artifactId),
          listAiArtifactSuggestions(workspaceId, artifactId),
        ]);
        setArtifact(nextArtifact);
        setVersions(nextVersions);
        setSuggestions(nextSuggestions);
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
      setVisible(true);
      setMode("edit");
      await loadDetails(id);
    },
    [loadDetails],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!artifactRef.current) return;
    await loadDetails(artifactRef.current.id);
  }, [loadDetails]);

  const closeArtifact = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const content = pendingContent.current;
      pendingContent.current = null;
      if (content !== null && artifactRef.current) {
        void updateAiArtifact(workspaceId, artifactRef.current.id, {
          content,
          version: artifactRef.current.version,
        }).catch(() => undefined);
      }
    }
    setVisible(false);
  }, [workspaceId]);

  const saveContent = useCallback(
    async (content: string, debounce = true): Promise<void> => {
      const current = artifactRef.current;
      if (!current || !isCurrentVersion) return;

      pendingContent.current = content;
      if (saveTimer.current) clearTimeout(saveTimer.current);

      const commit = async (): Promise<void> => {
        const latest = artifactRef.current;
        const nextContent = pendingContent.current;
        if (!latest || nextContent === null) return;
        setStatus("saving");
        setError(null);
        try {
          const updated = await updateAiArtifact(workspaceId, latest.id, {
            content: nextContent,
            version: latest.version,
          });
          pendingContent.current = null;
          setArtifact(updated);
          setStatus("idle");
          const nextVersions = await listAiArtifactVersions(workspaceId, updated.id);
          setVersions(nextVersions);
          setVersionIndex(Math.max(0, nextVersions.length - 1));
        } catch (cause) {
          setStatus("error");
          setError(messageOf(cause));
        }
      };

      if (!debounce) {
        await commit();
        return;
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void commit();
      }, 2000);
    },
    [isCurrentVersion, workspaceId],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const restoreVersion = useCallback(
    async (version: number): Promise<void> => {
      const current = artifactRef.current;
      if (!current) return;
      setStatus("saving");
      setError(null);
      try {
        const restored = await restoreAiArtifactVersion(workspaceId, current.id, version);
        setArtifact(restored);
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
        setSuggestions((rows) =>
          rows.map((row) => (row.id === saved.id ? saved : row)),
        );
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [workspaceId],
  );

  const applySuggestion = useCallback(
    async (suggestion: AiArtifactSuggestion): Promise<void> => {
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
      await saveContent(nextContent, false);
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
