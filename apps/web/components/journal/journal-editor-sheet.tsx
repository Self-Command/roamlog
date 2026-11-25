"use client";

import type {
  Comment,
  EntryRevision,
  JournalEntry,
  Trip,
  WorkspaceMemberWithUser,
} from "@roamlog/contracts";
import {
  Button,
  FormField,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";
import {
  AlertCircle,
  Check,
  CloudOff,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConflictDialog } from "@/components/app-shell/conflict-dialog";
import { ReportMenu } from "@/components/moderation/report-menu";
import { EntryRevisionList } from "@/components/trip-detail/entry-revision-list";
import { isVersionConflict } from "@/lib/api";

import { JournalComments } from "./journal-comments";
import { JournalEditor, type JournalEditorValue } from "./journal-editor";
import type { JournalEntryRepository } from "./journal-repository";

type SaveState = "idle" | "draft" | "dirty" | "saving" | "saved" | "error" | "conflict";

interface EditorDraft {
  baseVersion: number;
  title: string;
  date: string;
  location: string;
  contentJson: JournalEntry["contentJson"];
  contentHtml: string;
  text: string;
  savedAt: string;
}

interface JournalEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: JournalEntry | null;
  repository: JournalEntryRepository;
  tripId?: string;
  trips?: Trip[];
  initialTripId?: string;
  canEdit: boolean;
  canComment?: boolean;
  members: WorkspaceMemberWithUser[];
  currentUserId?: string;
  comments?: Comment[];
  commentsLoading?: boolean;
  onSubmitComment?: (body: string, mentionUserIds: string[]) => Promise<void> | void;
  onEntrySaved?: (entry: JournalEntry) => void;
  onEntryRestored?: (entry: JournalEntry) => void;
}

const EMPTY_DOC: JournalEditorValue = {
  contentJson: { type: "doc", content: [{ type: "paragraph" }] },
  contentHtml: "<p></p>",
  text: "",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function excerptFromText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function draftKey(entryId: string | null, tripId: string) {
  return `roamlog:journal-editor:draft:v1:${entryId ?? `new:${tripId}`}`;
}

function readDraft(key: string): EditorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as EditorDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: EditorDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Keep editing even if localStorage is unavailable.
  }
}

function clearDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore blocked storage.
  }
}

function statusCopy(state: SaveState, lastSavedAt: Date | null) {
  switch (state) {
    case "draft":
      return "已恢复本地草稿";
    case "dirty":
      return "有未保存修改";
    case "saving":
      return "保存中…";
    case "saved":
      return lastSavedAt
        ? `已保存 · ${new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(lastSavedAt)}`
        : "已保存";
    case "error":
      return "保存失败";
    case "conflict":
      return "其他人先保存了，等待你选择";
    default:
      return "等待编辑";
  }
}

export function JournalEditorSheet({
  open,
  onOpenChange,
  entry = null,
  repository,
  tripId,
  trips = [],
  initialTripId,
  canEdit,
  canComment = true,
  members,
  currentUserId,
  comments = [],
  commentsLoading = false,
  onSubmitComment,
  onEntrySaved,
  onEntryRestored,
}: JournalEditorSheetProps) {
  const loadedKey = useRef<string | null>(null);
  const savingRef = useRef(false);
  const suppressBlurSave = useRef(false);
  const conflictRef = useRef(false);
  const [entryId, setEntryId] = useState<string | null>(entry?.id ?? null);
  const [selectedTripId, setSelectedTripId] = useState(
    entry?.tripId ?? initialTripId ?? tripId ?? "",
  );
  const [title, setTitle] = useState(entry?.title ?? "");
  const [date, setDate] = useState(entry?.date ?? today());
  const [location, setLocation] = useState(entry?.location ?? "");
  const [content, setContent] = useState<JournalEditorValue>(() =>
    entry
      ? {
          contentJson: entry.contentJson,
          contentHtml: entry.contentHtml,
          text: "",
        }
      : EMPTY_DOC,
  );
  const [version, setVersion] = useState(entry?.version ?? 1);
  const [editorKey, setEditorKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [revisions, setRevisions] = useState<EntryRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickerTrips = trips.length ? trips : [];
  const activeTripId = selectedTripId || tripId || initialTripId || "";
  const storageKey = useMemo(
    () => draftKey(entryId, activeTripId || "unassigned"),
    [activeTripId, entryId],
  );
  // The AI endpoint is scoped by workspace, and the sheet only knows a trip. The
  // entry carries its own workspace; a brand-new entry borrows the trip's.
  const aiWorkspaceId = useMemo(
    () =>
      entry?.workspaceId ??
      pickerTrips.find((candidate) => candidate.id === activeTripId)?.workspaceId ??
      null,
    [activeTripId, entry?.workspaceId, pickerTrips],
  );

  const applyEntry = useCallback((next: JournalEntry) => {
    setEntryId(next.id);
    setSelectedTripId(next.tripId);
    setTitle(next.title);
    setDate(next.date);
    setLocation(next.location);
    setContent({
      contentJson: next.contentJson,
      contentHtml: next.contentHtml,
      text: "",
    });
    setVersion(next.version);
    setEditorKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      loadedKey.current = null;
      return;
    }
    const key = entry ? `entry:${entry.id}` : `new:${initialTripId ?? tripId ?? ""}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    const nextTripId = entry?.tripId ?? initialTripId ?? tripId ?? "";
    setEntryId(entry?.id ?? null);
    setSelectedTripId(nextTripId);
    setTitle(entry?.title ?? "");
    setDate(entry?.date ?? today());
    setLocation(entry?.location ?? "");
    setContent(
      entry
        ? {
            contentJson: entry.contentJson,
            contentHtml: entry.contentHtml,
            text: "",
          }
        : EMPTY_DOC,
    );
    setVersion(entry?.version ?? 1);
    setEditorKey((value) => value + 1);
    setSaveError(null);
    conflictRef.current = false;
    setConflictOpen(false);
    setLastSavedAt(null);

    const draft = readDraft(draftKey(entry?.id ?? null, nextTripId || "unassigned"));
    if (draft && (!entry || draft.baseVersion === entry.version)) {
      setTitle(draft.title);
      setDate(draft.date);
      setLocation(draft.location);
      setContent({
        contentJson: draft.contentJson,
        contentHtml: draft.contentHtml,
        text: draft.text,
      });
      setDirty(true);
      setSaveState("draft");
    } else {
      setDirty(false);
      setSaveState(entry ? "saved" : "idle");
    }
  }, [entry, initialTripId, open, tripId]);

  const refreshRevisions = useCallback(async () => {
    if (!entryId) {
      setRevisions([]);
      return;
    }
    setRevisionsLoading(true);
    try {
      setRevisions(await repository.listRevisions(entryId));
    } catch {
      setRevisions([]);
    } finally {
      setRevisionsLoading(false);
    }
  }, [entryId, repository]);

  useEffect(() => {
    if (!open || !entryId) return;
    void refreshRevisions();
  }, [entryId, open, refreshRevisions]);

  useEffect(() => {
    if (!open || !dirty) return;
    writeDraft(storageKey, {
      baseVersion: version,
      title,
      date,
      location,
      contentJson: content.contentJson,
      contentHtml: content.contentHtml,
      text: content.text,
      savedAt: new Date().toISOString(),
    });
  }, [content, date, dirty, location, open, storageKey, title, version]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const persist = useCallback(
    async (expectedVersion = version) => {
      if (savingRef.current || !canEdit) return;
      if (!title.trim() || !location.trim() || !activeTripId) {
        setSaveError("标题、地点和所属旅行不能为空。");
        setSaveState("error");
        return;
      }
      setSaving(true);
      savingRef.current = true;
      setSaveError(null);
      setSaveState("saving");
      const payload = {
        title: title.trim(),
        date,
        location: location.trim(),
        contentJson: content.contentJson,
        contentHtml: content.contentHtml || "<p></p>",
        excerpt: excerptFromText(content.text || title),
      };
      try {
        const saved = entryId
          ? await repository.saveEntry(entryId, payload, expectedVersion)
          : await repository.createEntry(activeTripId, payload);
        applyEntry(saved);
        setLastSavedAt(new Date());
        setDirty(false);
        setSaveState("saved");
        conflictRef.current = false;
        setConflictOpen(false);
        clearDraft(storageKey);
        onEntrySaved?.(saved);
        if (!entryId) {
          onOpenChange(false);
        } else {
          void refreshRevisions();
        }
      } catch (cause) {
        if (isVersionConflict(cause)) {
          conflictRef.current = true;
          setSaveState("conflict");
          setConflictOpen(true);
        } else {
          setSaveState("error");
          setSaveError("保存没有成功。你的草稿仍保存在本地，可重试。");
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [
      activeTripId,
      applyEntry,
      canEdit,
      content.contentHtml,
      content.contentJson,
      content.text,
      date,
      entryId,
      location,
      onEntrySaved,
      onOpenChange,
      refreshRevisions,
      repository,
      saving,
      storageKey,
      title,
      version,
    ],
  );

  useEffect(() => {
    if (!open || !dirty || saving || conflictOpen || !canEdit) return;
    if (!title.trim() || !location.trim() || !activeTripId) return;
    const timer = window.setTimeout(() => {
      void persist();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [activeTripId, canEdit, conflictOpen, dirty, location, open, persist, saving, title]);

  async function reloadConflict() {
    if (!entryId) return;
    try {
      const latest = await repository.getEntry(entryId);
      applyEntry(latest);
      setVersion(latest.version);
      setDirty(false);
      setSaveState("saved");
      setSaveError(null);
      conflictRef.current = false;
      setConflictOpen(false);
      clearDraft(storageKey);
      void refreshRevisions();
    } catch {
      setSaveState("error");
      setSaveError("无法重新加载最新版本，请稍后再试。");
    }
  }

  async function overwriteConflict() {
    if (!entryId) return;
    try {
      const latest = await repository.getEntry(entryId);
      setVersion(latest.version);
      conflictRef.current = false;
      setConflictOpen(false);
      await persist(latest.version);
    } catch {
      setSaveState("error");
      setSaveError("覆盖保存失败，请重新加载后再试。");
    }
  }

  async function restore(revision: EntryRevision) {
    if (!entryId) return;
    setRestoringId(revision.id);
    try {
      const restored = await repository.restoreRevision(entryId, revision.id);
      applyEntry(restored);
      setDirty(false);
      setLastSavedAt(new Date());
      setSaveState("saved");
      clearDraft(storageKey);
      onEntryRestored?.(restored);
      onEntrySaved?.(restored);
      await refreshRevisions();
    } catch {
      setSaveState("error");
      setSaveError("恢复版本失败，请重新加载后再试。");
    } finally {
      setRestoringId(null);
    }
  }

  function markDirty(state: SaveState = "dirty") {
    if (!canEdit) return;
    setDirty(true);
    setSaveError(null);
    setSaveState(state);
  }

  const isReadOnly = !canEdit;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <div className="flex flex-wrap items-center gap-2">
              <p className="type-eyebrow">{entryId ? "编辑旅行日志" : "新建旅行日志"}</p>
              <span
                role="status"
                className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] ${
                  saveState === "error" || saveState === "conflict"
                    ? "border-accent-red/30 bg-accent-red/5 text-accent-red"
                    : saveState === "saving"
                      ? "border-hairline-strong bg-surface-2 text-muted"
                      : "border-hairline bg-surface-1 text-muted"
                }`}
              >
                {saveState === "saving" ? (
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                ) : saveState === "saved" ? (
                  <Check aria-hidden="true" className="size-3 text-accent-green" />
                ) : saveState === "error" || saveState === "conflict" ? (
                  <AlertCircle aria-hidden="true" className="size-3" />
                ) : saveState === "draft" ? (
                  <CloudOff aria-hidden="true" className="size-3" />
                ) : (
                  <span aria-hidden="true" className="size-1.5 rounded-pill bg-stone" />
                )}
                {statusCopy(saveState, lastSavedAt)}
              </span>
              {entry ? (
                // A report is a side action: it never closes the sheet and is
                // available to every member, including Viewers.
                <div className="ml-auto">
                  <ReportMenu
                    workspaceId={entry.workspaceId}
                    target={{
                      type: "entry",
                      id: entry.id,
                      label: entry.title || title || "未命名日志",
                    }}
                    label={`更多操作：${entry.title || "这篇日志"}`}
                  />
                </div>
              ) : null}
            </div>
            <SheetTitle className="mt-2 font-prose text-2xl font-semibold tracking-[-0.015em]">
              {entryId ? title || "未命名日志" : "写一篇日志"}
            </SheetTitle>
            <SheetDescription>
              {isReadOnly
                ? "只读视图。只读成员可以阅读全文并发表评论。"
                : "每 5 秒自动保存，离开输入框也会保存。如果其他成员同时修改，会请你选择保留哪一版。"}
            </SheetDescription>
          </SheetHeader>

          <form
            className="mt-5 space-y-4"
            onBlur={(event) => {
              if (suppressBlurSave.current) {
                suppressBlurSave.current = false;
                return;
              }
              if (savingRef.current || conflictRef.current) return;
              if (
                dirty &&
                !saving &&
                canEdit &&
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              ) {
                void persist();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void persist();
            }}
          >
            {!entryId && pickerTrips.length ? (
              <FormField label="所属旅行" required>
                <Select
                  value={selectedTripId}
                  onChange={(event) => {
                    setSelectedTripId(event.target.value);
                    markDirty();
                  }}
                  disabled={isReadOnly}
                >
                  <option value="">选择旅行</option>
                  {pickerTrips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.title}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <FormField label="标题" required>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  markDirty();
                }}
                maxLength={180}
                disabled={isReadOnly}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="日期">
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    markDirty();
                  }}
                  disabled={isReadOnly}
                />
              </FormField>
              <FormField label="地点" required>
                <Input
                  value={location}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    markDirty();
                  }}
                  maxLength={160}
                  disabled={isReadOnly}
                />
              </FormField>
            </div>

            <div className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
              <JournalEditor
                key={`${entryId ?? "new"}-${editorKey}`}
                contentJson={content.contentJson}
                onChange={(value) => {
                  setContent(value);
                  markDirty();
                }}
                readOnly={isReadOnly}
                ariaLabel="日志正文"
                workspaceId={aiWorkspaceId}
                tripId={activeTripId || undefined}
                aiRewrite={{
                  workspaceId: aiWorkspaceId,
                  tripId: activeTripId || undefined,
                }}
              />
            </div>

            {saveError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
              >
                <span>{saveError}</span>
                {canEdit ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void persist()}>
                    <RefreshCw aria-hidden="true" />
                    重试
                  </Button>
                ) : null}
              </div>
            ) : null}

            {canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
                <p className="max-w-md text-[10px] leading-5 text-muted">
                  编辑会自动保存；评论会同步到这篇日志。
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  onMouseDown={() => {
                    suppressBlurSave.current = true;
                  }}
                >
                  {saving ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Save aria-hidden="true" />
                  )}
                  立即保存
                </Button>
              </div>
            ) : null}
          </form>

          {entryId ? (
            <div className="mt-7 border-t border-hairline pt-5">
              <EntryRevisionList
                revisions={revisions}
                loading={revisionsLoading}
                restoringId={restoringId}
                disabled={!canEdit}
                onRestore={(revision) => void restore(revision)}
              />
            </div>
          ) : null}

          {entryId ? (
            <div className="mt-7 border-t border-hairline pt-5">
              <JournalComments
                comments={comments}
                members={members}
                currentUserId={currentUserId}
                loading={commentsLoading}
                disabled={!canComment}
                onSubmit={onSubmitComment}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={(next) => {
          if (!next) conflictRef.current = false;
          setConflictOpen(next);
          if (!next && saveState === "conflict") setSaveState("dirty");
        }}
        entityLabel="这篇日志"
        onReload={() => void reloadConflict()}
        onOverwrite={() => void overwriteConflict()}
        pending={saving}
      />
    </>
  );
}
