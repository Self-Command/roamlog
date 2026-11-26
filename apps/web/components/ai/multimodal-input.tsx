"use client";

/**
 * Full multimodal composer ported from vercel/chatbot
 * `components/chat/multimodal-input.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * Complete behavior carried over:
 * - persisted draft (`localStorage` key `input`)
 * - delayed auto focus
 * - file picker, clipboard image paste, drag/drop, upload queue/preview/remove
 * - slash command detection + keyboard navigation
 * - editing banner/cancel
 * - suggested actions for an empty conversation
 * - stop button, send gating and inline upload errors
 *
 * Adaptation layer: `@ai-sdk/react`'s `useChatHelpers` and Vercel Blob upload
 * queue are replaced by assistant-ui's composer runtime and Roamlog's existing
 * media attachment adapter. The visible state machine and keyboard behavior are
 * kept, but uploads go through `ComposerPrimitive`/`AttachmentAdapter`.
 */

import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { AI_ATTACHMENT_MAX_COUNT } from "@roamlog/contracts";
import { Button } from "@roamlog/ui";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { cancelAiStream, fetchAiStreamStatus } from "@/lib/api/ai";

import { AttachmentPreview } from "./attachment-preview";
import { ReasoningSelectorCompact } from "./chat-controls";
import { cn } from "./cn";
import { AI_ATTACHMENT_ACCEPT, AiAttachmentError } from "./media-attachment-adapter";
import { ModelSelectorCompact } from "./model-selector";
import {
  filterSlashCommands,
  slashCommandForText,
  SlashCommandMenu,
  type SlashCommand,
  type SlashCommandHandlers,
} from "./slash-commands";
import { useCurrentChatModel, VisionNote, VISION_UNAVAILABLE_NOTE } from "./vision-note";

const DRAFT_STORAGE_KEY = "input";
const DRAFT_SAVE_DELAY_MS = 100;

export interface MultimodalInputProps {
  workspaceId: string;
  className?: string;
  editingMessage?: boolean;
  onCancelEdit?: () => void;
  commands?: SlashCommandHandlers;
  modelSelectorOpen?: boolean;
  onModelSelectorOpenChange?: (open: boolean) => void;
}

export async function stopActiveAiRun({
  workspaceId,
  conversationId,
  cancelLocal,
}: {
  workspaceId: string;
  conversationId: string | null;
  cancelLocal: () => void;
}): Promise<boolean> {
  let cancelledOnServer = false;
  if (conversationId) {
    try {
      const status = await fetchAiStreamStatus(workspaceId, conversationId);
      if (status.active && status.streamId) {
        cancelledOnServer = await cancelAiStream(
          workspaceId,
          conversationId,
          status.streamId,
        );
      }
    } catch {
      // The local stop still has to work when the status probe fails. The
      // resumable producer is the only thing that may survive, and the next
      // page load will reconcile it through useAutoResume.
    }
  }
  try {
    cancelLocal();
  } catch {
    // The runtime may already be gone while the page is being torn down.
  }
  return cancelledOnServer;
}

function StopButton({ workspaceId }: { workspaceId: string }) {
  const aui = useAui();
  const running = useAuiState((state) => state.thread.isRunning);
  const conversationId = useAuiState((state) => {
    const mainThreadId = state.threads.mainThreadId;
    if (!mainThreadId) return null;
    return (
      state.threads.threadItems.find((item) => item.id === mainThreadId)?.remoteId ?? null
    );
  });
  const [stopping, setStopping] = useState(false);

  if (!running) return null;

  return (
    <Button
      aria-label="停止生成"
      aria-busy={stopping}
      className="shrink-0"
      data-testid="stop-button"
      disabled={stopping}
      onClick={() => {
        if (stopping) return;
        setStopping(true);
        void stopActiveAiRun({
          workspaceId,
          conversationId,
          cancelLocal: () => aui.thread.cancelRun(),
        }).finally(() => setStopping(false));
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      <Square aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

export function MultimodalInput({
  workspaceId,
  className,
  editingMessage = false,
  onCancelEdit,
  commands,
  modelSelectorOpen,
  onModelSelectorOpenChange,
}: MultimodalInputProps) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const attachments = useAuiState((state) => state.composer.attachments);
  const canSend = useAuiState((state) => state.composer.canSend);
  const running = useAuiState((state) => state.thread.isRunning);
  const currentModel = useCurrentChatModel(workspaceId);
  const visionUnavailable = currentModel !== null && !currentModel.vision;
  const uploading = attachments.some((attachment) => attachment.status.type === "running");
  const failed = attachments.some((attachment) => attachment.status.type === "incomplete");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const filteredCommands = useMemo(() => filterSlashCommands(slashQuery), [slashQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (draftHydrated) return;
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? "";
    if (stored && !aui.composer.getState().text) {
      aui.composer.setText(stored);
    }
    setDraftHydrated(true);
  }, [aui, draftHydrated]);

  useEffect(() => {
    if (!draftHydrated) return;
    if (text) {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, text);
    } else {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, [draftHydrated, text]);

  const appendFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const state = aui.composer.getState();
      const capacity = Math.max(0, AI_ATTACHMENT_MAX_COUNT - state.attachments.length);
      if (capacity === 0) {
        setError(`一次最多 ${AI_ATTACHMENT_MAX_COUNT} 个附件。`);
        return;
      }

      const accepted = files.slice(0, capacity);
      if (accepted.length < files.length) {
        setError(`一次最多 ${AI_ATTACHMENT_MAX_COUNT} 个附件，超出的文件未添加。`);
      }

      await Promise.all(
        accepted.map(async (file) => {
          try {
            await aui.composer.addAttachment(file);
          } catch (cause) {
            if (cause instanceof AiAttachmentError) {
              setError(cause.remedy ? `${cause.message} ${cause.remedy}` : cause.message);
              return;
            }
            setError(cause instanceof Error ? cause.message : "附件上传失败，请重试。");
          }
        }),
      );
    },
    [aui],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length > 0) void appendFiles(files);
    },
    [appendFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith("image/"))
        .flatMap((item) => {
          const file = item.getAsFile();
          return file ? [file] : [];
        });
      if (files.length === 0) return;
      event.preventDefault();
      void appendFiles(files);
    },
    [appendFiles],
  );

  const handleDropCapture = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void appendFiles(files);
    },
    [appendFiles],
  );

  const selectCommand = useCallback(
    async (command: SlashCommand) => {
      setSlashOpen(false);
      setSlashIndex(0);
      setError(null);
      aui.composer.setText("");

      const handler = commands?.[command.action];
      if (!handler) {
        setError(`/${command.name} 需要在会话上下文中执行。`);
        return;
      }

      try {
        await handler();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `/${command.name} 执行失败，请重试。`);
      }
    },
    [aui, commands],
  );

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    // Upstream `useLocalStorage` writes the draft with the input event. Waiting
    // for the follow-up effect loses the draft when a user refreshes immediately.
    if (value) window.localStorage.setItem(DRAFT_STORAGE_KEY, value);
    else window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(value.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;

      if (slashOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((index) => Math.min(index + 1, Math.max(0, filteredCommands.length - 1)));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((index) => Math.max(index - 1, 0));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const command = filteredCommands[slashIndex];
          if (command) void selectCommand(command);
          else setSlashOpen(false);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashOpen(false);
          return;
        }
      }

      if (event.key === "Escape" && editingMessage) {
        event.preventDefault();
        onCancelEdit?.();
      }
    },
    [editingMessage, filteredCommands, onCancelEdit, selectCommand, slashIndex, slashOpen],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (slashOpen) {
        event.preventDefault();
        return;
      }

      const command = slashCommandForText(text);
      if (command) {
        event.preventDefault();
        void selectCommand(command);
        return;
      }
      if (text.trimStart().startsWith("/")) {
        event.preventDefault();
        return;
      }
      if (running) {
        event.preventDefault();
        setError("请等待当前回答结束再发送。");
        return;
      }
      if (uploading) {
        event.preventDefault();
        setError("请等待附件上传完成再发送。");
        return;
      }
      if (failed) {
        event.preventDefault();
        setError("请先移除上传失败的附件。");
        return;
      }
      setError(null);
    },
    [failed, running, selectCommand, slashOpen, text, uploading],
  );

  return (
    <div className={cn("relative mx-auto flex w-full max-w-3xl flex-col gap-3", className)}>
      {editingMessage && onCancelEdit ? (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span>正在编辑消息</span>
          <button
            className="rounded px-1.5 py-0.5 text-stone transition-colors hover:bg-surface-1 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCancelEdit}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}

      <input
        accept={AI_ATTACHMENT_ACCEPT}
        className="pointer-events-none fixed -left-4 -top-4 size-0.5 opacity-0"
        data-testid="attachments-input"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="relative">
        {slashOpen ? (
          <SlashCommandMenu
            onSelect={(command) => void selectCommand(command)}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        ) : null}
      </div>

      <ComposerPrimitive.AttachmentDropzone
        className="rounded-card data-[dragging=true]:ring-2 data-[dragging=true]:ring-ink/30"
        data-testid="composer-dropzone"
        onDropCapture={handleDropCapture}
      >
        <ComposerPrimitive.Root
          className="flex w-full flex-col gap-1.5 rounded-card border border-hairline-strong bg-surface-1 px-2 py-1.5 focus-within:border-ink/40"
          data-testid="composer-root"
          onSubmit={handleSubmit}
        >
          {attachments.length > 0 ? (
            <div
              className="flex w-full self-start flex-row gap-2 overflow-x-auto px-1 pt-1"
              data-testid="attachments-preview"
            >
              <ComposerPrimitive.Attachments>
                {({ attachment }) => (
                  <AttachmentPreview
                    attachment={attachment}
                    isUploading={attachment.status.type === "running"}
                    onRemove={() => void aui.composer.attachment({ id: attachment.id }).remove()}
                  />
                )}
              </ComposerPrimitive.Attachments>
            </div>
          ) : null}

          <ComposerPrimitive.Input
            addAttachmentOnPaste={false}
            aria-label="给 AI 助手发消息"
            autoFocus
            className="max-h-48 min-h-10 w-full resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-stone"
            data-testid="multimodal-input"
            maxRows={8}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              editingMessage
                ? "编辑你的消息…"
                : "描述你的目标、约束和期望结果"
            }
            ref={textareaRef}
            rows={1}
            submitMode="enter"
          />

          <div className="flex min-w-0 items-center gap-1 px-1">
            <Button
              aria-label="添加图片附件"
              className="shrink-0"
              data-testid="attachments-button"
              disabled={running}
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              title={visionUnavailable ? VISION_UNAVAILABLE_NOTE : undefined}
              type="button"
              variant="ghost"
            >
              <Paperclip aria-hidden="true" className="size-4" />
            </Button>

            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <ModelSelectorCompact
                workspaceId={workspaceId}
                open={modelSelectorOpen}
                onOpenChange={onModelSelectorOpenChange}
              />
              <ReasoningSelectorCompact workspaceId={workspaceId} />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {running ? (
                <StopButton workspaceId={workspaceId} />
              ) : (
                <ComposerPrimitive.Send asChild>
                  <Button
                    aria-label="发送"
                    className="shrink-0"
                    data-testid="send-button"
                    disabled={!canSend || uploading || failed}
                    size="sm"
                    type="button"
                    variant="primary"
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </Button>
                </ComposerPrimitive.Send>
              )}
            </div>
          </div>

          <VisionNote model={currentModel} />

          {error ? (
            <p
              className="px-2 text-xs leading-5 text-accent-red"
              data-testid="composer-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </ComposerPrimitive.Root>
      </ComposerPrimitive.AttachmentDropzone>
    </div>
  );
}
