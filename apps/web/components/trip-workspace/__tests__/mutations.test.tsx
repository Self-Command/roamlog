import type { Trip, WorkspaceMemberWithUser } from "@roamlog/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_NOW, TEST_USER_ID, TEST_WORKSPACE_ID, makeExpense, makeStop, makeTrip, makeUser, makeWorkspace } from "@/test/fake-data";

import { ExpensesTab } from "../expenses-tab";
import { PackingTab } from "../packing-tab";
import { ParticipantsTab } from "../participants-tab";
import { ShareTab } from "../share-tab";
import { StopsTab } from "../stops-tab";
import { TripWorkspace } from "../trip-workspace";
import {
  adapterWith,
  makeMember,
  problem,
  renderTab,
  renderWithClients,
  route,
  stubFetch,
  type FetchCall,
} from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

const routerState = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
  useDataMode: () => "api",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000d1";
const STOP_ID = "0198f000-0000-7000-8000-0000000000d2";
const EXPENSE_ID = "0198f000-0000-7000-8000-0000000000d3";
const PACKING_ID = "0198f000-0000-7000-8000-0000000000d4";
const SHARE_ID = "0198f000-0000-7000-8000-0000000000d5";
const OTHER_USER_ID = "0198f000-0000-7000-8000-0000000000d6";
const NEW_TRIP_ID = "0198f000-0000-7000-8000-0000000000d7";

const TRIP: Trip = makeTrip({ id: TRIP_ID, title: "京都慢行", startDate: "2026-11-01", endDate: "2026-11-03" });
const EDITOR = makeWorkspace({ role: "editor" });
const SELF_MEMBER: WorkspaceMemberWithUser = makeMember(makeUser({ id: TEST_USER_ID, name: "顾行舟" }));
const OTHER_MEMBER: WorkspaceMemberWithUser = makeMember(
  makeUser({ id: OTHER_USER_ID, name: "沈青禾" }),
  "viewer",
);

function packingItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PACKING_ID,
    workspaceId: TEST_WORKSPACE_ID,
    tripId: TRIP_ID,
    category: "clothing",
    name: "冲锋衣",
    quantity: 1,
    packed: false,
    assigneeId: null,
    order: 0,
    createdById: TEST_USER_ID,
    updatedById: TEST_USER_ID,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    version: 3,
    ...overrides,
  };
}

function budgetBody() {
  return {
    tripId: TRIP_ID,
    displayCurrency: "CNY",
    originalTotals: [
      { currency: "CNY", amountMinor: 456_700 },
      { currency: "JPY", amountMinor: 200_000 },
    ],
    displayTotal: { currency: "CNY", amountMinor: 456_700, approx: true },
    categories: [],
    expenseCount: 2,
    overBudget: false,
  };
}

function shellRoutes() {
  return [
    route("GET", `/v1/trips/${TRIP_ID}/budget/summary`, budgetBody()),
    route("GET", `/v1/trips/${TRIP_ID}/participants`, []),
    route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
  ];
}

function patchOf(calls: FetchCall[], method: string, url: string) {
  return calls.filter((call) => call.method === method && call.url === url);
}

beforeEach(() => {
  routerState.push.mockClear();
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [SELF_MEMBER, OTHER_MEMBER],
    trips: [TRIP],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("费用写入", () => {
  it("记一笔：POST /v1/trips/{id}/expenses 带真实 minor units 与分摊参与者", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/expenses`, { items: [], nextCursor: null, hasMore: false }),
      route("POST", `/v1/trips/${TRIP_ID}/expenses`, makeExpense({ id: EXPENSE_ID }), 201),
    ]);

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /记一笔/ }));
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "88.5" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "和果子" } });
    await user.click(screen.getByRole("button", { name: /记录支出/ }));

    await waitFor(() => {
      expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/expenses`)).toHaveLength(1);
    });

    expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/expenses`)[0]?.body).toEqual({
      date: "2026-11-01",
      category: "food",
      note: "和果子",
      amountMinor: 8_850,
      currency: "CNY",
      paidById: TEST_USER_ID,
      splitMode: "equal",
      participants: [{ userId: TEST_USER_ID }],
    });
  });

  it("删除：DELETE /v1/expenses/{id}", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/expenses`, {
        items: [makeExpense({ id: EXPENSE_ID, note: "地铁票" })],
        nextCursor: null,
        hasMore: false,
      }),
      route("DELETE", `/v1/expenses/${EXPENSE_ID}`, { message: "deleted" }),
    ]);

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /删除支出 地铁票/ }));
    await user.click(await screen.findByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(patchOf(calls, "DELETE", `/v1/expenses/${EXPENSE_ID}`)).toHaveLength(1);
    });
  });
});

describe("行李写入与版本冲突", () => {
  it("勾选：PATCH /v1/packing/{id} 携带当前 version", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/packing`, {
        items: [packingItem()],
        nextCursor: null,
        hasMore: false,
      }),
      route("PATCH", `/v1/packing/${PACKING_ID}`, packingItem({ packed: true, version: 4 })),
    ]);

    renderTab(<PackingTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("checkbox", { name: "标记 冲锋衣 为已打包" }));

    await waitFor(() => {
      expect(patchOf(calls, "PATCH", `/v1/packing/${PACKING_ID}`)).toHaveLength(1);
    });
    expect(patchOf(calls, "PATCH", `/v1/packing/${PACKING_ID}`)[0]?.body).toEqual({
      version: 3,
      packed: true,
    });
  });

  it("409 打开 ConflictDialog；覆盖保存先读最新 version 再重试，不静默覆盖", async () => {
    const user = userEvent.setup();
    let patchCount = 0;
    let listCount = 0;

    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/budget/summary`, budgetBody()),
      route("GET", `/v1/trips/${TRIP_ID}/participants`, []),
      route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
      (call) => {
        if (call.method !== "GET" || !call.url.startsWith(`/v1/trips/${TRIP_ID}/packing`)) {
          return null;
        }
        listCount += 1;
        return {
          status: 200,
          body: {
            items: [packingItem({ version: listCount === 1 ? 3 : 7 })],
            nextCursor: null,
            hasMore: false,
          },
        };
      },
      (call) => {
        if (call.method !== "PATCH" || call.url !== `/v1/packing/${PACKING_ID}`) return null;
        patchCount += 1;
        if (patchCount === 1) {
          return {
            status: 409,
            body: problem(409, "VERSION_CONFLICT", "这件行李已被其他成员修改。"),
          };
        }
        return { status: 200, body: packingItem({ packed: true, version: 8 }) };
      },
    ]);

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    await user.click(await screen.findByRole("tab", { name: "行李" }));
    await user.click(await screen.findByRole("checkbox", { name: "标记 冲锋衣 为已打包" }));

    expect(await screen.findByText("有人先保存了")).toBeInTheDocument();
    expect(screen.getByText(/这件行李 在你编辑期间被其他成员更新/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /覆盖保存/ }));

    await waitFor(() => {
      expect(patchOf(calls, "PATCH", `/v1/packing/${PACKING_ID}`)).toHaveLength(2);
    });
    expect(patchOf(calls, "PATCH", `/v1/packing/${PACKING_ID}`)[1]?.body).toEqual({
      version: 7,
      packed: true,
    });
  });
});

describe("分享链接写入", () => {
  it("创建：POST 带密码与过期时间，链接域名来自服务端返回", async () => {
    const user = userEvent.setup();
    const shareToken = "tok_0198f0000000700080000000000000c5abcdef0123456789";
    const serverUrl = `https://share.roamlog.test/s/${shareToken}`;
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/share-links`, []),
      route(
        "POST",
        `/v1/trips/${TRIP_ID}/share-links`,
        {
          id: SHARE_ID,
          workspaceId: TEST_WORKSPACE_ID,
          tripId: TRIP_ID,
          createdById: TEST_USER_ID,
          expiresAt: "2026-12-18T00:00:00.000Z",
          revokedAt: null,
          hasPassword: true,
          allowIndex: false,
          showBudget: false,
          lastAccessedAt: null,
          accessCount: 0,
          createdAt: TEST_NOW,
          token: shareToken,
          url: serverUrl,
        },
        201,
      ),
    ]);

    renderTab(<ShareTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /创建链接/ }));
    fireEvent.change(screen.getByLabelText(/访问密码/), { target: { value: "correct-horse" } });
    await user.click(screen.getByRole("button", { name: "创建分享链接" }));

    await waitFor(() => {
      expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/share-links`)).toHaveLength(1);
    });

    const body = patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/share-links`)[0]?.body as Record<
      string,
      unknown
    >;
    expect(body.password).toBe("correct-horse");
    expect(body.showBudget).toBe(false);
    expect(body.allowIndex).toBe(false);
    expect(typeof body.expiresAt).toBe("string");
    expect(String(body.expiresAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(await screen.findByText(serverUrl)).toBeInTheDocument();
  });

  it("撤销：DELETE /v1/share-links/{id}", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/share-links`, [
        {
          id: SHARE_ID,
          workspaceId: TEST_WORKSPACE_ID,
          tripId: TRIP_ID,
          createdById: TEST_USER_ID,
          expiresAt: null,
          revokedAt: null,
          hasPassword: false,
          allowIndex: false,
          showBudget: false,
          lastAccessedAt: null,
          accessCount: 3,
          createdAt: TEST_NOW,
        },
      ]),
      route("DELETE", `/v1/share-links/${SHARE_ID}`, { message: "revoked" }),
    ]);

    renderTab(<ShareTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /撤销/ }));
    await user.click(await screen.findByRole("button", { name: "撤销链接" }));

    await waitFor(() => {
      expect(patchOf(calls, "DELETE", `/v1/share-links/${SHARE_ID}`)).toHaveLength(1);
    });
  });
});

describe("参与者与行程节点写入", () => {
  it("添加参与者：POST /v1/trips/{id}/participants {userId}", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, []),
      route("POST", `/v1/trips/${TRIP_ID}/participants`, { id: "0198f000-0000-7000-8000-0000000000e1" }, 201),
    ]);

    renderTab(<ParticipantsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /添加参与者/ }));
    await user.selectOptions(screen.getByLabelText("工作区成员"), OTHER_USER_ID);
    await user.click(screen.getByRole("button", { name: "保存参与者" }));

    await waitFor(() => {
      expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/participants`)).toHaveLength(1);
    });
    expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/participants`)[0]?.body).toEqual({
      userId: OTHER_USER_ID,
    });
  });

  it("编辑节点：PATCH /v1/stops/{id} 携带 version 与改动字段", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [
        makeStop({ id: STOP_ID, city: "奈良", version: 4, order: 2 }),
      ]),
      route("PATCH", `/v1/stops/${STOP_ID}`, makeStop({ id: STOP_ID, city: "奈良町", version: 5 })),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "编辑行程节点 奈良" }));
    fireEvent.change(screen.getByLabelText("城市"), { target: { value: "奈良町" } });
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(patchOf(calls, "PATCH", `/v1/stops/${STOP_ID}`)).toHaveLength(1);
    });
    expect(patchOf(calls, "PATCH", `/v1/stops/${STOP_ID}`)[0]?.body).toMatchObject({
      version: 4,
      city: "奈良町",
      order: 2,
      countryCode: "JP",
    });
  });

  it("删除节点：DELETE /v1/stops/{id}，并二次确认", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [makeStop({ id: STOP_ID, city: "奈良" })]),
      route("DELETE", `/v1/stops/${STOP_ID}`, { message: "deleted" }),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "删除行程节点 奈良" }));
    expect(await screen.findByText("删除这个行程节点？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(patchOf(calls, "DELETE", `/v1/stops/${STOP_ID}`)).toHaveLength(1);
    });
  });
});

describe("旅行级写入（删除 / 复制）", () => {
  it("删除需要输入标题确认，确认后 DELETE /v1/trips/{id} 并回到旅行库", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      ...shellRoutes(),
      route("DELETE", `/v1/trips/${TRIP_ID}`, { message: "deleted" }),
    ]);

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    await user.click(await screen.findByRole("button", { name: "删除" }));
    const confirm = await screen.findByRole("button", { name: "永久删除" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/输入旅行标题确认/), { target: { value: "京都" } });
    expect(screen.getByRole("button", { name: "永久删除" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/输入旅行标题确认/), { target: { value: "京都慢行" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "永久删除" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => {
      expect(patchOf(calls, "DELETE", `/v1/trips/${TRIP_ID}`)).toHaveLength(1);
    });
    expect(routerState.push).toHaveBeenCalledWith(`/w/${EDITOR.slug}/trips`);
  });

  it("复制：POST /v1/trips/{id}/duplicate，成功后跳到新旅行", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      ...shellRoutes(),
      route("POST", `/v1/trips/${TRIP_ID}/duplicate`, makeTrip({ id: NEW_TRIP_ID, title: "京都慢行 副本" }), 201),
    ]);

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    await user.click(await screen.findByRole("button", { name: /复制/ }));
    fireEvent.change(screen.getByLabelText(/副本标题/), { target: { value: "京都慢行 副本" } });
    await user.click(screen.getByRole("button", { name: /创建副本/ }));

    await waitFor(() => {
      expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/duplicate`)).toHaveLength(1);
    });
    expect(patchOf(calls, "POST", `/v1/trips/${TRIP_ID}/duplicate`)[0]?.body).toEqual({
      title: "京都慢行 副本",
    });
    await waitFor(() => {
      expect(routerState.push).toHaveBeenCalledWith(`/w/${EDITOR.slug}/trips/${NEW_TRIP_ID}`);
    });
  });
});