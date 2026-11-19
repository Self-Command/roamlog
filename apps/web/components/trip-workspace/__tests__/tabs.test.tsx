import type { Media, MediaExif } from "@roamlog/contracts";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_NOW,
  TEST_USER_ID,
  TEST_WORKSPACE_ID,
  makeExpense,
  makeStop,
  makeTrip,
  makeUser,
  makeWorkspace,
} from "@/test/fake-data";

import { ExpensesTab } from "../expenses-tab";
import { formatMinor } from "../money";
import { PackingTab } from "../packing-tab";
import { PhotosTab } from "../photos-tab";
import { ShareTab } from "../share-tab";
import { StopsTab } from "../stops-tab";
import {
  adapterWith,
  makeMember,
  problem,
  renderTab,
  route,
  stubFetch,
} from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000a1";
const STOP_ID = "0198f000-0000-7000-8000-0000000000a2";
const EXPENSE_ID = "0198f000-0000-7000-8000-0000000000a3";

const TRIP = makeTrip({ id: TRIP_ID, title: "京都慢行", startDate: "2026-11-01", endDate: "2026-11-03" });
const EDITOR = makeWorkspace({ role: "editor" });
const VIEWER = makeWorkspace({ role: "viewer" });

function makeMedia(overrides: Partial<Media> & { id: string }): Media {
  return {
    workspaceId: TEST_WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: TEST_USER_ID,
    bucket: "roamlog-test",
    key: `seed/${overrides.id}.jpg`,
    mimeType: "image/jpeg",
    size: 240_000,
    width: 1600,
    height: 900,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: "2026-11-02",
    location: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [makeMember(makeUser({ id: TEST_USER_ID, name: "顾行舟" }))],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("行程 tab（真实 stops）", () => {
  it("渲染真实节点：城市、国家码、坐标、来源 provider 与顺序", async () => {
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [
        makeStop({
          id: STOP_ID,
          city: "京都",
          country: "日本",
          countryCode: "JP",
          provider: "photon",
          lat: 35.0116,
          lng: 135.7681,
          order: 0,
        }),
      ]),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("京都")).toBeInTheDocument();
    expect(screen.getByText("日本 · JP")).toBeInTheDocument();
    // No persisted address yet: the city/country line is the fallback location.
    expect(screen.getByText("京都 · 日本")).toBeInTheDocument();
    expect(screen.getByText(/35\.0116, 135\.7681/)).toBeInTheDocument();
    expect(screen.getByText("Photon 搜索")).toBeInTheDocument();
    expect(screen.getByText(/ORDER 0 · VERSION 1/)).toBeInTheDocument();
    expect(calls).toEqual([{ method: "GET", url: `/v1/trips/${TRIP_ID}/stops`, body: undefined }]);
  });

  it("显示已落库的地点 address，刷新后仍在", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [
        makeStop({
          id: STOP_ID,
          city: "京都",
          country: "日本",
          countryCode: "JP",
          address: "京都市, 京都府, 日本",
          bbox: [135.6, 34.85, 135.93, 35.17],
          order: 0,
        }),
      ]),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    expect(screen.queryByText("京都 · 日本")).not.toBeInTheDocument();
  });

  it("空状态是真实空态，不编造节点", async () => {
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/stops`, [])]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("还没有行程节点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加第一个节点/ })).toBeInTheDocument();
    expect(screen.queryByText(/ORDER/)).not.toBeInTheDocument();
  });

  it("读取失败显示错误与重试，不渲染空状态冒充成功", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, problem(500, "INTERNAL_ERROR", "数据库连接失败"), 500),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("行程节点读取失败")).toBeInTheDocument();
    expect(screen.getByText("数据库连接失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("还没有行程节点")).not.toBeInTheDocument();
  });
});

describe("费用 tab（真实 expenses / 多币种不折算）", () => {
  const page = {
    items: [
      makeExpense({
        id: EXPENSE_ID,
        note: "地铁票",
        amountMinor: 123_400,
        currency: "CNY",
        category: "transport",
        date: "2026-11-02",
        version: 2,
      }),
      makeExpense({
        id: "0198f000-0000-7000-8000-0000000000a4",
        note: "拉面",
        amountMinor: 200_000,
        currency: "JPY",
        category: "food",
        date: "2026-11-03",
      }),
    ],
    nextCursor: null,
    hasMore: false,
  };

  it("按币种分别合计，不合并、不折算", async () => {
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/expenses`, page)]);

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("地铁票")).toBeInTheDocument();
    expect(screen.getByText("拉面")).toBeInTheDocument();
    expect(screen.getByText(/CNY · 1 笔/)).toBeInTheDocument();
    expect(screen.getByText(/JPY · 1 笔/)).toBeInTheDocument();
    expect(screen.getAllByText(formatMinor(123_400, "CNY")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatMinor(200_000, "JPY")).length).toBeGreaterThan(0);
    expect(screen.getByText(/123400 MINOR · V2/)).toBeInTheDocument();
  });

  it("空状态是真实空态", async () => {
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/expenses`, { items: [], nextCursor: null, hasMore: false })]);

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("还没有记录支出")).toBeInTheDocument();
    expect(screen.queryByText(/MINOR/)).not.toBeInTheDocument();
  });
});

describe("照片 tab（真实 media 签名 URL）", () => {
  it("用 variants 里的签名地址渲染真实图片", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [
          makeMedia({
            id: "0198f000-0000-7000-8000-0000000000b1",
            caption: "清水寺",
            variants: {
              original: { key: "seed/a.jpg", url: "https://img.example.test/a.jpg" },
              thumb: { key: "seed/a-thumb.jpg", url: "https://img.example.test/a-thumb.jpg" },
            },
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    const image = await screen.findByRole("img", { name: "清水寺" });
    expect(image).toHaveAttribute("src", "https://img.example.test/a-thumb.jpg");
  });

  it("没有签名地址时显示真实状态，不画占位图", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [
          makeMedia({
            id: "0198f000-0000-7000-8000-0000000000b2",
            status: "processing",
            variants: {},
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    const { container } = renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("暂无签名预览地址")).toBeInTheDocument();
    expect(screen.getAllByText("服务器处理中").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("空相册显示真实空状态", async () => {
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/media`, { items: [], nextCursor: null, hasMore: false })]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("这趟旅行还没有照片")).toBeInTheDocument();
  });

  it("有 EXIF 的照片显示相机与曝光，老照片只显示自己的日期", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [
          makeMedia({
            id: "0198f000-0000-7000-8000-0000000000b3",
            caption: "清水寺",
            date: "2026-11-02",
            exif: {
              Make: "Apple",
              Model: "iPhone 15 Pro",
              FNumber: 1.8,
              FocalLength: 24,
              ExposureTime: "1/250",
              ISO: 200,
              DateTimeOriginal: "2026-11-02T03:04:05.000Z",
              latitude: 35.0116,
              longitude: 135.7681,
            } as MediaExif,
          }),
          makeMedia({
            id: "0198f000-0000-7000-8000-0000000000b4",
            caption: "老照片",
            date: "2026-11-03",
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("iPhone 15 Pro")).toBeInTheDocument();
    expect(screen.getByText("ƒ/1.8 · 24mm")).toBeInTheDocument();
    expect(screen.getByText("有位置")).toBeInTheDocument();
    // The card without metadata renders no EXIF block at all — only its date.
    expect(screen.getAllByTestId("media-exif-summary")).toHaveLength(1);
    expect(screen.getByText("老照片")).toBeInTheDocument();
  });

  it("点开照片才渲染 L2 详情：镜头、曝光 chips 与拍摄时间", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [
          makeMedia({
            id: "0198f000-0000-7000-8000-0000000000b5",
            caption: "清水寺",
            variants: {
              original: { key: "seed/a.jpg", url: "https://img.example.test/a.jpg" },
              thumb: { key: "seed/a-thumb.jpg", url: "https://img.example.test/a-thumb.jpg" },
            },
            exif: {
              Make: "Apple",
              Model: "iPhone 15 Pro",
              LensModel: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
              FNumber: 1.8,
              FocalLength: 24,
              ExposureTime: "1/250",
              ISO: 200,
            } as MediaExif,
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(screen.queryByTestId("media-exif-detail")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "查看照片详情：清水寺" }));

    expect(await screen.findByTestId("media-exif-detail")).toBeInTheDocument();
    expect(screen.getByText("ISO 200")).toBeInTheDocument();
    expect(screen.getByText("1/250 s")).toBeInTheDocument();
    expect(
      screen.getByText("iPhone 15 Pro back triple camera 6.765mm f/1.78"),
    ).toBeInTheDocument();
  });

  it("照片页只读展示精确位置状态，改动入口指向编辑旅行", async () => {
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, { items: [], nextCursor: null, hasMore: false }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    // Absent in the contract means the product default: the switch is on.
    expect(await screen.findByText(/公开页显示精确位置：开启/)).toBeInTheDocument();
    // The copy must stay inside what the server enforces: the share page only.
    expect(screen.getByText(/公开分享页会显示照片拍摄的精确位置/)).toBeInTheDocument();
    expect(screen.queryByText(/地图/)).toBeNull();
    expect(screen.queryByText(/照片详情/)).toBeNull();
    // The switch is a trip-level setting now, so the photos tab must not offer it.
    expect(screen.queryByRole("switch")).toBeNull();

    const editLink = screen.getByRole("link", { name: "编辑旅行" });
    expect(editLink).toHaveAttribute("href", `/w/roamlog-crew/trips/${TRIP_ID}/edit`);

    // Read-only means read-only: the tab issues no trip write of its own.
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("关闭精确位置时照片页只说明公开分享页只显示城市，不再提供开关", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, { items: [], nextCursor: null, hasMore: false }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, {
      trip: makeTrip({ id: TRIP_ID, showExactPhotoLocation: false }),
      workspace: EDITOR,
    });

    expect(await screen.findByText(/公开页显示精确位置：关闭/)).toBeInTheDocument();
    expect(
      screen.getByText(/公开分享页只显示城市，不显示照片拍摄的精确位置/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("link", { name: "编辑旅行" })).toBeInTheDocument();
  });

  it("只读角色看不到编辑入口，照片页也不再提供开关", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/media`, { items: [], nextCursor: null, hasMore: false }),
    ]);

    renderTab(<PhotosTab tripId={TRIP_ID} />, { trip: TRIP, workspace: VIEWER });

    expect(await screen.findByText("这趟旅行还没有照片")).toBeInTheDocument();
    expect(await screen.findByText(/公开页显示精确位置：开启/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("link", { name: "编辑旅行" })).toBeNull();
    expect(screen.getByText("当前角色不能修改行程设置。")).toBeInTheDocument();
  });
});

describe("行李 tab（真实 packing）", () => {
  it("渲染真实条目与打包进度", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/packing`, {
        items: [
          {
            id: "0198f000-0000-7000-8000-0000000000c1",
            workspaceId: TEST_WORKSPACE_ID,
            tripId: TRIP_ID,
            category: "documents",
            name: "护照",
            quantity: 1,
            packed: true,
            assigneeId: null,
            order: 0,
            createdById: TEST_USER_ID,
            updatedById: TEST_USER_ID,
            createdAt: TEST_NOW,
            updatedAt: TEST_NOW,
            deletedAt: null,
            version: 3,
          },
          {
            id: "0198f000-0000-7000-8000-0000000000c2",
            workspaceId: TEST_WORKSPACE_ID,
            tripId: TRIP_ID,
            category: "clothing",
            name: "冲锋衣",
            quantity: 2,
            packed: false,
            assigneeId: null,
            order: 1,
            createdById: TEST_USER_ID,
            updatedById: TEST_USER_ID,
            createdAt: TEST_NOW,
            updatedAt: TEST_NOW,
            deletedAt: null,
            version: 1,
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<PackingTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(await screen.findByText("护照")).toBeInTheDocument();
    expect(screen.getByText("冲锋衣")).toBeInTheDocument();
    expect(screen.getByText(/×2/)).toBeInTheDocument();
    expect(screen.getByText("1/2 已打包")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});

describe("权限：viewer 只读", () => {
  it("viewer 看不到分享链接，也不发请求", async () => {
    stubFetch([]);

    renderTab(<ShareTab tripId={TRIP_ID} />, { trip: TRIP, workspace: VIEWER });

    expect(await screen.findByText("当前角色不能查看分享链接")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建链接/ })).not.toBeInTheDocument();
  });

  it("viewer 的写操作按钮被禁用并给出 title 原因", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [makeStop({ id: STOP_ID, city: "京都" })]),
      route("GET", `/v1/trips/${TRIP_ID}/expenses`, { items: [], nextCursor: null, hasMore: false }),
    ]);

    const { unmount } = renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: VIEWER });

    const addButton = await screen.findByRole("button", { name: /添加节点/ });
    expect(addButton).toBeDisabled();
    await screen.findByText("京都");
    expect(addButton.getAttribute("title")).toContain("Viewer 只能阅读和评论");

    const deleteButton = screen.getByRole("button", { name: "删除行程节点 京都" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton.getAttribute("title")).toContain("Viewer 只能阅读和评论");

    unmount();

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: VIEWER });
    const addExpense = await screen.findByRole("button", { name: /记一笔/ });
    expect(addExpense).toBeDisabled();
    expect(addExpense.getAttribute("title")).toContain("Viewer 只能阅读和评论");
  });
});

describe("fixture 边界", () => {
  it("工作台渲染结果不含 demo-store / fixture 特征", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [makeStop({ id: STOP_ID, city: "大阪" })]),
    ]);

    const { container } = renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });
    await screen.findByText("大阪");

    const text = container.textContent ?? "";
    expect(text).not.toContain("林知夏");
    expect(text).not.toContain("¥18,800");
    expect(text).not.toContain("demo-store");
    expect(text).not.toContain("fixtures");
    expect(text).not.toContain("MSW");
  });
});