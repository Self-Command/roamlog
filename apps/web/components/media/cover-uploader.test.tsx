import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SignedUrlUploadError, type CoverMediaClient, type PutObjectRequest } from "@/lib/api/media";
import { ImageCompressionError } from "@/lib/image/compress-image";
import {
  COVER_MEDIA_ID,
  COVER_TRIP_ID,
  COVER_WORKSPACE_ID,
  createFakeImageCompressor,
  createFakeMediaClient,
  makeCompressionResult,
  makeCoverTrip,
  makeTripCover,
} from "@/test/cover-upload-doubles";
import { renderWithQuery } from "@/test/query-harness";

import { type CoverChange, CoverUploader, type CoverUploaderProps } from "./cover-uploader";

// The uploader reads the public media policy on every render. Tests must not
// hit the settings endpoint; the default policy keeps the existing assertions
// (25 MB, 2000px) meaningful.
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    useMediaCompressionPolicy: () => actual.MEDIA_COMPRESSION_DEFAULTS,
  };
});

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:local-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function makeImage(name = "cover.jpg", type = "image/jpeg", size = 2_048): File {
  const file = new File(["image-bytes"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderUploader(
  props: Partial<CoverUploaderProps> & { client: CoverMediaClient } = {
    client: createFakeMediaClient().client,
  },
) {
  return renderWithQuery(
    <CoverUploader
      workspaceId={COVER_WORKSPACE_ID}
      pollIntervalMs={1}
      processTimeoutMs={500}
      compressor={createFakeImageCompressor()}
      {...props}
    />,
  );
}

describe("CoverUploader", () => {
  it("renders a truthful empty state with the real server limits", () => {
    const { client } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip() });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("拖拽图片到这里，或")).toBeInTheDocument();
    expect(screen.getByText(/JPEG · PNG · WebP · AVIF · HEIC/)).toBeInTheDocument();
    expect(screen.getByText(/最大 23\.8 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择图片" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("尚未设置封面。");
  });

  it("echoes an existing cover from trip.cover instead of a placeholder", () => {
    const { client } = createFakeMediaClient();
    renderUploader({
      client,
      trip: makeCoverTrip({ cover: makeTripCover(), coverMediaId: COVER_MEDIA_ID }),
    });

    expect(screen.getByRole("img", { name: "当前旅行封面" })).toHaveAttribute(
      "src",
      "https://media.example.test/trips/cover-large.jpg",
    );
    expect(screen.getByRole("button", { name: "替换" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已设置封面，可以替换或移除。");
  });

  it("shows processing state when a cover exists without signed URLs", () => {
    const { client } = createFakeMediaClient();
    renderUploader({
      client,
      trip: makeCoverTrip({
        coverMediaId: COVER_MEDIA_ID,
        cover: makeTripCover({ status: "processing", url: null, thumbUrl: null, expiresAt: null }),
      }),
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("封面正在服务器处理中…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "替换" })).toBeInTheDocument();
  });

  it("rejects an unsupported file with a visible alert and never presigns", async () => {
    // `applyAccept: false` mirrors a drag-and-drop / OS picker that bypasses the
    // input's `accept` hint; the component must reject it itself.
    const user = userEvent.setup({ applyAccept: false });
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip() });

    await user.upload(
      screen.getByLabelText("选择旅行封面"),
      makeImage("cover.gif", "image/gif"),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("只支持 JPEG");
    expect(screen.getByRole("status")).toHaveTextContent("上传失败，请查看错误提示。");
    expect(screen.getByRole("button", { name: "选择其他文件" })).toBeInTheDocument();
    expect(calls.presign).toHaveLength(0);
  });

  it("uploads a dragged file and shows the server-signed cover on success", async () => {
    const onChange = vi.fn<(change: CoverChange) => void>();
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), onChange });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage()], types: ["Files"] },
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("封面已更新。"));

    expect(calls.setCover).toEqual([{ tripId: COVER_TRIP_ID, mediaId: COVER_MEDIA_ID }]);
    expect(calls.presign).toHaveLength(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "uploaded", mediaId: COVER_MEDIA_ID }),
    );
    expect(screen.getByRole("img", { name: "当前旅行封面" })).toHaveAttribute(
      "src",
      "https://media.example.test/trips/cover-large.jpg",
    );
  });

  it("warns when several files are dropped but uploads only the first", async () => {
    const onChange = vi.fn();
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), onChange });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage(), makeImage("second.png", "image/png")], types: ["Files"] },
    });

    expect(screen.getByRole("status")).toHaveTextContent("一次只能上传一张图片");
    await waitFor(() => expect(calls.setCover).toHaveLength(1));
  });

  it("opens the picker from the replace button with the keyboard", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const { client } = createFakeMediaClient();
    renderUploader({
      client,
      trip: makeCoverTrip({ cover: makeTripCover(), coverMediaId: COVER_MEDIA_ID }),
    });

    const replace = screen.getByRole("button", { name: "替换" });
    replace.focus();
    expect(replace).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("removes an existing cover through the versioned trip update", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(change: CoverChange) => void>();
    const { client, calls } = createFakeMediaClient();
    renderUploader({
      client,
      trip: makeCoverTrip({
        version: 3,
        coverMediaId: COVER_MEDIA_ID,
        cover: makeTripCover(),
      }),
      onChange,
    });

    await user.click(screen.getByRole("button", { name: "移除" }));

    await waitFor(() => expect(calls.clearCover).toEqual([
      { tripId: COVER_TRIP_ID, version: 3 },
    ]));
    expect(await screen.findByText("拖拽图片到这里，或")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("封面已移除。");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", cover: null }),
    );
  });

  it("surfaces a storage failure with a retry action and keeps the selected file", async () => {
    const user = userEvent.setup();
    const putObject = vi.fn(async () => {
      throw new SignedUrlUploadError("http", "对象存储拒绝了上传（HTTP 413）。", 413);
    });
    const { client } = createFakeMediaClient({ putObject });
    renderUploader({ client, trip: makeCoverTrip() });

    await user.upload(screen.getByLabelText("选择旅行封面"), makeImage());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "对象存储拒绝了该文件：超过 25 MB 上限。",
    );
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择其他文件" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /待上传图片预览/ })).toBeInTheDocument();
  });

  it("announces real upload progress in the live region", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const putObject = vi.fn(async (request: PutObjectRequest) => {
      request.onProgress?.(50, 100);
      await gate;
    });
    const { client } = createFakeMediaClient({ putObject });
    renderUploader({ client, trip: makeCoverTrip() });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage()], types: ["Files"] },
    });

    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "上传进度" })).toHaveAttribute(
        "aria-valuenow",
        "55",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在上传 50%");

    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("封面已更新。"));
  });

  it("falls back to a factual notice when the browser cannot preview the format", async () => {
    const { client } = createFakeMediaClient();
    renderUploader({ client });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage("IMG_0001.HEIC", "image/heic")], types: ["Files"] },
    });

    const preview = await screen.findByRole("img", {
      name: "待上传图片预览：IMG_0001.HEIC",
    });
    fireEvent.error(preview);

    expect(await screen.findByText(/浏览器无法预览此格式/)).toBeInTheDocument();
    expect(screen.getByText(/上传时会尝试转换为 WebP/)).toBeInTheDocument();
  });

  it("announces compression in the live region before upload", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compressor = vi.fn(
      async (file: File, options: { onProgress?: (progress: {
        percent: number;
        stage: "encoding";
        iteration: number;
        quality: number;
      }) => void } = {}) => {
        options.onProgress?.({
          percent: 50,
          stage: "encoding",
          iteration: 1,
          quality: 0.82,
        });
        await gate;
        return makeCompressionResult({ originalBytes: file.size });
      },
    );
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), compressor });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage()], types: ["Files"] },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在压缩图片…"),
    );
    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "图片压缩进度" })).toHaveAttribute(
        "aria-valuenow",
        "10",
      ),
    );

    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("封面已更新。"));
    expect(calls.presign).toHaveLength(1);
  });

  it("shows a readable HEIC decode failure and offers a retry", async () => {
    const compressor = vi.fn(async () => {
      throw new ImageCompressionError(
        "DECODE_FAILED",
        "该格式浏览器无法解码（HEIC/HEIF）。请先转换为 JPEG 或 PNG 后重试。",
      );
    });
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), compressor });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage("IMG_0001.HEIC", "image/heic")], types: ["Files"] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("该格式浏览器无法解码");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(calls.presign).toHaveLength(0);
  });

  it("renders the photo preset with its own label and accessible names", () => {
    const { client } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), size: "photo" });

    expect(screen.getByRole("heading", { name: "照片" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "旅行照片" })).toBeInTheDocument();
    expect(screen.getByLabelText("选择旅行照片")).toBeInTheDocument();
  });

  it("ignores input and drag while disabled", () => {
    const onChange = vi.fn();
    const { client, calls } = createFakeMediaClient();
    renderUploader({ client, trip: makeCoverTrip(), disabled: true, onChange });

    fireEvent.drop(screen.getByRole("group", { name: "旅行封面" }), {
      dataTransfer: { files: [makeImage()], types: ["Files"] },
    });

    expect(calls.presign).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("选择旅行封面")).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择图片" })).toBeDisabled();
  });
});