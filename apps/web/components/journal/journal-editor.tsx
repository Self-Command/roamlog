"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Columns3,
  Grid3X3,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Pilcrow,
  Quote,
  Redo2,
  Rows3,
  Sparkles,
  Table as TableIcon,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AiRewriteLocale, JsonObject } from "@roamlog/contracts";
import { Button, Input } from "@roamlog/ui";

import { COVER_ACCEPT_ATTRIBUTE, type CoverMediaClient } from "@/lib/api/media";
import { rewriteBlockMessage, rewriteBlockReason } from "@/lib/ai/selection";
import { AIHighlight, stripAIHighlight, stripAIHighlightHtml } from "@/lib/editor/ai-highlight";

import GenerativeMenuSwitch from "./ai/generative-menu-switch";
import {
  JournalColumnsBubble,
  JournalColumnsInsertMenu,
} from "./extensions/journal-columns-bubble";
import { JournalColumn, JournalColumns } from "./extensions/journal-columns";
import {
  GALLERY_DEFAULT_COLUMNS,
  galleryImageAttrsFromUpload,
  JournalGallery,
  JournalGalleryImage,
  type JournalGalleryUploadImage,
} from "./extensions/journal-gallery";
import { JournalImage } from "./extensions/journal-image";
import { journalImageUploadErrorMessage, uploadJournalImage } from "./journal-image-upload";
import "./journal-layout.css";

/** Props of the AI entries; `workspaceId` scopes every request. */
export interface JournalAiEntry {
  workspaceId: string | null;
  tripId?: string | null;
  locale?: AiRewriteLocale;
  /** Called after a rewrite was written into the document. */
  onApplied?: () => void;
}

export interface JournalEditorValue {
  contentJson: JsonObject;
  contentHtml: string;
  text: string;
}

interface JournalEditorProps {
  contentJson: JsonObject;
  onChange: (value: JournalEditorValue) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /**
   * The AI entries: Novel's bubble menu (the primary entry, shown on a non-empty
   * selection) plus a persistent toolbar button that is an adaptation for mobile
   * and keyboard users. The editor owns the instance, so the controls receive it
   * here instead of the sheet threading a ref.
   */
  aiRewrite?: JournalAiEntry;
  /** Workspace that owns the uploaded media (presign is workspace-scoped). */
  workspaceId?: string | null;
  /** Optional trip association for the uploaded media row. */
  tripId?: string | null;
  /** Test seam; production uses the generated media client. */
  imageUploadClient?: CoverMediaClient;
}

interface ToolbarButtonProps {
  label: string;
  /** Native tooltip override; the disabled reason travels here. */
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({
  label,
  hint,
  pressed = false,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={hint ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-9 items-center justify-center rounded-[5px] border text-muted transition-colors outline-none hover:border-hairline-strong hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none disabled:opacity-35 ${
        pressed ? "border-hairline-strong bg-surface-2 text-ink" : "border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

export function JournalEditor({
  contentJson,
  onChange,
  readOnly = false,
  placeholder = "今天发生了什么？写下雨声、路名和没说完的话。",
  ariaLabel = "日志正文",
  className,
  aiRewrite,
  workspaceId,
  tripId,
  imageUploadClient,
}: JournalEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  // Signature of the last content handed to the sheet, so a highlight-only
  // transaction is not reported as a document change.
  const lastEmittedRef = useRef<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [galleryUploadingCount, setGalleryUploadingCount] = useState<number | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const imageUploadAbortRef = useRef<AbortController | null>(null);
  const galleryUploadAbortRef = useRef<AbortController | null>(null);
  const uploadContextRef = useRef({ workspaceId, tripId, imageUploadClient });
  uploadContextRef.current = { workspaceId, tripId, imageUploadClient };

  useEffect(() => {
    return () => {
      imageUploadAbortRef.current?.abort();
      imageUploadAbortRef.current = null;
      galleryUploadAbortRef.current?.abort();
      galleryUploadAbortRef.current = null;
    };
  }, []);

  async function uploadGalleryImages(
    files: File[],
    signal: AbortSignal,
  ): Promise<JournalGalleryUploadImage[]> {
    const uploads: JournalGalleryUploadImage[] = [];

    for (const file of files) {
      if (signal.aborted) {
        throw new DOMException("图片上传已取消。", "AbortError");
      }

      uploads.push(await uploadJournalImageForEditor(file, signal));
    }

    return uploads;
  }

  async function uploadJournalImageForEditor(
    file: File,
    signal: AbortSignal,
  ): Promise<JournalGalleryUploadImage> {
    const context = uploadContextRef.current;
    if (!context.workspaceId) {
      throw new Error("无法确定所属工作区，暂时不能上传图片。");
    }

    const media = await uploadJournalImage({
      workspaceId: context.workspaceId,
      tripId: context.tripId,
      file,
      signal,
      client: context.imageUploadClient,
    });

    if (!media.url) {
      throw new Error("图片已上传，但服务器没有返回可访问的地址。");
    }

    return {
      src: media.url,
      mediaId: media.id,
      alt: file.name,
      width: media.width,
      height: media.height,
    };
  }

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !readOnly,
    content: contentJson as JSONContent,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
        },
      }),
      // Journal images are uploaded media URLs; base64 placeholders are not a
      // valid image source anymore (the old fake-image button used one).
      JournalImage.configure({
        inline: false,
        allowBase64: false,
        uploadImage: uploadJournalImageForEditor,
      }),
      // Gallery images must be registered before the gallery container so its
      // `galleryImage+` content expression resolves against this schema.
      JournalGalleryImage,
      JournalGallery.configure({ uploadImages: uploadGalleryImages }),
      JournalColumn,
      JournalColumns,
      Placeholder.configure({ placeholder }),
      // Ported from https://tiptap.dev/docs/editor/extensions/nodes/table (+ /table-row, /table-header, /table-cell).
      Table.configure({ resizable: false, allowTableNodeSelection: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Ported from https://tiptap.dev/docs/editor/extensions/nodes/task-list and /task-item.
      TaskList,
      TaskItem.configure({ nested: true }),
      // AI selection highlight mark (ported from Novel `ai-highlight.ts`). Also the
      // `Mod-Shift-h` shortcut and the `==…==` input rule come with it.
      AIHighlight,
      // Needed by the AI panel: `getPrevText`/`selectionMarkdown` serialize the
      // document through `editor.storage.markdown.manager` (TipTap v3, D5).
      // The extension only adds `getMarkdown` + the manager and leaves JSON content
      // parsing untouched (`contentType` stays `"json"`).
      Markdown,
    ],
    editorProps: {
      attributes: {
        class: "journal-layout journal-prose min-h-56 px-4 py-4 outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      // Adaptation layer: the AI panel highlights the selection with the
      // `ai-highlight` mark (Novel behaviour). Novel never persists its document,
      // but this editor autosaves after 5 s — a highlight-only transaction would
      // then mark the entry dirty, persist the mark into `contentJson`/
      // `contentHtml`, and reset the editor (collapsing the selection and closing
      // the panel mid-stream). Strip the mark before it reaches persistence and
      // skip the emission when nothing else changed.
      const json = stripAIHighlight(current.getJSON() as { type?: string }) as JsonObject;
      const signature = JSON.stringify(json);
      if (signature === lastEmittedRef.current) return;
      lastEmittedRef.current = signature;
      onChange({
        contentJson: json,
        contentHtml: stripAIHighlightHtml(current.getHTML()),
        text: current.getText(),
      });
    },
    onDestroy: () => {
      imageUploadAbortRef.current?.abort();
      galleryUploadAbortRef.current?.abort();
    },
  });

  // Baseline for "did the document really change": the editor's own JSON, not the
  // `contentJson` prop, because parsing the prop fills in default attributes.
  useEffect(() => {
    if (!editor) return;
    lastEmittedRef.current = JSON.stringify(
      stripAIHighlight(editor.getJSON() as { type?: string }),
    );
  }, [editor]);

  function applyLink() {
    if (!editor) return;
    const href = linkUrl.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkUrl("");
    setLinkOpen(false);
  }

  async function handleImageFile(file: File) {
    if (!editor) return;
    if (!workspaceId) {
      setImageError("无法确定所属工作区，暂时不能上传图片。");
      return;
    }

    imageUploadAbortRef.current?.abort();
    const controller = new AbortController();
    imageUploadAbortRef.current = controller;
    setImageError(null);
    setImageUploading(true);

    try {
      const media = await uploadJournalImage({
        workspaceId,
        tripId,
        file,
        signal: controller.signal,
        client: imageUploadClient,
      });
      if (controller.signal.aborted || editor.isDestroyed) return;
      const src = media.url;
      if (!src) {
        throw new Error("图片已上传，但服务器没有返回可访问的地址。");
      }
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: { src, alt: file.name, mediaId: media.id },
        })
        .run();
    } catch (error) {
      if (controller.signal.aborted) return;
      setImageError(journalImageUploadErrorMessage(error));
    } finally {
      if (imageUploadAbortRef.current === controller) {
        imageUploadAbortRef.current = null;
      }
      setImageUploading(false);
    }
  }

  async function handleGalleryFiles(files: File[]) {
    if (!editor || files.length === 0) return;
    if (!workspaceId) {
      setGalleryError("无法确定所属工作区，暂时不能上传图片。");
      return;
    }

    galleryUploadAbortRef.current?.abort();
    const controller = new AbortController();
    galleryUploadAbortRef.current = controller;
    setGalleryError(null);
    setGalleryUploadingCount(files.length);

    try {
      const uploads = await uploadGalleryImages(files, controller.signal);
      if (controller.signal.aborted || editor.isDestroyed) return;

      const images = uploads.map((upload) => {
        const attrs = galleryImageAttrsFromUpload(upload);
        if (!attrs) {
          throw new Error("图片上传结果不完整，请重试。");
        }
        return attrs;
      });

      editor
        .chain()
        .focus()
        .insertContent({
          type: "gallery",
          attrs: { columns: GALLERY_DEFAULT_COLUMNS },
          content: images.map((attrs) => ({ type: "galleryImage", attrs })),
        })
        .run();
    } catch (error) {
      if (controller.signal.aborted) return;
      setGalleryError(journalImageUploadErrorMessage(error));
    } finally {
      if (galleryUploadAbortRef.current === controller) {
        galleryUploadAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setGalleryUploadingCount(null);
      }
    }
  }

  if (!editor) {
    return (
      <div className="rounded-card border border-hairline-strong bg-surface-1 p-4 text-sm text-muted">
        正在准备编辑器…
      </div>
    );
  }

  const selectedText =
    editor.state.selection.empty || readOnly
      ? ""
      : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n");
  const aiBlockReason = aiRewrite
    ? rewriteBlockReason({
        text: selectedText,
        readOnly,
        workspaceId: aiRewrite.workspaceId,
      })
    : "read_only";
  const aiBlockMessage = rewriteBlockMessage(aiBlockReason);

  return (
    <div className={className}>
      {readOnly ? null : (
        <div
          role="toolbar"
          aria-label="日志格式工具栏"
          className="flex flex-wrap items-center gap-1 border-b border-hairline px-2 py-1.5"
        >
          <ToolbarButton
            label="标题 2"
            pressed={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="正文段落"
            pressed={editor.isActive("paragraph")}
            onClick={() => editor.chain().focus().setParagraph().run()}
          >
            <Pilcrow aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <ToolbarButton
            label="粗体"
            pressed={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="斜体"
            pressed={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="代码块"
            pressed={editor.isActive("codeBlock")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <ToolbarButton
            label="无序列表"
            pressed={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="有序列表"
            pressed={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="任务列表"
            pressed={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListChecks aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="引用"
            pressed={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <ToolbarButton
            label="插入表格"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <TableIcon aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="上方插入行"
            disabled={!editor.can().addRowBefore()}
            onClick={() => editor.chain().focus().addRowBefore().run()}
          >
            <Rows3 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="下方插入行"
            disabled={!editor.can().addRowAfter()}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <Rows3 aria-hidden="true" className="size-4 rotate-180" />
          </ToolbarButton>
          <ToolbarButton
            label="删除当前行"
            disabled={!editor.can().deleteRow()}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="左侧插入列"
            disabled={!editor.can().addColumnBefore()}
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            <Columns3 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="右侧插入列"
            disabled={!editor.can().addColumnAfter()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Columns3 aria-hidden="true" className="size-4 rotate-180" />
          </ToolbarButton>
          <ToolbarButton
            label="删除当前列"
            disabled={!editor.can().deleteColumn()}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <Table2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <JournalColumnsInsertMenu editor={editor} />
          <ToolbarButton
            label={
              galleryUploadingCount === null
                ? "插入图库"
                : `正在上传 ${galleryUploadingCount} 张图片…`
            }
            disabled={galleryUploadingCount !== null}
            onClick={() => {
              if (!workspaceId) {
                setGalleryError("无法确定所属工作区，暂时不能上传图片。");
                return;
              }
              setGalleryError(null);
              galleryInputRef.current?.click();
            }}
          >
            {galleryUploadingCount !== null ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Grid3X3 aria-hidden="true" className="size-4" />
            )}
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <ToolbarButton
            label="添加链接"
            pressed={editor.isActive("link")}
            onClick={() => {
              setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
              setLinkOpen((value) => !value);
            }}
          >
            <Link2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="移除链接"
            disabled={!editor.isActive("link")}
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Link2Off aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label={imageUploading ? "正在上传图片" : "插入图片"}
            disabled={imageUploading}
            onClick={() => {
              setImageError(null);
              imageInputRef.current?.click();
            }}
          >
            {imageUploading ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ImagePlus aria-hidden="true" className="size-4" />
            )}
          </ToolbarButton>
          <input
            ref={imageInputRef}
            type="file"
            accept={COVER_ACCEPT_ATTRIBUTE}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleImageFile(file);
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            multiple
            accept={COVER_ACCEPT_ATTRIBUTE}
            className="hidden"
            aria-label="选择图库图片"
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) void handleGalleryFiles(files);
            }}
          />
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
          <ToolbarButton
            label="撤销"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="重做"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          {aiRewrite ? (
            <>
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
              {/*
                Adaptation layer (not Novel): Novel only offers AI from the bubble
                menu, which needs a pointer selection. A persistent toolbar entry
                keeps the feature reachable on touch screens and from the keyboard.
                It stays disabled with the reason in `title` instead of disappearing,
                so an empty-selection user still learns the feature exists.
              */}
              <ToolbarButton
                label="让 AI 改写"
                hint={aiBlockMessage ?? undefined}
                disabled={aiBlockReason !== null}
                onClick={() => setAiOpen(true)}
              >
                <Sparkles aria-hidden="true" className="size-4" />
              </ToolbarButton>
            </>
          ) : null}
        </div>
      )}

      {imageUploading || imageError || galleryUploadingCount !== null || galleryError ? (
        <div className="border-b border-hairline px-3 py-2 text-xs">
          {imageUploading ? (
            <p role="status" className="text-muted">
              正在上传图片…
            </p>
          ) : null}
          {galleryUploadingCount !== null ? (
            <p role="status" className="text-muted">
              正在上传 {galleryUploadingCount} 张图片…
            </p>
          ) : null}
          {imageError ? (
            <p role="alert" className="text-accent-red">
              {imageError}
            </p>
          ) : null}
          {galleryError ? (
            <p role="alert" className="text-accent-red">
              {galleryError}
            </p>
          ) : null}
        </div>
      ) : null}

      {linkOpen && !readOnly ? (
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-2 px-3 py-2">
          <Input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://…"
            aria-label="链接地址"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={applyLink}>
            应用
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
            取消
          </Button>
        </div>
      ) : null}

      {aiRewrite?.workspaceId && !readOnly ? (
        <GenerativeMenuSwitch
          editor={editor}
          open={aiOpen}
          onOpenChange={setAiOpen}
          workspaceId={aiRewrite.workspaceId}
          tripId={aiRewrite.tripId ?? undefined}
          locale={aiRewrite.locale}
          onApplied={aiRewrite.onApplied}
        />
      ) : null}

      {!readOnly ? <JournalColumnsBubble editor={editor} /> : null}

      <EditorContent
        editor={editor}
        className="[&_.journal-prose]:relative [&_.journal-prose]:outline-none [&_.journal-prose_p.is-editor-empty:first-child::before]:pointer-events-none [&_.journal-prose_p.is-editor-empty:first-child::before]:float-left [&_.journal-prose_p.is-editor-empty:first-child::before]:h-0 [&_.journal-prose_p.is-editor-empty:first-child::before]:text-stone [&_.journal-prose_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
