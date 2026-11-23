"use client";

export function ArtifactImageEditor({
  title,
  content,
  mediaId,
}: {
  title: string;
  content: string;
  mediaId: string | null;
}) {
  const src =
    content.startsWith("data:") || content.startsWith("http") || content.startsWith("/")
      ? content
      : `data:image/png;base64,${content}`;

  if (!content.trim() && !mediaId) {
    return (
      <div className="flex min-h-[420px] items-center justify-center px-6 text-sm text-muted">
        这张图片没有可显示的来源。
      </div>
    );
  }

  return (
    <div
      className="flex min-h-full items-center justify-center bg-surface-0 p-4 md:p-10"
      data-testid="artifact-image-editor"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={title}
        className="max-h-[calc(100dvh-14rem)] w-auto max-w-full rounded-card border border-hairline object-contain shadow-xl"
        src={src}
      />
    </div>
  );
}
