"use client";

import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "@roamlog/ui";

import type { AiArtifactSuggestion } from "../../../lib/api/ai-artifacts";

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={`flex size-8 items-center justify-center rounded-control border text-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink ${
        pressed ? "border-hairline-strong bg-surface-2 text-ink" : "border-transparent"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function ArtifactTextEditor({
  content,
  editable,
  onSave,
  suggestions,
  onApplySuggestion,
  onResolveSuggestion,
}: {
  content: string;
  editable: boolean;
  onSave: (content: string, debounce?: boolean) => void;
  suggestions: readonly AiArtifactSuggestion[];
  onApplySuggestion: (suggestion: AiArtifactSuggestion) => void;
  onResolveSuggestion: (suggestionId: string, resolved: boolean) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    contentType: "markdown",
    content,
    editable,
    extensions: [StarterKit, Markdown],
    editorProps: {
      attributes: {
        class:
          "artifact-prose min-h-[calc(100dvh-18rem)] px-4 py-6 outline-none md:px-10 md:py-8",
        "aria-label": "Artifact 正文",
      },
    },
    onUpdate: ({ editor: current }) => {
      onSave(current.getMarkdown(), true);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getMarkdown() === content) return;
    editor.commands.setContent(content, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [content, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) {
    return (
      <div className="px-4 py-6 text-sm text-muted" role="status">
        正在准备文档编辑器…
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {editable ? (
        <div
          aria-label="文档格式工具栏"
          className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-hairline bg-surface-0/95 px-2 py-1.5 backdrop-blur"
          role="toolbar"
        >
          <ToolbarButton
            label="标题 2"
            pressed={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="标题 3"
            pressed={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 aria-hidden="true" className="size-4" />
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
            label="删除线"
            pressed={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough aria-hidden="true" className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="代码"
            pressed={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
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
        </div>
      ) : null}

      <div className="flex-1">
        <EditorContent editor={editor} />
      </div>

      {suggestions.length > 0 ? (
        <section
          aria-label="文档建议"
          className="border-t border-hairline bg-surface-1 px-4 py-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="type-eyebrow">建议</p>
            <span className="font-mono text-[9px] text-stone">
              {suggestions.filter((suggestion) => !suggestion.isResolved).length} 待处理
            </span>
          </div>
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li
                className="rounded-control border border-hairline bg-surface-0 px-3 py-2"
                key={suggestion.id}
              >
                <p className="text-xs leading-5 text-body">{suggestion.description}</p>
                <div className="mt-2 grid gap-2 text-[11px] leading-5 md:grid-cols-2">
                  <p className="rounded bg-accent-red/5 px-2 py-1 text-muted line-through">
                    {suggestion.originalText}
                  </p>
                  <p className="rounded bg-accent-green/5 px-2 py-1 text-ink">
                    {suggestion.suggestedText}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    disabled={suggestion.isResolved || !editable}
                    onClick={() => onApplySuggestion(suggestion)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    应用
                  </Button>
                  <Button
                    disabled={suggestion.isResolved}
                    onClick={() => onResolveSuggestion(suggestion.id, true)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    忽略
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
