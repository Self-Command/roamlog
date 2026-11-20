"use client";

/**
 * Composer attachment pipeline for the AI chat.
 *
 * Porting source: vercel/chatbot `components/chat/multimodal-input.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0)
 *   - `uploadFile` L270–L298 (upload on selection, return
 *     `{ contentType, name, url }`)
 *   - `handleFileChange` L300–L323 (start every upload immediately, keep the
 *     pending queue so the composer can show a spinner)
 *   - `submitForm` L229–L268 (attachments become `file` parts on the user
 *     message before the text part)
 *   - paste handler L326–L380 (clipboard images join the same queue)
 *
 * Adaptation layer (why this cannot be copied verbatim):
 * - Upstream posts to `POST /api/files/upload` (Vercel Blob). Roamlog reuses its
 *   existing media pipeline instead — presign → PUT to the signed URL →
 *   complete — per the task's "不新建上传体系" rule, so this adapter is the
 *   diagram between upstream's `uploadFile` result and
 *   `MediaService`/`lib/api/media.ts`.
 * - The upstream `Attachment` is `{name,url,contentType}`; assistant-ui's is a
 *   pending/complete state machine (`AttachmentAdapter`). `add` starts the
 *   upload and returns the pending state (upstream starts it in
 *   `handleFileChange` too); `send` awaits the already-running upload, which is
 *   upstream's `await Promise.all(uploadPromises)`.
 * - The attachment limits and MIME whitelist come from the contract
 *   (`AI_ATTACHMENT_MAX_BYTES`, `AI_ATTACHMENT_MIME_TYPES`), not from upstream's
 *   image-only `accept`.
 */

import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import {
  AI_ATTACHMENT_MAX_BYTES,
  AI_ATTACHMENT_MAX_COUNT,
  AI_ATTACHMENT_MIME_TYPES,
  type AiAttachment,
  type MediaRead,
} from "@roamlog/contracts";

import { createCoverMediaClient, type CoverMediaClient } from "../../lib/api/media";

/** `accept` attribute for the file picker (task: MIME whitelist, ≤5 files). */
export const AI_ATTACHMENT_ACCEPT = [...AI_ATTACHMENT_MIME_TYPES, ".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".heif"].join(
  ",",
);

/** The one error message the composer surfaces when an upload cannot start. */
export class AiAttachmentError extends Error {
  readonly remedy: string;

  constructor(message: string, remedy: string) {
    super(message);
    this.name = "AiAttachmentError";
    this.remedy = remedy;
  }
}

/**
 * `roamlog` provider metadata carried on the image part.
 *
 * The persisted message content is the only thing that survives a reload
 * (`thread-list-adapter.ts` stores `content`, not `attachments`), so the media
 * id must ride on the part itself. The API uses it for the model content part;
 * the thumbnail component uses it to re-sign an expired URL.
 */
export interface RoamlogImageMetadata {
  readonly mediaId: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly name: string;
  readonly kind: "image";
}

export function readImageMetadata(
  providerMetadata: unknown,
): RoamlogImageMetadata | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object") return undefined;
  const roamlog = (providerMetadata as Record<string, unknown>).roamlog;
  if (!roamlog || typeof roamlog !== "object") return undefined;
  const value = roamlog as Record<string, unknown>;
  if (
    typeof value.mediaId !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    typeof value.name !== "string"
  ) {
    return undefined;
  }
  return {
    mediaId: value.mediaId,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    name: value.name,
    kind: "image",
  };
}

/** How long a freshly completed upload may stay `processing` before we give up. */
const MEDIA_READY_TIMEOUT_MS = 15_000;
/** `complete` is asynchronous by design (variants + thumbnail), so poll. */
const MEDIA_READY_POLL_MS = 500;

/**
 * Waits for `status: "ready"` **and** a signed URL.
 *
 * The media pipeline signs variants asynchronously; a client that reads the
 * read-URL immediately after `complete` races that job. Returns the last read
 * (status included) on timeout so the caller can say *why* it failed.
 */
async function waitForReadableMedia(read: () => Promise<MediaRead>): Promise<MediaRead> {
  const deadline = Date.now() + MEDIA_READY_TIMEOUT_MS;
  let latest = await read();
  while ((latest.status !== "ready" || (!latest.url && !latest.thumbUrl)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MEDIA_READY_POLL_MS));
    latest = await read();
  }
  return latest;
}

export interface MediaAttachmentAdapterOptions {
  workspaceId: string;
  /** Injectable for unit tests; defaults to the real media client. */
  client?: Pick<CoverMediaClient, "presign" | "putObject" | "complete" | "fetchMedia">;
}

export function createMediaAttachmentAdapter({
  workspaceId,
  client,
}: MediaAttachmentAdapterOptions): AttachmentAdapter & {
  /** The last upload failure, so the composer can show a real message. */
  lastError(): AiAttachmentError | null;
  clearLastError(): void;
} {
  const media = client ?? createCoverMediaClient();
  /** Random composer id → the upload already in flight (upstream's queue). */
  const uploads = new Map<string, Promise<CompleteAttachment>>();
  /** Random composer id → the media row, so `remove` can delete it. */
  const mediaIds = new Map<string, string>();
  let lastError: AiAttachmentError | null = null;

  function validate(file: File): void {
    if (!(AI_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw new AiAttachmentError(
        `不支持的文件类型：${file.type || "未知"}`,
        "只支持 JPG、PNG、WebP、AVIF、HEIC 图片。",
      );
    }
    if (file.size <= 0 || file.size > AI_ATTACHMENT_MAX_BYTES) {
      throw new AiAttachmentError(
        `文件太大：${Math.ceil(file.size / 1024 / 1024)} MB`,
        "单张图片不能超过 20 MB。",
      );
    }
  }

  /** Upstream `uploadFile` L270–L298, rewritten onto the media pipeline. */
  async function upload(file: File, id: string): Promise<CompleteAttachment> {
    const presign = await media.presign(workspaceId, {
      fileName: file.name.slice(0, 255),
      mimeType: file.type as (typeof AI_ATTACHMENT_MIME_TYPES)[number],
      size: file.size,
    });
    await media.putObject({
      url: presign.uploadUrl,
      headers: presign.headers,
      file,
    });
    const media_ = await media.complete(presign.mediaId, { size: file.size });
    // `complete` only marks the row `processing`; the variants/thumbnail are built
// by the media worker, and `MediaRead.url` stays `null` until the row is `ready`
// (`apps/api/src/modules/media/media.service.ts` L193). Reading the URL straight
// after `complete` is therefore a race even in production, so poll briefly.
    const read = await waitForReadableMedia(() => media.fetchMedia(media_.id));
    const url = read.url ?? read.thumbUrl;
    if (!url) {
      throw new AiAttachmentError(
        read.status === "ready"
          ? "上传完成但无法生成预览地址。"
          : "图片还在处理中，请稍后重试。",
        read.status === "ready" ? "请重新选择图片。" : "服务器的图片处理还没有完成。",
      );
    }
    mediaIds.set(id, read.id);

    return {
      id,
      type: "image",
      name: file.name,
      contentType: file.type,
      status: { type: "complete" },
      content: [
        {
          type: "image",
          id: read.id,
          image: url,
          filename: file.name,
          // A plain object literal, not the `RoamlogImageMetadata` interface:
          // assistant-ui types this field as `ReadonlyJSONObject`, and an
          // interface has no implicit index signature. `readImageMetadata`
          // re-validates it when the part is read back.
          providerMetadata: {
            roamlog: {
              mediaId: read.id,
              mimeType: file.type,
              sizeBytes: file.size,
              name: file.name,
              kind: "image",
            },
          },
        },
      ],
    };
  }

  const adapter = {
    accept: AI_ATTACHMENT_ACCEPT,

    async *add({ file }: { file: File }): AsyncGenerator<PendingAttachment, void, void> {
      validate(file);
      lastError = null;
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const pending = {
        id,
        type: "image" as const,
        name: file.name,
        contentType: file.type,
        file,
      };

      console.info(`[attach-debug] add start id=${id} type=${file.type} size=${file.size}`);
      // 1. Upload starts now (upstream `handleFileChange`), not at submit.
      yield { ...pending, status: { type: "running", reason: "uploading", progress: 0 } };

      const running = upload(file, id);
      uploads.set(id, running);

      // 2. The bytes are in object storage and the media row is complete: the
      //    composer should stop showing a spinner and wait for the user to send
      //    (`requires-action` / `composer-send` is assistant-ui's exact state for
      //    that). Yielding it is how `AttachmentAdapter.add` reports progress —
      //    see `drainAttachmentAdd` in
      //    `@assistant-ui/core/dist/runtime/base/base-composer-runtime-core.js` L535.
      try {
        // The upload finished, so the attachment is genuinely complete: yield the
        // completed object (status `complete` + its image part). assistant-ui's
        // `add` generator is documented as yielding pending states only, but the
        // runtime keys off `status.type` — a `complete` yield makes the composer
        // treat the attachment as ready (`send()` then skips `adapter.send`, whose
        // result the runtime drops for attachments it considers removed). Yielding
        // `requires-action` here produced a text-only message: the image part never
        // reached `message.content`, so it was neither rendered nor sent to the API.
        const completed = await running;
        console.info(`[attach-debug] add upload done id=${id}`);
        yield completed as unknown as PendingAttachment;
      } catch (error) {
        lastError =
          error instanceof AiAttachmentError
            ? error
            : new AiAttachmentError("图片上传失败。", "检查网络后重试。");
        yield {
          ...pending,
          status: {
            type: "incomplete",
            reason: "error",
            message: lastError.message,
          },
        };
        throw lastError;
      }
    },

    async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
      console.info(`[attach-debug] send id=${attachment.id} status=${attachment.status.type} cached=${uploads.has(attachment.id)}`);
      const pending = uploads.get(attachment.id);
      if (pending) return pending;
      if (!attachment.file) {
        throw new AiAttachmentError("附件已失效。", "请重新选择图片。");
      }
      const retry = upload(attachment.file, attachment.id);
      uploads.set(attachment.id, retry);
      return retry;
    },

    async remove(attachment: { id: string }): Promise<void> {
      console.info(`[attach-debug] remove id=${attachment.id}`);
      uploads.delete(attachment.id);
      // The uploaded object stays in the media library; deleting it here would
      // race a send that is already in flight. Documented as a known risk.
      mediaIds.delete(attachment.id);
    },
  } satisfies AttachmentAdapter;

  return Object.assign(adapter, {
    lastError: () => lastError,
    clearLastError: () => {
      lastError = null;
    },
  });
}

/** The wire form of every image part on one user message (task §Stage 2.3). */
export function attachmentsFromContent(
  content: readonly { type: string; providerMetadata?: unknown }[],
): AiAttachment[] {
  return content.flatMap((part) => {
    if (part.type !== "image") return [];
    const metadata = readImageMetadata(part.providerMetadata);
    if (!metadata) return [];
    return [
      {
        mediaId: metadata.mediaId,
        kind: metadata.kind,
        name: metadata.name.slice(0, 200),
        mimeType: metadata.mimeType as AiAttachment["mimeType"],
        sizeBytes: metadata.sizeBytes,
      },
    ];
  });
}
/**
 * Every attachment reference on one user message, from **both** places
 * assistant-ui can put them:
 *
 * - `message.attachments` while the turn is live (the composer keeps the
 *   complete attachment there, and `MessagePrimitive.Attachments` renders it);
 * - `message.content` after a reload (persisted content carries the image part,
 *   because `thread-list-adapter.upsertMessage` flattens attachments into it).
 *
 * Without the first branch the image never reached the API — the message body
 * looked text-only — and without the second a reloaded turn would forget it.
 */
export function attachmentsFromMessage(message: {
  content?: readonly { type: string; providerMetadata?: unknown }[];
  attachments?: readonly {
    content?: readonly { type: string; providerMetadata?: unknown }[];
  }[];
}): AiAttachment[] {
  const seen = new Set<string>();
  const result: AiAttachment[] = [];
  const push = (metadata: RoamlogImageMetadata | undefined): void => {
    if (!metadata || seen.has(metadata.mediaId) || result.length >= AI_ATTACHMENT_MAX_COUNT) {
      return;
    }
    seen.add(metadata.mediaId);
    result.push({
      mediaId: metadata.mediaId,
      kind: metadata.kind,
      name: metadata.name.slice(0, 200),
      mimeType: metadata.mimeType as AiAttachment["mimeType"],
      sizeBytes: metadata.sizeBytes,
    });
  };

  for (const part of message.content ?? []) {
    if (part.type === "image") push(readImageMetadata(part.providerMetadata));
  }
  for (const attachment of message.attachments ?? []) {
    for (const part of attachment.content ?? []) {
      if (part.type === "image") push(readImageMetadata(part.providerMetadata));
    }
  }
  return result;
}

/**
 * Flattens a message's attachment parts into its `content` before persistence.
 *
 * `thread-list-adapter` stores `content` only, so without this step a reloaded
 * conversation loses its thumbnails (the image part lived in `attachments`).
 */
export function contentWithAttachmentParts(
  content: unknown,
  attachments: readonly { content?: readonly unknown[] }[] | undefined,
): unknown {
  const extra = (attachments ?? []).flatMap((attachment) =>
    (attachment.content ?? []).filter(
      (part) => (part as { type?: unknown }).type !== "text",
    ),
  );
  // No attachment parts: return the value untouched. `ThreadMessageLike.content`
  // may be a plain string, and spreading it would split it into characters.
  if (extra.length === 0) return content;
  const base = Array.isArray(content)
    ? content
    : typeof content === "string" && content.length > 0
      ? [{ type: "text", text: content }]
      : [];
  return [...base, ...extra];
}
