import type { Place } from "@roamlog/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeStop, makeTrip, makeWorkspace } from "@/test/fake-data";

import { renderTab, route, stubFetch, type FetchCall } from "./__tests__/harness";
import { StopsTab } from "./stops-tab";

const searchPlacesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/trip-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trip-form")>();
  return { ...actual, searchPlacesForTripForm: searchPlacesMock };
});

const TRIP_ID = "0198f000-0000-7000-8000-0000000000d1";
const NEW_STOP_ID = "0198f000-0000-7000-8000-0000000000d2";
const STOP_ID = "0198f000-0000-7000-8000-0000000000d3";

const TRIP = makeTrip({
  id: TRIP_ID,
  title: "北陆慢行",
  startDate: "2026-11-01",
  endDate: "2026-11-03",
});
const EDITOR = makeWorkspace({ role: "editor" });

const KANAZAWA: Place = {
  provider: "geoapify",
  providerPlaceId: "kanazawa-1",
  name: "金泽",
  address: "金泽市, 石川县, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 36.5613,
  lng: 136.6562,
  timeZone: "Asia/Tokyo",
  bbox: [136.55, 36.5, 136.75, 36.65],
  importance: 0.2,
  type: "city",
};

function stopPosts(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.method === "POST" && call.url === `/v1/trips/${TRIP_ID}/stops`,
  );
}

async function openCreateAndTypeKanazawa(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "添加节点" }));
  await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "金泽");
  return screen.findByRole("option", { name: /^金泽/ }, { timeout: 3000 });
}

async function selectKanazawa(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await openCreateAndTypeKanazawa(user));
}

function fillDates() {
  fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-11-05" } });
  fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-11-06" } });
}

beforeEach(() => {
  searchPlacesMock.mockReset();
  searchPlacesMock.mockResolvedValue({
    items: [KANAZAWA],
    degraded: false,
    cached: false,
    provider: "geoapify",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("停靠点地点搜索", () => {
  it("选中地点后填充城市、国家、国家码与坐标，并提交地点元数据", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
      route(
        "POST",
        `/v1/trips/${TRIP_ID}/stops`,
        makeStop({
          id: NEW_STOP_ID,
          city: "金泽",
          country: "日本",
          countryCode: "JP",
          startDate: "2026-11-05",
          endDate: "2026-11-06",
        }),
        201,
      ),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });
    const option = await openCreateAndTypeKanazawa(user);

    const credit = await screen.findByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "geoapify");
    await user.click(option);

    expect(screen.getByLabelText("城市")).toHaveValue("金泽");
    expect(screen.getByLabelText("国家")).toHaveValue("日本");
    expect(screen.getByLabelText("国家码")).toHaveValue("JP");
    expect(screen.getByLabelText("纬度（可选）")).toHaveValue("36.5613");
    expect(screen.getByLabelText("经度（可选）")).toHaveValue("136.6562");

    fillDates();
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(stopPosts(calls)).toHaveLength(1);
    });
    expect(stopPosts(calls)[0]?.body).toMatchObject({
      city: "金泽",
      country: "日本",
      countryCode: "JP",
      lat: 36.5613,
      lng: 136.6562,
      provider: "geoapify",
      providerPlaceId: "kanazawa-1",
      timeZone: "Asia/Tokyo",
      address: "金泽市, 石川县, 日本",
      bbox: [136.55, 36.5, 136.75, 36.65],
    });
  });

  it("手动改城市后清空地点派生的坐标与来源，不提交旧地点", async () => {
    const user = userEvent.setup();
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
      route(
        "POST",
        `/v1/trips/${TRIP_ID}/stops`,
        makeStop({ id: NEW_STOP_ID, city: "小松", startDate: "2026-11-05", endDate: "2026-11-06" }),
        201,
      ),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });
    await selectKanazawa(user);

    fireEvent.change(screen.getByLabelText("城市"), { target: { value: "小松" } });

    expect(screen.getByLabelText("纬度（可选）")).toHaveValue("");
    expect(screen.getByLabelText("经度（可选）")).toHaveValue("");

    fillDates();
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(stopPosts(calls)).toHaveLength(1);
    });
    const body = stopPosts(calls)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      city: "小松",
      country: "日本",
      countryCode: "JP",
      provider: null,
      providerPlaceId: null,
      timeZone: null,
      address: null,
      bbox: null,
    });
    expect(body).not.toHaveProperty("lat");
    expect(body).not.toHaveProperty("lng");
  });

  it("搜索失败时仍可用查询文本手动填写城市", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    searchPlacesMock.mockRejectedValue(new Error("network down"));
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, []),
      route(
        "POST",
        `/v1/trips/${TRIP_ID}/stops`,
        makeStop({ id: NEW_STOP_ID, city: "金泽", startDate: "2026-11-05", endDate: "2026-11-06" }),
        201,
      ),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });
    await user.click(await screen.findByRole("button", { name: "添加节点" }));
    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "金泽");

    expect(
      await screen.findByText("地点搜索暂时不可用，你可以直接手动填写城市和国家。"),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("option", { name: "使用「金泽」作为城市" }, { timeout: 3000 }),
    );

    expect(screen.getByLabelText("城市")).toHaveValue("金泽");
    fireEvent.change(screen.getByLabelText("国家"), { target: { value: "日本" } });
    fireEvent.change(screen.getByLabelText("国家码"), { target: { value: "JP" } });
    fillDates();
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(stopPosts(calls)).toHaveLength(1);
    });
    expect(stopPosts(calls)[0]?.body).toMatchObject({
      city: "金泽",
      country: "日本",
      countryCode: "JP",
      provider: null,
      providerPlaceId: null,
      timeZone: null,
      address: null,
      bbox: null,
    });
  });

  it("编辑已有节点时保留已保存的地点元数据", async () => {
    const user = userEvent.setup();
    const stop = makeStop({
      id: STOP_ID,
      city: "奈良",
      country: "日本",
      countryCode: "JP",
      lat: 34.6851,
      lng: 135.8048,
      provider: "geoapify",
      providerPlaceId: "nara-1",
      timeZone: "Asia/Tokyo",
      address: "奈良市, 奈良县, 日本",
      bbox: [135.7, 34.6, 135.9, 34.8],
      startDate: "2026-11-05",
      endDate: "2026-11-06",
      version: 4,
      order: 2,
    });
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [stop]),
      route("PATCH", `/v1/stops/${STOP_ID}`, { ...stop, notes: "从近铁站步行" }),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });
    await user.click(await screen.findByRole("button", { name: "编辑行程节点 奈良" }));
    fireEvent.change(screen.getByLabelText("备注（可选）"), {
      target: { value: "从近铁站步行" },
    });
    await user.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => {
      expect(
        calls.filter((call) => call.method === "PATCH" && call.url === `/v1/stops/${STOP_ID}`),
      ).toHaveLength(1);
    });
    const patch = calls.find(
      (call) => call.method === "PATCH" && call.url === `/v1/stops/${STOP_ID}`,
    );
    expect(patch?.body).toMatchObject({
      version: 4,
      lat: 34.6851,
      lng: 135.8048,
      provider: "geoapify",
      providerPlaceId: "nara-1",
      timeZone: "Asia/Tokyo",
      address: "奈良市, 奈良县, 日本",
      bbox: [135.7, 34.6, 135.9, 34.8],
    });
  });
});
