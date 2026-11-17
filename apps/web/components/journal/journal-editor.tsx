"use client";

import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import type { JsonObject } from "@roamlog/contracts";
import { Button, Input } from "@roamlog/ui";

const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#111113"/><path d="M0 0h960v540H0z" fill="none" stroke="#2a2a2e"/><text x="480" y="260" fill="#8b8b90" font-family="monospace" font-size="22" text-anchor="middle">IMAGE PLACEHOLDER</text><text x="480" y="292" fill="#5e5e64" font-family="monospace" font-size="13" text-anchor="middle">replace with an uploaded photo</text></svg>',
  );

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
}: JournalEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
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
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder }),
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
            label="引用"
            pressed={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote aria-hidden="true" className="size-4" />
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
            label="插入图片占位"
            onClick={() =>
              editor
                .chain()
                .focus()
                .setImage({ src: IMAGE_PLACEHOLDER, alt: "图片占位" })
                .run()
            }
          >
            <ImagePlus aria-hidden="true" className="size-4" />
          </ToolbarButton>
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
        </div>
      )}

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
        className="[&_.journal-prose]:relative [&_.journal-prose]:outline-none [&_.journal-prose_p.is-editor-empty:first-child::before]:pointer-events-none [&_.journal-prose_p.is-editor-empty:first-child::before]:float-left [&_.journal-prose_p.is-editor-empty:first-child::before]:h-0 [&_.journal-prose_p.is-editor-empty:first-child::before]:text-stone [&_.journal-prose_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.journal-prose_h2]:mt-5 [&_.journal-prose_h2]:font-serif [&_.journal-prose_h2]:text-2xl [&_.journal-prose_h2]:tracking-[-0.02em] [&_.journal-prose_h2]:text-ink [&_.journal-prose_h3]:mt-4 [&_.journal-prose_h3]:font-serif [&_.journal-prose_h3]:text-xl [&_.journal-prose_h3]:text-ink [&_.journal-prose_p]:my-2 [&_.journal-prose_ul]:my-2 [&_.journal-prose_ul]:list-disc [&_.journal-prose_ul]:pl-5 [&_.journal-prose_ol]:my-2 [&_.journal-prose_ol]:list-decimal [&_.journal-prose_ol]:pl-5 [&_.journal-prose_blockquote]:my-3 [&_.journal-prose_blockquote]:border-l-2 [&_.journal-prose_blockquote]:border-hairline-strong [&_.journal-prose_blockquote]:pl-4 [&_.journal-prose_blockquote]:text-muted [&_.journal-prose_pre]:my-3 [&_.journal-prose_pre]:overflow-x-auto [&_.journal-prose_pre]:rounded-control [&_.journal-prose_pre]:border [&_.journal-prose_pre]:border-hairline [&_.journal-prose_pre]:bg-black/40 [&_.journal-prose_pre]:p-3 [&_.journal-prose_pre]:font-mono [&_.journal-prose_pre]:text-xs [&_.journal-prose_a]:text-accent-blue [&_.journal-prose_a]:underline [&_.journal-prose_img]:my-3 [&_.journal-prose_img]:max-w-full [&_.journal-prose_img]:rounded-control [&_.journal-prose_img]:border [&_.journal-prose_img]:border-hairline"
      />
    </div>
  );
}
