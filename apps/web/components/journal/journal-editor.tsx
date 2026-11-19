"use client";

import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Columns3,
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
  Table as TableIcon,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { JsonObject } from "@roamlog/contracts";
import { Button, Input } from "@roamlog/ui";

import { COVER_ACCEPT_ATTRIBUTE, type CoverMediaClient } from "@/lib/api/media";

import { JournalAiRewrite, type JournalAiRewriteProps } from "./journal-ai-rewrite";
import {
  journalImageUploadErrorMessage,
  uploadJournalImage,
} from "./journal-image-upload";

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
   * The AI rewrite entry, rendered at the end of the formatting toolbar. The
   * editor owns the instance, so the control receives it here instead of the
   * sheet having to thread a ref.
   */
  aiRewrite?: Omit<JournalAiRewriteProps, "editor">;
  /** Workspace that owns the uploaded media (presign is workspace-scoped). */
  workspaceId?: string | null;
  /** Optional trip association for the uploaded media row. */
  tripId?: string | null;
  /** Test seam; production uses the generated media client. */
  imageUploadClient?: CoverMediaClient;
}

interface ToolbarButtonProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({
  label,
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
      title={label}
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
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageUploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      imageUploadAbortRef.current?.abort();
      imageUploadAbortRef.current = null;
    };
  }, []);
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
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
      // Ported from https://tiptap.dev/docs/editor/extensions/nodes/table (+ /table-row, /table-header, /table-cell).
      Table.configure({ resizable: false, allowTableNodeSelection: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Ported from https://tiptap.dev/docs/editor/extensions/nodes/task-list and /task-item.
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: {
        class:
          "journal-prose min-h-56 px-4 py-4 text-[14px] leading-7 text-body outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange({
        contentJson: current.getJSON() as JsonObject,
        contentHtml: current.getHTML(),
        text: current.getText(),
      });
    },
  });

  function applyLink() {
    if (!editor) return;
    const href = linkUrl.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href })
        .run();
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
        .insertContent({ type: "image", attrs: { src, alt: file.name } })
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

  if (!editor) {
    return (
      <div className="rounded-card border border-hairline-strong bg-surface-1 p-4 text-sm text-muted">
        正在准备编辑器…
      </div>
    );
  }

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
              <JournalAiRewrite editor={editor} {...aiRewrite} />
            </>
          ) : null}
        </div>
      )}

      {imageUploading || imageError ? (
        <div className="border-b border-hairline px-3 py-2 text-xs">
          {imageUploading ? (
            <p role="status" className="text-muted">
              正在上传图片…
            </p>
          ) : null}
          {imageError ? (
            <p role="alert" className="text-accent-red">
              {imageError}
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

      <EditorContent
        editor={editor}
        className="[&_.journal-prose]:relative [&_.journal-prose]:outline-none [&_.journal-prose_p.is-editor-empty:first-child::before]:pointer-events-none [&_.journal-prose_p.is-editor-empty:first-child::before]:float-left [&_.journal-prose_p.is-editor-empty:first-child::before]:h-0 [&_.journal-prose_p.is-editor-empty:first-child::before]:text-stone [&_.journal-prose_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.journal-prose_h2]:mt-5 [&_.journal-prose_h2]:font-serif [&_.journal-prose_h2]:text-2xl [&_.journal-prose_h2]:tracking-[-0.02em] [&_.journal-prose_h2]:text-ink [&_.journal-prose_h3]:mt-4 [&_.journal-prose_h3]:font-serif [&_.journal-prose_h3]:text-xl [&_.journal-prose_h3]:text-ink [&_.journal-prose_p]:my-2 [&_.journal-prose_ul]:my-2 [&_.journal-prose_ul]:list-disc [&_.journal-prose_ul]:pl-5 [&_.journal-prose_table]:my-3 [&_.journal-prose_table]:w-full [&_.journal-prose_table]:table-fixed [&_.journal-prose_table]:overflow-hidden [&_.journal-prose_table]:rounded-control [&_.journal-prose_table]:border [&_.journal-prose_table]:border-hairline-strong [&_.journal-prose_th]:border [&_.journal-prose_th]:border-hairline [&_.journal-prose_th]:bg-surface-2 [&_.journal-prose_th]:px-3 [&_.journal-prose_th]:py-2 [&_.journal-prose_th]:text-left [&_.journal-prose_th]:align-top [&_.journal-prose_th]:text-[13px] [&_.journal-prose_th]:font-medium [&_.journal-prose_th]:text-ink [&_.journal-prose_td]:border [&_.journal-prose_td]:border-hairline [&_.journal-prose_td]:px-3 [&_.journal-prose_td]:py-2 [&_.journal-prose_td]:align-top [&_.journal-prose_td]:text-body [&_.journal-prose_.selectedCell]:bg-accent-blue\/10 [&_.journal-prose_.tableWrapper]:my-3 [&_.journal-prose_.tableWrapper]:overflow-x-auto [&_.journal-prose_ul[data-type=taskList]]:my-2 [&_.journal-prose_ul[data-type=taskList]]:list-none [&_.journal-prose_ul[data-type=taskList]]:pl-0 [&_.journal-prose_li[data-checked]]:my-1 [&_.journal-prose_li[data-checked]]:flex [&_.journal-prose_li[data-checked]]:items-start [&_.journal-prose_li[data-checked]]:gap-2 [&_.journal-prose_li[data-type=taskItem]>label]:mt-[3px] [&_.journal-prose_li[data-type=taskItem]>label]:flex [&_.journal-prose_li[data-type=taskItem]>label]:shrink-0 [&_.journal-prose_li[data-type=taskItem]>label]:items-center [&_.journal-prose_li[data-type=taskItem]>div]:min-w-0 [&_.journal-prose_li[data-type=taskItem]>div]:flex-1 [&_.journal-prose_li[data-type=taskItem]_p]:my-0 [&_.journal-prose_li[data-type=taskItem]_input[type=checkbox]]:size-[15px] [&_.journal-prose_li[data-type=taskItem]_input[type=checkbox]]:cursor-pointer [&_.journal-prose_li[data-type=taskItem]_input[type=checkbox]]:accent-accent-blue [&_.journal-prose_li[data-checked=true]>div]:text-stone [&_.journal-prose_li[data-checked=true]>div]:line-through [&_.journal-prose_ol]:my-2 [&_.journal-prose_ol]:list-decimal [&_.journal-prose_ol]:pl-5 [&_.journal-prose_blockquote]:my-3 [&_.journal-prose_blockquote]:border-l-2 [&_.journal-prose_blockquote]:border-hairline-strong [&_.journal-prose_blockquote]:pl-4 [&_.journal-prose_blockquote]:text-muted [&_.journal-prose_pre]:my-3 [&_.journal-prose_pre]:overflow-x-auto [&_.journal-prose_pre]:rounded-control [&_.journal-prose_pre]:border [&_.journal-prose_pre]:border-hairline [&_.journal-prose_pre]:bg-black/40 [&_.journal-prose_pre]:p-3 [&_.journal-prose_pre]:font-mono [&_.journal-prose_pre]:text-xs [&_.journal-prose_a]:text-accent-blue [&_.journal-prose_a]:underline [&_.journal-prose_img]:my-3 [&_.journal-prose_img]:max-w-full [&_.journal-prose_img]:rounded-control [&_.journal-prose_img]:border [&_.journal-prose_img]:border-hairline"
      />
    </div>
  );
}
