import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoverMediaClient } from "@/lib/api/media";

import { JournalEditor } from "./journal-editor";

const WORKSPACE_ID = "0190f5a0-1234-7abc-8def-0123456789ab";
const MEDIA_ID = "0190f5a0-1234-7abc-8def-0123456789ac";
const TRIP_ID = "0190f5a0-1234-7abc-8def-0123456789ad";
const SIGNED_URL =
  "https://signed-media.example.test/tenant/journal/photo.png?X-Amz-Expires=900&X-Amz-Signature=test";

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "今天" }] }],
};

const imageDoc = {
  type: "doc",
  content: [
    {
      type: "image",
      attrs: {
        src: "https://media.example.test/old-photo.png",
        alt: "旧照片",
        title: "旧标题",
        caption: "旧图注",
        alignment: "left",
        displayWidth: 320,
        displayHeight: 200,
        linkHref: "https://example.test/journal",
        linkBlank: false,
        mediaId: null,
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mediaRecord() {
  return {
    id: MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: "0190f5a0-1234-7abc-8def-0123456789ae",
    bucket: "roamlog-test",
    key: `workspaces/${WORKSPACE_ID}/media/${MEDIA_ID}/original.png`,
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

function mediaRead() {
  const { bucket: _bucket, key: _key, variants: _variants, ...rest } = mediaRecord();
  return {
    ...rest,
    url: SIGNED_URL,
    thumbUrl: SIGNED_URL.replace("photo.png", "photo-thumb.png"),
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("expected the journal editor file picker to render");
  return input;
}

function uploadedFile(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
}

function presignResponse() {
  return {
    mediaId: MEDIA_ID,
    uploadUrl: "https://storage.example.test/signed-put",
    method: "PUT" as const,
    headers: { "content-type": "image/png" },
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("JournalEditor image upload", () => {
  it("uploads through presign and complete, then inserts the real signed URL", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/media/presign")) return jsonResponse(presignResponse());
      if (url.endsWith("/complete")) return jsonResponse(mediaRecord());
      if (url.includes(`/v1/media/${MEDIA_ID}`)) return jsonResponse(mediaRead());
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let releasePut!: () => void;
    const realClient = createCoverMediaClient();
    const putObject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePut = resolve;
        }),
    );
    const imageUploadClient = { ...realClient, putObject };

    const { container } = render(
      <JournalEditor
        contentJson={doc}
        onChange={onChange}
        workspaceId={WORKSPACE_ID}
        tripId={TRIP_ID}
        imageUploadClient={imageUploadClient}
      />,
    );

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = fileInput(container);
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, { target: { files: [uploadedFile()] } });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const uploading = await screen.findByRole("button", { name: "正在上传图片" });
    expect(uploading).toBeDisabled();

    await waitFor(() => expect(releasePut).not.toBeNull());
    releasePut!();

    await waitFor(() => {
      expect(container.querySelector(`img[src="${SIGNED_URL}"]`)).not.toBeNull();
    });

    const presignCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/media/presign"),
    );
    expect(presignCall).toBeTruthy();
    expect(presignCall?.[1]).toMatchObject({ method: "POST" });
    const presignBody = JSON.parse(String(presignCall?.[1]?.body)) as Record<string, unknown>;
    expect(presignBody).toMatchObject({
      tripId: TRIP_ID,
      fileName: "photo.png",
      mimeType: "image/png",
    });

    const completeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/complete"));
    expect(completeCall).toBeTruthy();
    expect(completeCall?.[1]).toMatchObject({ method: "POST" });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const lastChange = onChange.mock.calls.at(-1)?.[0] as
      | {
          contentHtml: string;
          contentJson: {
            content?: {
              type: string;
              attrs?: Record<string, unknown>;
            }[];
          };
        }
      | undefined;
    expect(lastChange?.contentHtml).toContain(`src="${SIGNED_URL.replaceAll("&", "&amp;")}"`);
    expect(lastChange?.contentHtml).toContain(`data-media-id="${MEDIA_ID}"`);
    expect(
      lastChange?.contentJson.content?.find((node) => node.type === "image")?.attrs?.mediaId,
    ).toBe(MEDIA_ID);
    expect(lastChange?.contentHtml).not.toContain("data:image");
    expect(lastChange?.contentHtml).not.toContain("IMAGE PLACEHOLDER");
  });

  it("shows a readable error and inserts no placeholder when the upload fails", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 500, code: "INTERNAL_ERROR", title: "Internal Server Error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <JournalEditor
        contentJson={doc}
        onChange={onChange}
        workspaceId={WORKSPACE_ID}
        imageUploadClient={createCoverMediaClient()}
      />,
    );

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = fileInput(container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, { target: { files: [uploadedFile()] } });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("服务端暂时不可用");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("IMAGE PLACEHOLDER")).not.toBeInTheDocument();

    const changedHtml = onChange.mock.calls
      .map((call) => (call[0] as { contentHtml?: string }).contentHtml ?? "")
      .join("");
    expect(changedHtml).not.toContain("<img");
  });

  it("replaces an existing image through the editor upload pipeline", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/media/presign")) return jsonResponse(presignResponse());
      if (url.endsWith("/complete")) return jsonResponse(mediaRecord());
      if (url.includes(`/v1/media/${MEDIA_ID}`)) return jsonResponse(mediaRead());
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const realClient = createCoverMediaClient();
    const imageUploadClient = {
      ...realClient,
      putObject: vi.fn(async () => undefined),
    };
    const { container } = render(
      <JournalEditor
        contentJson={imageDoc}
        onChange={onChange}
        workspaceId={WORKSPACE_ID}
        tripId={TRIP_ID}
        imageUploadClient={imageUploadClient}
      />,
    );

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const image = container.querySelector<HTMLImageElement>('figure[data-type="image"] img');
    expect(image).not.toBeNull();
    fireEvent.click(image as HTMLImageElement);
    await screen.findByRole("button", { name: "替换图片" });

    const replaceInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="选择替换图片"]',
    );
    expect(replaceInput).not.toBeNull();
    vi.spyOn(replaceInput as HTMLInputElement, "click").mockImplementation(() => {
      fireEvent.change(replaceInput as HTMLInputElement, {
        target: { files: [uploadedFile()] },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "替换图片" }));

    await waitFor(() => {
      expect(container.querySelector(`img[src="${SIGNED_URL}"]`)).not.toBeNull();
    });

    const lastChange = onChange.mock.calls.at(-1)?.[0] as
      | {
          contentJson: {
            content?: Array<{ type: string; attrs?: Record<string, unknown> }>;
          };
          contentHtml: string;
        }
      | undefined;
    const replacedImage = lastChange?.contentJson.content?.find((node) => node.type === "image");
    expect(replacedImage?.attrs).toMatchObject({
      src: SIGNED_URL,
      mediaId: MEDIA_ID,
      alt: "photo.png",
      caption: null,
      title: null,
      alignment: "left",
      linkHref: "https://example.test/journal",
    });
    expect(lastChange?.contentHtml).toContain(`data-media-id="${MEDIA_ID}"`);
    expect(lastChange?.contentHtml).not.toContain("旧图注");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
