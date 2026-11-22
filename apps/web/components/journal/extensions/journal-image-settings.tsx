"use client";

import { Button, Checkbox, Input, Label } from "@roamlog/ui";
import { Link2Off } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { JournalImageAttributes } from "./journal-image";

const MAX_TEXT_LENGTH = 280;

export interface JournalImageSettingsValues {
  alt: string;
  title: string;
  caption: string;
  linkHref: string;
  linkBlank: boolean;
  displayWidth: number | null;
  displayHeight: number | null;
}

export interface JournalImageSettingsProps {
  attributes: JournalImageAttributes;
  onApply: (values: JournalImageSettingsValues) => void;
  onClose: () => void;
}

function dimensionInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function dimensionValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Image settings form.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392:
 * - packages/admin/src/components/editor/ImageDetailPanel.tsx:95-315
 *   (alt/caption/title/link/new-window/display-size form and save behavior)
 *
 * Adaptation layer: Roamlog uses its own attribute names (`linkHref`,
 * `linkBlank`, `displayWidth`, `displayHeight`), UI primitives, localized
 * labels, and commits through the image node's sanitizer. The form is a
 * compact popover instead of Emdash's fixed sidebar; replace/preview actions
 * are intentionally outside this slice.
 */
export function JournalImageSettings({ attributes, onApply, onClose }: JournalImageSettingsProps) {
  const id = useId();
  const [alt, setAlt] = useState(attributes.alt);
  const [title, setTitle] = useState(attributes.title ?? "");
  const [caption, setCaption] = useState(attributes.caption ?? "");
  const [linkHref, setLinkHref] = useState(attributes.linkHref ?? "");
  const [linkBlank, setLinkBlank] = useState(Boolean(attributes.linkHref) && attributes.linkBlank);
  const [displayWidth, setDisplayWidth] = useState(dimensionInputValue(attributes.displayWidth));
  const [displayHeight, setDisplayHeight] = useState(dimensionInputValue(attributes.displayHeight));

  const hasLink = linkHref.trim().length > 0;
  const altId = `${id}-alt`;
  const titleId = `${id}-title`;
  const captionId = `${id}-caption`;
  const linkId = `${id}-link`;
  const linkBlankId = `${id}-link-blank`;
  const displayWidthId = `${id}-display-width`;
  const displayHeightId = `${id}-display-height`;

  function handleLinkChange(value: string): void {
    setLinkHref(value);
    if (!value.trim()) setLinkBlank(false);
  }

  function removeLink(): void {
    setLinkHref("");
    setLinkBlank(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    onApply({
      alt,
      title,
      caption,
      linkHref,
      linkBlank: hasLink && linkBlank,
      displayWidth: dimensionValue(displayWidth),
      displayHeight: dimensionValue(displayHeight),
    });
    onClose();
  }

  return (
    <form aria-label="图片设置表单" className="space-y-3" noValidate onSubmit={handleSubmit}>
      <div>
        <h3 className="text-sm font-medium text-ink">图片设置</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted">编辑替代文本、图注、链接和显示尺寸。</p>
      </div>

      <div className="space-y-2.5">
        <div>
          <Label htmlFor={altId}>替代文本</Label>
          <Input
            id={altId}
            aria-label="替代文本"
            value={alt}
            maxLength={MAX_TEXT_LENGTH}
            placeholder="描述图片内容与用途"
            className="h-9 text-xs"
            onChange={(event) => setAlt(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={titleId}>图片标题</Label>
          <Input
            id={titleId}
            aria-label="图片标题"
            value={title}
            maxLength={MAX_TEXT_LENGTH}
            placeholder="悬停时显示的标题（可选）"
            className="h-9 text-xs"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={captionId}>图片说明</Label>
          <Input
            id={captionId}
            aria-label="图片说明"
            value={caption}
            maxLength={MAX_TEXT_LENGTH}
            placeholder="显示在图下的说明（可选）"
            className="h-9 text-xs"
            onChange={(event) => setCaption(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={linkId}>图片链接</Label>
          <Input
            id={linkId}
            aria-label="图片链接"
            type="text"
            inputMode="url"
            dir="ltr"
            value={linkHref}
            placeholder="https://example.com 或 /trips/kyoto"
            className="h-9 font-mono text-xs"
            onChange={(event) => handleLinkChange(event.target.value)}
          />
          <p className="mt-1 text-[10px] leading-4 text-muted">
            支持 http(s)、mailto 或站内 / 路径。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1.5"
            aria-label="移除链接"
            disabled={!hasLink}
            onClick={removeLink}
          >
            <Link2Off aria-hidden="true" className="size-3.5" />
            移除链接
          </Button>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox
              id={linkBlankId}
              aria-label="新窗口打开"
              checked={linkBlank}
              disabled={!hasLink}
              onCheckedChange={(checked) => setLinkBlank(checked === true)}
            />
            <Label
              htmlFor={linkBlankId}
              className="mb-0 text-[11px] normal-case tracking-normal text-body"
            >
              新窗口打开
            </Label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <Label htmlFor={displayWidthId}>显示宽度</Label>
            <Input
              id={displayWidthId}
              aria-label="显示宽度"
              type="number"
              inputMode="numeric"
              min={80}
              max={2400}
              step={1}
              value={displayWidth}
              placeholder="80–2400"
              className="h-9 text-xs tabular-nums"
              onChange={(event) => setDisplayWidth(event.target.value)}
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={displayHeightId}>显示高度</Label>
            <Input
              id={displayHeightId}
              aria-label="显示高度"
              type="number"
              inputMode="numeric"
              min={80}
              max={2400}
              step={1}
              value={displayHeight}
              placeholder="80–2400"
              className="h-9 text-xs tabular-nums"
              onChange={(event) => setDisplayHeight(event.target.value)}
            />
          </div>
        </div>
        <p className="text-[10px] leading-4 text-muted">
          尺寸范围为 80–2400 px，留空使用图片原始尺寸。
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t border-hairline pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="primary" size="sm">
          应用
        </Button>
      </div>
    </form>
  );
}
