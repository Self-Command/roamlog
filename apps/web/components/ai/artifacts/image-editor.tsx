"use client";

import { Button } from "@roamlog/ui";
import { ImageOff, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createCoverMediaClient } from "../../../lib/api/media";

const mediaClient = createCoverMediaClient();

function inlineImageSource(content: string): string | null {
  const value = content.trim();
  if (!value) return null;
  if (
    value.startsWith("data:image/") ||
    value.startsWith("blob:") ||
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("/")
  ) {
    return value;
  }
  // Upstream image artifacts stream raw base64 (`data-imageDelta`).
  return `data:image/png;base64,${value}`;
}

export function ArtifactImageEditor({
  title,
  content,
  mediaId,
}: {
  title: string;
  content: string;
  mediaId: string | null;
}) {
  const fallback = inlineImageSource(content);
  const [src, setSrc] = useState<string | null>(fallback);
  const [loading, setLoading] = useState(Boolean(mediaId));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refreshedOnError = useRef(false);

  useEffect(() => {
    setSrc(fallback);
    refreshedOnError.current = false;
    if (!mediaId) {
      setLoading(false);
      setError(fallback ? null : "这张图片没有可显示的来源。");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    mediaClient
      .fetchMedia(mediaId)
      .then((media) => {
        if (cancelled) return;
        const url = media.url ?? media.thumbUrl;
        if (!url) {
          setError("图片还在处理中，请稍后重试。");
          return;
        }
        setSrc(url);
      })
      .catch(() => {
        if (cancelled) return;
        if (!fallback) setError("图片加载失败，请重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, fallback, mediaId]);

  const onImageError = (): void => {
    if (!mediaId || refreshedOnError.current) {
      setSrc(null);
      setError("图片加载失败，请重试。");
      return;
    }
    refreshedOnError.current = true;
    setAttempt((value) => value + 1);
  };

  if (!src && !loading) {
    return (
      <div
        className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="artifact-image-empty"
        role="status"
      >
        <ImageOff aria-hidden="true" className="size-5 text-stone" />
        <p className="text-sm text-muted">{error ?? "这张图片没有可显示的来源。"}</p>
        {mediaId ? (
          <Button
            onClick={() => setAttempt((value) => value + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            重新加载
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-full items-center justify-center bg-surface-1 p-4 md:p-10"
      data-testid="artifact-image-editor"
    >
      {loading && !src ? (
        <div className="flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          正在加载图片…
        </div>
      ) : src ? (
        <img
          alt={title}
          className="max-h-[calc(100dvh-14rem)] w-auto max-w-full rounded-card border border-hairline object-contain shadow-xl"
          onError={onImageError}
          src={src}
        />
      ) : null}
    </div>
  );
}
