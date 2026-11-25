import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { createCoverMediaClient, type CoverMediaClient } from "@/lib/api/media";

import { JournalEditor, type JournalEditorValue } from "./journal-editor";

const WORKSPACE_ID = "0193f6a0-7c00-7000-8000-000000000010";
const TRIP_ID = "0193f6a0-7c00-7000-8000-000000000011";
const MEDIA_IDS = [
  "0193f6a0-7c00-7000-8000-000000000021",
  "0193f6a0-7c00-7000-8000-000000000022",
] as const;

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "今天" }] }],
};

type JournalChange = {
  contentHtml: string;
  contentJson: {
    content?: Array<{
      type: string;
      attrs?: Record<string, unknown>;
      content?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    }>;
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedUrl(mediaId: string): string {
  return `https://signed-media.example.test/tenant/journal/${mediaId}.png?X-Amz-Expires=900&X-Amz-Signature=test`;
}

function mediaRecord(mediaId: string) {
  return {
    id: mediaId,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: "0193f6a0-7c00-7000-8000-000000000030",
    bucket: "roamlog-test",
    key: `workspaces/${WORKSPACE_ID}/media/${mediaId}/original.png`,
    mimeType: "image/png",
    size: 8,
    width: 640,
    height: 480,
    blurhash: null,
    variants: {},
    status: "ready" as const,
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    deletedAt: null,
  };
}

function mediaRead(mediaId: string) {
  const { bucket: _bucket, key: _key, variants: _variants, ...rest } = mediaRecord(mediaId);
  return {
    ...rest,
    url: signedUrl(mediaId),
    thumbUrl: signedUrl(mediaId),
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function galleryFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]');
  if (!input) throw new Error("expected the gallery file picker to render");
  return input;
}

function uploadedFile(name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function installUploadFetch(options: { failPresignAt?: number } = {}) {
  let presignCount = 0;
  let completeCount = 0;
  const presignBodies: Array<Record<string, unknown>> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/media/presign")) {
      presignCount += 1;
      presignBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (options.failPresignAt === presignCount) {
        return jsonResponse(
          { status: 500, code: "INTERNAL_ERROR", title: "Internal Server Error" },
          500,
        );
      }
      const mediaId = MEDIA_IDS[presignCount - 1] ?? MEDIA_IDS[0];
      return jsonResponse({
        mediaId,
        uploadUrl: `https://storage.example.test/signed-put/${presignCount}`,
        method: "PUT" as const,
        headers: { "content-type": "image/png" },
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    }

    if (url.endsWith("/complete")) {
      const mediaId = MEDIA_IDS[completeCount] ?? MEDIA_IDS[0];
      completeCount += 1;
      return jsonResponse(mediaRecord(mediaId));
    }

    const mediaId = MEDIA_IDS.find((candidate) => url.includes(candidate));
    if (mediaId) return jsonResponse(mediaRead(mediaId));

    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, presignBodies };
}

function deferredPutObject() {
  const resolvers: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const putObject: CoverMediaClient["putObject"] = vi.fn((input) => {
    if (input.signal) signals.push(input.signal);
    return new Promise<void>((resolve, reject) => {
      resolvers.push(resolve);
      input.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("图片上传已取消。", "AbortError")),
        { once: true },
      );
    });
  });

  return { putObject, resolvers, signals };
}

function renderEditor(
  imageUploadClient: CoverMediaClient,
  options: {
    workspaceId?: string | null;
    onChange?: Mock<(value: JournalEditorValue) => void>;
  } = {},
) {
  const onChange = options.onChange ?? vi.fn<(value: JournalEditorValue) => void>();
  const result = render(
    <JournalEditor
      contentJson={doc}
      onChange={onChange}
      workspaceId={options.workspaceId === undefined ? WORKSPACE_ID : options.workspaceId}
      tripId={TRIP_ID}
      imageUploadClient={imageUploadClient}
    />,
  );
  return { ...result, onChange };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("JournalEditor gallery upload", () => {
  it("uploads multiple images sequentially and inserts one 3-column gallery", async () => {
    const { fetchMock, presignBodies } = installUploadFetch();
    const realClient = createCoverMediaClient();
    const { putObject, resolvers } = deferredPutObject();
    const imageUploadClient = { ...realClient, putObject };
    const { container, onChange } = renderEditor(imageUploadClient);

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = galleryFileInput(container);
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain("image/png");

    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图库" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const uploading = await screen.findByRole("button", {
      name: "正在上传 2 张图片…",
    });
    expect(uploading).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在上传 2 张图片…");

    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(presignBodies).toHaveLength(1);
    resolvers[0]!();

    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(presignBodies.map((body) => body.fileName)).toEqual(["one.png", "two.png"]);
    resolvers[1]!();

    await waitFor(() => {
      expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(2);
    });
    expect(container.querySelector('[data-type="gallery"]')).toHaveAttribute(
      "data-columns",
      "3",
    );
    expect(
      Array.from(container.querySelectorAll('figure[data-type="gallery-item"] img')).map(
        (image) => image.getAttribute("data-media-id"),
      ),
    ).toEqual([...MEDIA_IDS]);
    expect(fetchMock).toHaveBeenCalled();

    const lastChange = onChange.mock.calls.at(-1)?.[0] as JournalChange | undefined;
    const gallery = lastChange?.contentJson.content?.find((node) => node.type === "gallery");
    expect(gallery?.attrs?.columns).toBe(3);
    expect(gallery?.content?.map((image) => image.attrs?.mediaId)).toEqual([...MEDIA_IDS]);
    expect(gallery?.content?.map((image) => image.attrs?.alt)).toEqual(["one.png", "two.png"]);
    expect(gallery?.content?.map((image) => image.attrs?.width)).toEqual([640, 640]);
    expect(gallery?.content?.map((image) => image.attrs?.height)).toEqual([480, 480]);
    expect(lastChange?.contentHtml).toContain(`data-media-id="${MEDIA_IDS[0]}"`);
    expect(lastChange?.contentHtml).toContain(`data-media-id="${MEDIA_IDS[1]}"`);
    expect(lastChange?.contentHtml).not.toContain("blob:");
    expect(lastChange?.contentHtml).not.toContain("data:image");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => {
      expect(container.querySelector('[data-type="gallery"]')).toBeNull();
    });
  });

  it("does not insert a partial gallery when any upload fails", async () => {
    installUploadFetch({ failPresignAt: 2 });
    const realClient = createCoverMediaClient();
    const imageUploadClient = { ...realClient, putObject: vi.fn(async () => {}) };
    const { container, onChange } = renderEditor(imageUploadClient);

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = galleryFileInput(container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图库" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("图片服务暂时不可用");
    expect(container.querySelector('[data-type="gallery"]')).toBeNull();

    const changedJson = onChange.mock.calls
      .map((call) => JSON.stringify((call[0] as JournalChange).contentJson))
      .join("");
    expect(changedJson).not.toContain('"type":"gallery"');
  });

  it("reports a missing workspace without opening the picker or calling upload", async () => {
    const { fetchMock } = installUploadFetch();
    const realClient = createCoverMediaClient();
    const imageUploadClient = { ...realClient, putObject: vi.fn(async () => {}) };
    const { container } = renderEditor(imageUploadClient, { workspaceId: null });

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = galleryFileInput(container);
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "插入图库" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法确定所属工作区");
    expect(clickSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight upload on unmount and inserts nothing", async () => {
    installUploadFetch();
    const realClient = createCoverMediaClient();
    const { putObject, resolvers, signals } = deferredPutObject();
    const imageUploadClient = { ...realClient, putObject };
    const onChange = vi.fn<(value: JournalEditorValue) => void>();
    const { container, unmount } = renderEditor(imageUploadClient, { onChange });

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = galleryFileInput(container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图库" }));

    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);

    unmount();
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });
    const changedHtml = onChange.mock.calls
      .map((call) => (call[0] as JournalChange).contentHtml ?? "")
      .join("");
    expect(changedHtml).not.toContain('data-type="gallery"');
  });
});
