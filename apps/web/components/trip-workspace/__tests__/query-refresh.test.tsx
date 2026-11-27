import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeExpense, makeStop, makeTrip, makeUser, makeWorkspace } from "@/test/fake-data";

import { PackingTab } from "../packing-tab";
import { StopsTab } from "../stops-tab";
import { TripWorkspace } from "../trip-workspace";
import {
  adapterWith,
  makeMember,
  renderTab,
  renderWithClients,
  route,
  stubFetch,
  type FetchCall,
} from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000d1";
const STOP_ID = "0198f000-0000-7000-8000-0000000000d2";
const TRIP = makeTrip({ id: TRIP_ID, title: "京都慢行" });
const EDITOR = makeWorkspace({ role: "editor" });
const SELF = makeUser({ id: "0198f000-0000-7000-8000-0000000000e1", name: "顾行舟" });

beforeEach(() => {
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [makeMember(SELF)],
    trips: [TRIP],
  });
});

function matchingCalls(calls: FetchCall[], method: string, url: string) {
  return calls.filter((call) => call.method === method && call.url === url);
}

describe("trip workspace query refresh", () => {
  it("refetches the active stops query after create without reloading the page", async () => {
    const user = userEvent.setup();
    const created = makeStop({
      id: STOP_ID,
      city: "宇治",
      country: "日本",
      countryCode: "JP",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      order: 0,
    });
    let listCount = 0;

    const calls = stubFetch([
      (call) => {
        if (call.method !== "GET" || call.url !== `/v1/trips/${TRIP_ID}/stops`) return null;
        listCount += 1;
        return { status: 200, body: listCount === 1 ? [] : [created] };
      },
      route("POST", `/v1/trips/${TRIP_ID}/stops`, created, 201),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "添加第一个节点" }));
    await user.type(screen.getByLabelText("城市"), "宇治");
    await user.type(screen.getByLabelText("国家"), "日本");
    await user.type(screen.getByLabelText("国家码"), "JP");
    await user.type(screen.getByLabelText("开始日期"), "2026-11-01");
    await user.type(screen.getByLabelText("结束日期"), "2026-11-02");
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(matchingCalls(calls, "POST", `/v1/trips/${TRIP_ID}/stops`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(matchingCalls(calls, "GET", `/v1/trips/${TRIP_ID}/stops`).length).toBeGreaterThan(1);
    });
    expect(await screen.findByText("宇治")).toBeVisible();
  });

  it("keeps the stops query live after the workspace tabs remount", async () => {
    const user = userEvent.setup();
    const created = makeStop({
      id: STOP_ID,
      city: "宇治",
      country: "日本",
      countryCode: "JP",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      order: 0,
    });
    let listCount = 0;

    const calls = stubFetch([
      (call) => {
        if (call.method !== "GET" || call.url !== `/v1/trips/${TRIP_ID}/stops`) return null;
        listCount += 1;
        return { status: 200, body: listCount <= 2 ? [] : [created] };
      },
      route("GET", `/v1/trips/${TRIP_ID}/budget/summary`, {
        tripId: TRIP_ID,
        displayCurrency: "CNY",
        originalTotals: [],
        displayTotal: { currency: "CNY", amountMinor: 0, approx: false },
        categories: [],
        expenseCount: 0,
        overBudget: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/participants`, []),
      route("GET", `/v1/trips/${TRIP_ID}/expenses`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/packing`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/share-links`, []),
      route("GET", `/v1/trips/${TRIP_ID}/activity`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("POST", `/v1/trips/${TRIP_ID}/stops`, created, 201),
    ]);

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    for (const tab of ["费用", "行李", "行程"] as const) {
      await user.click(await screen.findByRole("tab", { name: new RegExp(`^${tab}$`, "u") }));
    }
    await user.click(await screen.findByRole("button", { name: "添加第一个节点" }));
    await user.type(screen.getByLabelText("城市"), "宇治");
    await user.type(screen.getByLabelText("国家"), "日本");
    await user.type(screen.getByLabelText("国家码"), "JP");
    await user.type(screen.getByLabelText("开始日期"), "2026-11-01");
    await user.type(screen.getByLabelText("结束日期"), "2026-11-02");
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(matchingCalls(calls, "POST", `/v1/trips/${TRIP_ID}/stops`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(matchingCalls(calls, "GET", `/v1/trips/${TRIP_ID}/stops`).length).toBeGreaterThan(2);
    });
    expect(await screen.findByText("宇治")).toBeVisible();
  });

  it("refetches expenses after the create dialog closes", async () => {
    const user = userEvent.setup();
    const created = makeExpense({ id: "0198f000-0000-7000-8000-0000000000e2", note: "宇治抹茶" });
    let listCount = 0;

    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
      route("GET", `/v1/trips/${TRIP_ID}/budget/summary`, {
        tripId: TRIP_ID,
        displayCurrency: "CNY",
        originalTotals: [],
        displayTotal: { currency: "CNY", amountMinor: 0, approx: false },
        categories: [],
        expenseCount: 0,
        overBudget: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/participants`, []),
      route("GET", `/v1/trips/${TRIP_ID}/packing`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/media`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      route("GET", `/v1/trips/${TRIP_ID}/share-links`, []),
      route("GET", `/v1/trips/${TRIP_ID}/activity`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      (call) => {
        if (call.method !== "GET" || !call.url.startsWith(`/v1/trips/${TRIP_ID}/expenses`)) {
          return null;
        }
        listCount += 1;
        return {
          status: 200,
          body: {
            items: listCount === 1 ? [] : [created],
            nextCursor: null,
            hasMore: false,
          },
        };
      },
      route("POST", `/v1/trips/${TRIP_ID}/expenses`, created, 201),
    ]);

    renderWithClients(<TripWorkspace trip={TRIP} workspace={EDITOR} workspaceSlug={EDITOR.slug} />);

    await user.click(await screen.findByRole("tab", { name: /^费用$/u }));
    await user.click(await screen.findByRole("button", { name: /记一笔/u }));
    await user.type(screen.getByLabelText("金额"), "88.5");
    await user.type(screen.getByLabelText("备注"), "宇治抹茶");
    await user.click(screen.getByRole("button", { name: /记录支出/u }));

    await waitFor(() => {
      expect(matchingCalls(calls, "POST", `/v1/trips/${TRIP_ID}/expenses`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(
        calls.filter(
          (call) => call.method === "GET" && call.url.startsWith(`/v1/trips/${TRIP_ID}/expenses`),
        ).length,
      ).toBeGreaterThan(1);
    });
    expect(await screen.findByText("宇治抹茶")).toBeVisible();
  });

  it("refetches packing items after create", async () => {
    const user = userEvent.setup();
    const created = {
      id: "0198f000-0000-7000-8000-0000000000e3",
      workspaceId: "0198f000-0000-7000-8000-0000000000e4",
      tripId: TRIP_ID,
      category: "clothing",
      name: "冲锋衣",
      quantity: 1,
      packed: false,
      assigneeId: null,
      order: 0,
      createdById: SELF.id,
      updatedById: SELF.id,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      deletedAt: null,
      version: 1,
    };
    let listCount = 0;

    const calls = stubFetch([
      (call) => {
        if (call.method !== "GET" || !call.url.startsWith(`/v1/trips/${TRIP_ID}/packing`)) {
          return null;
        }
        listCount += 1;
        return {
          status: 200,
          body: {
            items: listCount === 1 ? [] : [created],
            nextCursor: null,
            hasMore: false,
          },
        };
      },
      route("POST", `/v1/trips/${TRIP_ID}/packing`, created, 201),
    ]);

    renderTab(<PackingTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /添加行李/u }));
    await user.type(screen.getByLabelText("名称"), "冲锋衣");
    await user.click(screen.getByRole("button", { name: "保存行李" }));

    await waitFor(() => {
      expect(matchingCalls(calls, "POST", `/v1/trips/${TRIP_ID}/packing`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(
        calls.filter(
          (call) => call.method === "GET" && call.url.startsWith(`/v1/trips/${TRIP_ID}/packing`),
        ).length,
      ).toBeGreaterThan(1);
    });
    expect(await screen.findByText("冲锋衣")).toBeVisible();
  });
});
