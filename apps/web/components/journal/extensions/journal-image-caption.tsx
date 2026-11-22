"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from "react";

const CAPTION_MAX_LENGTH = 280;

export interface JournalImageCaptionProps {
  caption: string | null;
  onChange: (caption: string | null) => void;
}

/**
 * Inline image caption editor.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392
 * (MIT), packages/admin/src/components/editor/ImageNode.tsx:303-332:
 * one-line textarea, transparent styling, placeholder and attribute updates.
 *
 * Adaptation layer: the draft stays local while focused so a trailing space is
 * not immediately trimmed by the attribute sanitizer and the caret does not
 * jump; blank drafts become `null` and serialization still omits figcaption.
 */
export function JournalImageCaption({ caption, onChange }: JournalImageCaptionProps) {
  const [draft, setDraft] = useState(caption ?? "");
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(caption ?? "");
  }, [caption]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const next = event.currentTarget.value.slice(0, CAPTION_MAX_LENGTH);
    setDraft(next);
    onChange(next.trim() ? next : null);
  }

  function handleFocus(): void {
    focusedRef.current = true;
  }

  function handleBlur(event: FocusEvent<HTMLTextAreaElement>): void {
    focusedRef.current = false;
    if (!event.currentTarget.value.trim()) {
      setDraft("");
      onChange(null);
    }
  }

  return (
    <textarea
      aria-label="图片图注"
      data-image-caption-editor=""
      rows={1}
      maxLength={CAPTION_MAX_LENGTH}
      value={draft}
      placeholder="添加图注…"
      spellCheck
      className="mt-2 block w-full resize-none overflow-hidden rounded-[4px] border-0 bg-transparent px-0 py-0 text-center text-[13px] leading-5 text-muted outline-none [field-sizing:content] placeholder:text-stone focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
