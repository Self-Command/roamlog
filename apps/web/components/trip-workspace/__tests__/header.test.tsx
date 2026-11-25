import type { Trip } from "@roamlog/contracts";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_NOW, TEST_USER_ID, makeTrip, makeUser, makeWorkspace } from "@/test/fake-data";

import { formatMinor } from "../money";
import { TripWorkspace } from "../trip-workspace";
import { adapterWith, makeMember, renderWithClients, route, stubFetch } from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

const routerState = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000f1";
const COVER_URL = "https://images.example.test/kyoto-cover-large.jpg";

const EDITOR = makeWorkspace({ role: "editor" });
const VIEWER = makeWorkspace({ role: "viewer" });

const TRIP: Trip = makeTrip({
  id: TRIP_ID,
  title: "京都慢行",
  summary: "从上海出发，三天两晚。",
  startDate: "2026-11-01",
  endDate: "2026-11-03",
  origin: "上海",
  originLat: 31.2304,
  originLng: 121.4737,
  originCountryCode: "CN",
  timeZone: "Asia/Shanghai",
  destinations: ["京都", "奈良"],
  countryCodes: ["JP"],
  tags: ["家庭"],
  guestNames: ["林间"],
  budgetAmountMinor: 900_000,
  budgetCurrency: "CNY",
  version: 5,
  coverMediaId: "0198f000-0000-7000-8000-0000000000f2",
  cover: {
    mediaId: "0198f000-0000-7000-8000-0000000000f2",
    status: "ready",
    url: COVER_URL,
    thumbUrl: "https://images.example.test/kyoto-cover-thumb.jpg",
    width: 1600,
    height: 900,
    blurhash: null,
    expiresAt: TEST_NOW,
  },
});

function budgetBody() {
  return {
    tripId: TRIP_ID,
    displayCurrency: "CNY",
    originalTotals: [
      { currency: "CNY", amountMinor: 512_300 },
      { currency: "JPY", amountMinor: 88_000 },
    ],
    displayTotal: { currency: "CNY", amountMinor: 512_300, approx: true },
    categories: [],
    expenseCount: 4,
    overBudget: false,
  };
}

function shellRoutes() {
  return [
    route("GET", `/v1/trips/${TRIP_ID}/budget/summary`, budgetBody()),
    route("GET", `/v1/trips/${TRIP_ID}/participants`, [
      {
        id: "0198f000-0000-7000-8000-0000000000f3",
        workspaceId: EDITOR.id,
        tripId: TRIP_ID,
        userId: TEST_USER_ID,
        joinedAt: TEST_NOW,
      },
    ]),
    route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
  ];
}

beforeEach(() => {
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [makeMember(makeUser({ id: TEST_USER_ID, name: "顾行舟" }))],
    trips: [TRIP],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("头部概览（真实 trip 字段）", () => {
  it("渲染日期、天数、起点（坐标/国家/时区）、目的地、标签与同行人", async () => {
    stubFetch(shellRoutes());

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    const heading = await screen.findByRole("heading", { level: 1, name: "京都慢行" });
    expect(heading.className).toContain("type-trip-title");
    expect(screen.getAllByText(/3 天/).length).toBeGreaterThan(0);
    expect(screen.getByText("上海")).toBeInTheDocument();
    expect(screen.getByText("CN")).toBeInTheDocument();
    expect(screen.getByText("Asia/Shanghai")).toBeInTheDocument();
    expect(screen.getByText("31.2304, 121.4737")).toBeInTheDocument();
    expect(screen.getByText("京都")).toBeInTheDocument();
    expect(screen.getByText("奈良")).toBeInTheDocument();
    expect(screen.getByText("家庭")).toBeInTheDocument();
    expect(await screen.findByText("林间（嘉宾）")).toBeInTheDocument();
    expect(await screen.findByText("顾行舟")).toBeInTheDocument();
    expect(screen.queryByText(/版本\s*5/u)).not.toBeInTheDocument();
    expect(screen.getByText("工作区可见")).toBeInTheDocument();
    expect(screen.getByText("编辑者")).toBeInTheDocument();
  });

  it("预算与已花按币种分别展示，不折算、不合并", async () => {
    stubFetch(shellRoutes());

    const { container } = renderWithClients(
      <TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />,
    );

    expect(await screen.findByText("CNY · 已花")).toBeInTheDocument();
    expect(screen.getByText("JPY · 已花")).toBeInTheDocument();

    const text = container.textContent ?? "";
    expect(text).toContain(formatMinor(512_300, "CNY"));
    expect(text).toContain(formatMinor(88_000, "JPY"));
    expect(text).toContain(`预算 ${formatMinor(900_000, "CNY")}`);
    expect(text).toContain("不同币种不会自动换算");
    // 两个币种各自成行：折算会产生一个额外的合并值
    expect(screen.getAllByText("CNY · 已花")).toHaveLength(1);
    expect(screen.getAllByText("JPY · 已花")).toHaveLength(1);
  });

  it("封面用服务端签名 URL 渲染，编辑入口指向 edit 路由", async () => {
    stubFetch(shellRoutes());

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    const image = await screen.findByRole("img", { name: "当前旅行封面" });
    expect(image).toHaveAttribute("src", COVER_URL);

    const editLink = screen.getByRole("link", { name: /编辑旅行/ });
    expect(editLink).toHaveAttribute("href", `/w/${EDITOR.slug}/trips/${TRIP_ID}/edit`);
  });

  it("viewer 的编辑/删除/复制按钮禁用并写明原因", async () => {
    stubFetch(shellRoutes());

    renderWithClients(<TripWorkspace trip={TRIP} workspace={VIEWER} workspaceSlug={VIEWER.slug} />);

    const editButton = await screen.findByRole("button", { name: /编辑旅行/ });
    expect(editButton).toBeDisabled();
    expect(editButton.getAttribute("title")).toContain("你是只读成员，只能阅读和评论");

    const duplicate = screen.getByRole("button", { name: /复制/ });
    expect(duplicate).toBeDisabled();
    expect(duplicate.getAttribute("title")).toContain("你是只读成员，只能阅读和评论");

    const remove = screen.getByRole("button", { name: "删除" });
    expect(remove).toBeDisabled();
    expect(remove.getAttribute("title")).toContain("你是只读成员，只能阅读和评论");

    // Viewer 连分享链接都不可读，因此整个分享 tab 不出现
    expect(screen.queryByRole("tab", { name: "分享" })).not.toBeInTheDocument();
  });
});
