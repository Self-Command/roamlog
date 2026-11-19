import type { CreateTripRequest, Place } from "@roamlog/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CoverMediaClient } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import {
  addDays,
  formatDateOnlyLabel,
  formatMonthLabel,
  parseDateOnly,
  todayDateOnly,
} from "../date-utils";
import { DEFAULT_TRIP_NIGHTS } from "../trip-form-state";
import {
  COVER_MEDIA_ID,
  createFakeMediaClient,
  makeTripCover,
  type FakeMediaClientCalls,
} from "@/test/cover-upload-doubles";
import { makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { TripForm, type TripFormPlaceSearch, type TripFormSubmitContext } from "../trip-form";

/**
 * The only network seam the form owns is the media client; swap it for the
 * deterministic double so the real `CoverUploader` runs end to end.
 */
const mediaClient = vi.hoisted(() => ({
  current: null as CoverMediaClient | null,
}));

vi.mock("@/lib/api/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/media")>();
  return {
    ...actual,
    createCoverMediaClient: () => mediaClient.current ?? actual.createCoverMediaClient(),
  };
});

const KYOTO: Place = {
  provider: "geoapify",
  providerPlaceId: "k-1",
  name: "京都",
  address: "京都市, 京都府, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  timeZone: "Asia/Tokyo",
  bbox: [135.6, 34.85, 135.93, 35.17],
  importance: 0.19,
  type: "city",
};

const searchPlaces: TripFormPlaceSearch = vi.fn(async () => ({ items: [KYOTO], degraded: false }));

const today = todayDateOnly();

let calls: FakeMediaClientCalls;

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:cover-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function useFakeMediaClient() {
  const doubles = createFakeMediaClient();
  mediaClient.current = doubles.client;
  calls = doubles.calls;
  return doubles;
}

function makeImage(name = "cover.jpg", type = "image/jpeg", size = 2_048): File {
  const file = new File(["image-bytes"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("TripForm create", () => {
  it("不在创建表单里提供精确位置开关，因为创建契约没有该字段", () => {
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    // `CreateTripRequest` has no `showExactPhotoLocation`; offering the control
    // would be a switch that silently cannot be saved.
    expect(screen.queryByRole("switch", { name: "公开页显示精确位置" })).toBeNull();
    expect(screen.queryByText("07 / 隐私")).toBeNull();
  });

  it("blocks submit and surfaces the required-title error", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    expect(await screen.findByText("请填写旅行标题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建旅行" })).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("captures the full CreateTripRequest from the real field components", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const { client, calls: fakeCalls } = useFakeMediaClient();
    void client;

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        workspaceName="漫游小组"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "京都七日");

    // Origin: pick a real place, which must carry lat/lng/country/timezone.
    await user.type(screen.getByRole("combobox", { name: "旅行起点" }), "京都");
    await user.click(await screen.findByRole("option", { name: /^京都/ }));
    // The selected origin shows the provider's full address, not just a code.
    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    expect(screen.getByText("地点库")).toBeInTheDocument();

    // Destination: manual entry (no coordinates invented).
    await user.type(screen.getByLabelText("手动添加目的地"), "金泽");
    await user.click(screen.getByRole("button", { name: "添加" }));

    await user.type(screen.getByLabelText("预算金额"), "12000.50");
    await user.type(screen.getByRole("combobox", { name: "搜索币种" }), "CNY");
    await user.click(await screen.findByRole("option", { name: /^CNY/ }));

    await user.type(screen.getByRole("textbox", { name: "添加标签" }), "寺庙{Enter}");
    await user.type(screen.getByRole("textbox", { name: "添加同行人" }), "小林{Enter}");

    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, context] = onSubmit.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { coverMediaId: string | null },
    ];

    expect(payload).toEqual({
      title: "京都七日",
      status: "planning",
      visibility: "workspace",
      startDate: today,
      endDate: addDays(today, DEFAULT_TRIP_NIGHTS),
      origin: "京都",
      originLat: KYOTO.lat,
      originLng: KYOTO.lng,
      originCountryCode: "JP",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.6, 34.85, 135.93, 35.17],
      timeZone: "Asia/Tokyo",
      destinationsV2: [
        {
          name: "金泽",
          provider: "local",
          providerPlaceId: null,
          address: null,
          country: null,
          countryCode: null,
          lat: null,
          lng: null,
          timeZone: null,
          bbox: null,
        },
      ],
      countryCodes: ["JP"],
      tags: ["寺庙"],
      guestNames: ["小林"],
      budgetAmountMinor: 1200050,
      budgetCurrency: "CNY",
    });
    expect(context).toEqual({ coverMediaId: null });
    expect(fakeCalls.setCover).toHaveLength(0);
  });

  it("opens a one-week window, allows a future start and moves the end with it", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole("button", { name: `选择日期：${formatDateOnlyLabel(today)}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `选择日期：${formatDateOnlyLabel(addDays(today, DEFAULT_TRIP_NIGHTS))}`,
      }),
    ).toBeInTheDocument();

    // One day beyond the default window used to be outside `max={endDate}`.
    const future = addDays(today, DEFAULT_TRIP_NIGHTS + 1);
    await user.click(
      screen.getByRole("button", { name: `选择日期：${formatDateOnlyLabel(today)}` }),
    );
    const grid = await screen.findByRole("grid", { name: "选择出发日期" });

    const futureParts = parseDateOnly(future);
    if (!futureParts) throw new Error(`invalid test date: ${future}`);
    const targetMonth = formatMonthLabel(futureParts.year, futureParts.month);
    for (let step = 0; step < 2 && !screen.queryByText(targetMonth); step += 1) {
      await user.click(screen.getByRole("button", { name: "下个月" }));
    }

    const cell = within(grid).getByRole("gridcell", { name: String(futureParts.day) });
    expect(cell).not.toHaveAttribute("aria-disabled");
    await user.click(cell);

    // The start pick moved and the end followed, so both triggers now agree.
    expect(
      screen.getAllByRole("button", { name: `选择日期：${formatDateOnlyLabel(future)}` }),
    ).toHaveLength(2);
  });

  it("forwards the uploaded coverMediaId and keeps the media when create fails", async () => {
    const onSubmit = vi
      .fn<(input: CreateTripRequest, context: TripFormSubmitContext) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    const { client } = useFakeMediaClient();
    void client;

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "带封面");
    await user.upload(screen.getByLabelText("选择旅行封面"), makeImage());

    expect(await screen.findByText("图片已上传完成，创建旅行后即可使用。")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "创建旅行" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "创建旅行" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ coverMediaId: COVER_MEDIA_ID });
    expect(onSubmit.mock.calls[1]?.[1]).toEqual({ coverMediaId: COVER_MEDIA_ID });
    // The form uploads only; binding the cover to the new trip belongs to the shell.
    expect(calls.setCover).toHaveLength(0);
  });
});

describe("TripForm edit", () => {
  it("submits only the changed field plus version", async () => {
    const trip = makeTrip({ version: 4, countryCodes: ["CN", "JP"] });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "冬季京都");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ version: 4, title: "冬季京都" });
  });

  it("restores the saved origin address and bbox instead of looking unsaved", async () => {
    const trip = makeTrip({
      version: 4,
      countryCodes: ["CN", "JP"],
      origin: "京都",
      originLat: 35.0116,
      originLng: 135.7681,
      originCountryCode: "JP",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.6, 34.85, 135.93, 35.17],
      timeZone: "Asia/Tokyo",
    });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    // The edit form shows the persisted address, so a refresh does not look like
    // the selection was lost.
    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    // The restored origin also keeps its timezone, so the field looks complete.
    expect(screen.getAllByText("Asia/Tokyo").length).toBeGreaterThan(0);

    // Echoing it must not fabricate a change: only the title travels.
    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "冬季京都");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ version: 4, title: "冬季京都" });
  });

  it("提交公开页精确位置开关：默认开启，关闭时带上 false 与正确 version", async () => {
    // The fixture has no `showExactPhotoLocation`, so the form must fall back to
    // the product default (`true`) instead of rendering an indeterminate switch.
    const trip = makeTrip({ version: 7, countryCodes: ["CN", "JP"] });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "公开页显示精确位置" });
    expect(toggle).toBeChecked();
    expect(screen.getByText("影响公开分享页")).toBeInTheDocument();
    // The promise must match what the API enforces: the share page only, never
    // the in-app map or photo detail.
    expect(toggle).toHaveAccessibleDescription(/公开分享页只显示城市/);
    expect(toggle).not.toHaveAccessibleDescription(/地图/);

    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存旅行" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // The version must ride along so the server can reject a stale write.
    expect(onSubmit).toHaveBeenCalledWith({ version: 7, showExactPhotoLocation: false });
  });

  it("explains that nothing changed instead of sending an empty patch", async () => {
    const trip = makeTrip({ countryCodes: ["CN", "JP"] });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    expect(await screen.findByText("没有检测到修改，未提交请求。")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("passes the trip to the cover uploader for edit mode and binds no new cover", async () => {
    const trip = makeTrip({
      countryCodes: ["CN", "JP"],
      coverMediaId: COVER_MEDIA_ID,
      cover: makeTripCover(),
    });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("img", { name: "当前旅行封面" })).toHaveAttribute(
      "src",
      "https://media.example.test/trips/cover-large.jpg",
    );

    await user.click(screen.getByRole("button", { name: "保存旅行" }));
    expect(await screen.findByText("没有检测到修改，未提交请求。")).toBeInTheDocument();

    expect(calls.setCover).toHaveLength(0);
    expect(calls.clearCover).toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("turns a 409 into a conflict banner with a reload action", async () => {
    const trip = makeTrip({ countryCodes: ["CN", "JP"], version: 2 });
    const onSubmit = vi.fn(async () => {
      throw new ApiError(409, "Trip was updated by someone else.", "VERSION_CONFLICT");
    });
    const onReload = vi.fn();
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
        onReload={onReload}
      />,
    );

    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "被覆盖的标题");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("409 版本冲突");
    await user.click(screen.getByRole("button", { name: "重新加载最新版本" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
describe("TripForm structured destinations", () => {
  const KYOTO_DESTINATION = {
    id: "0198f000-0000-7000-8000-0000000000d1",
    name: "京都",
    provider: "geoapify" as const,
    providerPlaceId: "k-1",
    address: "京都市, 京都府, 日本",
    country: "日本",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    timeZone: "Asia/Tokyo",
    bbox: [135.6, 34.85, 135.93, 35.17] as [number, number, number, number],
    order: 0,
  };
  const OSAKA_DESTINATION = {
    ...KYOTO_DESTINATION,
    id: "0198f000-0000-7000-8000-0000000000d2",
    name: "大阪",
    address: "大阪市, 大阪府, 日本",
    lat: 34.6937,
    lng: 135.5023,
    order: 1,
  };

  it("submits a searched destination with its address, coordinates and timezone", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref="/w/roamlog-crew/trips"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "北陆七日");
    await user.type(screen.getByRole("combobox", { name: "搜索目的地" }), "京都");
    await user.click(await screen.findByRole("option", { name: /^京都/ }));

    // The picked place is echoed with its provider address and coordinates.
    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    expect(screen.getByText("35.0116, 135.7681")).toBeInTheDocument();
    expect(screen.getByText("地点库")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建旅行" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const [payload] = onSubmit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(payload.destinationsV2).toEqual([
      {
        name: "京都",
        provider: "geoapify",
        providerPlaceId: "k-1",
        address: "京都市, 京都府, 日本",
        country: "日本",
        countryCode: "JP",
        lat: 35.0116,
        lng: 135.7681,
        timeZone: "Asia/Tokyo",
        bbox: [135.6, 34.85, 135.93, 35.17],
      },
    ]);
    // The deprecated names array is no longer submitted by the form.
    expect(payload).not.toHaveProperty("destinations");
    expect(payload.countryCodes).toEqual(["JP"]);
  });

  it("echoes stored destination metadata on edit without rewriting it", async () => {
    const trip = makeTrip({
      version: 5,
      countryCodes: ["CN", "JP"],
      destinations: ["京都", "大阪"],
      destinationsV2: [KYOTO_DESTINATION, OSAKA_DESTINATION],
    });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    expect(screen.getByText("大阪市, 大阪府, 日本")).toBeInTheDocument();
    expect(screen.getByText("35.0116, 135.7681")).toBeInTheDocument();
    expect(screen.getAllByText("Asia/Tokyo").length).toBeGreaterThan(0);
    expect(screen.getByText("2/30")).toBeInTheDocument();

    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "冬季关西");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // An untouched route must not be part of the patch.
    expect(onSubmit).toHaveBeenCalledWith({ version: 5, title: "冬季关西" });
  });

  it("submits the new order after moving a destination", async () => {
    const trip = makeTrip({
      version: 2,
      countryCodes: ["CN", "JP"],
      destinations: ["京都", "大阪"],
      destinationsV2: [KYOTO_DESTINATION, OSAKA_DESTINATION],
    });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下移「京都」" }));
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [patch] = onSubmit.mock.calls[0] as unknown as [
      {
        version: number;
        destinationsV2?: Array<{ name: string; lat: number | null }>;
      },
    ];
    expect(patch.version).toBe(2);
    expect(patch.destinationsV2?.map((destination) => destination.name)).toEqual([
      "大阪",
      "京都",
    ]);
    // Metadata travels with the moved row instead of being dropped.
    expect(patch.destinationsV2?.[1]?.lat).toBe(35.0116);
  });

  it("shows a names-only legacy trip and upgrades a row through search", async () => {
    const trip = makeTrip({
      version: 3,
      countryCodes: ["CN", "JP"],
      destinations: ["京都"],
      destinationsV2: [],
    });
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    useFakeMediaClient();

    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId="0198f000-0000-7000-8000-0000000000c1"
        searchPlaces={searchPlaces}
        cancelHref={`/w/roamlog-crew/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByText("仅名称")).toBeInTheDocument();
    // Origin and destination both report missing coordinates in this fixture.
    expect(screen.getAllByText("坐标为空").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "搜索替换「京都」" }));
    await user.click(await screen.findByRole("option", { name: /^京都/ }));

    expect(await screen.findByText("京都市, 京都府, 日本")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [patch] = onSubmit.mock.calls[0] as unknown as [
      { destinationsV2?: Array<Record<string, unknown>> },
    ];
    expect(patch.destinationsV2).toEqual([
      {
        name: "京都",
        provider: "geoapify",
        providerPlaceId: "k-1",
        address: "京都市, 京都府, 日本",
        country: "日本",
        countryCode: "JP",
        lat: 35.0116,
        lng: 135.7681,
        timeZone: "Asia/Tokyo",
        bbox: [135.6, 34.85, 135.93, 35.17],
      },
    ]);
  });
});
