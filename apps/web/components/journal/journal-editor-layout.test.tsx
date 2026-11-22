import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function presignResponse() {
  return {
    mediaId: MEDIA_ID,
    uploadUrl: "https://storage.example.test/signed-put",
    method: "PUT" as const,
    headers: { "content-type": "image/png" },
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function fakeUploadClient() {
  return {
    ...createCoverMediaClient(),
    presign: vi.fn(async () => presignResponse()),
    putObject: vi.fn(async () => {}),
    complete: vi.fn(async () => mediaRecord()),
    fetchMedia: vi.fn(async () => mediaRead()),
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

interface EditorChange {
  contentHtml: string;
  contentJson: {
    content?: {
      type: string;
      attrs?: Record<string, unknown>;
      content?: EditorChange["contentJson"]["content"];
    }[];
  };
}

function lastChange(onChange: ReturnType<typeof vi.fn>): EditorChange | undefined {
  return onChange.mock.calls.at(-1)?.[0] as EditorChange | undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JournalEditor layout integration", () => {
  it("persists mediaId when an inline image upload succeeds", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <JournalEditor
        contentJson={doc}
        onChange={onChange}
        workspaceId={WORKSPACE_ID}
        tripId={TRIP_ID}
        imageUploadClient={fakeUploadClient()}
      />,
    );

    await screen.findByRole("toolbar", { name: "日志格式工具栏" });
    const input = fileInput(container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, { target: { files: [uploadedFile()] } });
    });
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));

    await waitFor(() => {
      const image = lastChange(onChange)?.contentJson.content?.find(
        (node) => node.type === "image",
      );
      expect(image?.attrs?.mediaId).toBe(MEDIA_ID);
    });

    const change = lastChange(onChange);
    expect(change?.contentHtml).toContain(`data-media-id="${MEDIA_ID}"`);
    expect(container.querySelector(`img[data-media-id="${MEDIA_ID}"]`)).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("inserts a two-column layout from the toolbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<JournalEditor contentJson={doc} onChange={onChange} />);

    await user.click(await screen.findByRole("button", { name: "插入多栏" }));
    await user.click(await screen.findByRole("menuitem", { name: "插入 2 栏" }));

    await waitFor(() => {
      const columns = lastChange(onChange)?.contentJson.content?.find(
        (node) => node.type === "columns",
      );
      expect(columns?.attrs?.columns).toBe(2);
      expect(columns?.content).toHaveLength(2);
      expect(columns?.content?.every((node) => node.type === "column")).toBe(true);
    });

    expect(lastChange(onChange)?.contentHtml).toContain('data-type="columns" data-columns="2"');
    const renderedColumns = container.querySelector('[data-type="columns"]');
    expect(renderedColumns).toHaveAttribute("data-columns", "2");
    expect(renderedColumns?.querySelectorAll('[data-type="column"]')).toHaveLength(2);
  });

  it("registers gallery and galleryImage nodes for rendering", async () => {
    const galleryDoc = {
      type: "doc",
      content: [
        {
          type: "gallery",
          attrs: { columns: 3 },
          content: [
            {
              type: "galleryImage",
              attrs: {
                src: SIGNED_URL,
                alt: "锦市场",
                title: null,
                caption: "锦市场的一碗热汤",
                width: 1200,
                height: 800,
                mediaId: MEDIA_ID,
              },
            },
          ],
        },
      ],
    };
    const { container } = render(<JournalEditor contentJson={galleryDoc} onChange={() => {}} />);

    await screen.findByRole("textbox", { name: "日志正文" });
    const gallery = container.querySelector('[data-type="gallery"]');
    expect(gallery).toHaveAttribute("data-columns", "3");
    expect(gallery?.querySelector(`img[src="${SIGNED_URL}"]`)).not.toBeNull();
    expect(screen.getByAltText("锦市场")).toBeInTheDocument();
    expect(screen.getByText("锦市场的一碗热汤")).toBeInTheDocument();
  });
});
