import type { Place } from "@roamlog/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CoverMediaClient } from "@/lib/api/media";
import { renderWithQuery } from "@/test/query-harness";

import { DestinationsField } from "../destinations-field";
import { TripForm, type TripFormPlaceSearch } from "../trip-form";

/**
 * CoverUploader is the only network seam the form owns; keep it on the real
 * implementation unless a test swaps in a double.
 */
const mediaClient = vi.hoisted(() => ({ current: null as CoverMediaClient | null }));

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

const WORKSPACE_ID = "0198f000-0000-7000-8000-0000000000c1";

function renderForm(searchPlaces: TripFormPlaceSearch) {
  return renderWithQuery(
    <TripForm
      mode="create"
      workspaceId={WORKSPACE_ID}
      workspaceName="漫游小组"
      searchPlaces={searchPlaces}
      cancelHref="/w/roamlog-crew/trips"
      onSubmit={vi.fn(async () => undefined)}
    />,
  );
}

/**
 * The whole chain under test: injected place-search adapter → TripForm's
 * combobox mapper → OriginField wrapper → SearchableCombobox → footer.
 */
describe("trip form place attribution", () => {
  it("shows both Geoapify and OSM credits when the adapter reports geoapify", async () => {
    const user = userEvent.setup();
    const searchPlaces = vi.fn<TripFormPlaceSearch>(async () => ({
      items: [KYOTO],
      degraded: false,
      provider: "geoapify",
    }));
    renderForm(searchPlaces);

    await user.type(screen.getByRole("combobox", { name: "旅行起点" }), "京都");
    const credit = await screen.findByTestId("places-attribution");

    expect(searchPlaces).toHaveBeenCalled();
    expect(credit).toHaveAttribute("data-provider", "geoapify");
    expect(credit).toHaveTextContent("Powered by Geoapify");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Photon/);

    const link = within(credit).getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.geoapify.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows 手动录入 and no third-party link when the adapter reports local", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn<TripFormPlaceSearch>(async () => ({
        items: [KYOTO],
        provider: "local",
      })),
    );

    await user.type(screen.getByRole("combobox", { name: "旅行起点" }), "京都");
    const credit = await screen.findByTestId("places-attribution");

    expect(credit).toHaveTextContent("手动录入");
    expect(within(credit).queryByRole("link")).toBeNull();
    expect(credit).not.toHaveTextContent(/Geoapify|Photon|OpenStreetMap|OSM/);
  });

  it("reserves no footer space when the search returns no results", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn<TripFormPlaceSearch>(async () => ({
        items: [],
        provider: "geoapify",
      })),
    );

    await user.type(screen.getByRole("combobox", { name: "旅行起点" }), "京都");
    await screen.findByRole("option", { name: /使用「京都」作为起点/ });

    expect(screen.queryByTestId("places-attribution")).not.toBeInTheDocument();
  });
});

describe("destinations field place attribution", () => {
  it("credits Photon for the destination combobox", async () => {
    const user = userEvent.setup();
    render(
      <DestinationsField
        comboboxId="trip-destination-search"
        manualInputId="trip-destination-manual"
        destinations={[]}
        countryCodes={{}}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        search={vi.fn(async () => ({
          items: [{ id: "photon:1", label: "金泽", description: "city · 日本", meta: "JP" }],
          provider: "photon" as const,
        }))}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索目的地" }), "金泽");
    const credit = await screen.findByTestId("places-attribution");

    expect(credit).toHaveAttribute("data-provider", "photon");
    expect(credit).toHaveTextContent("Search by Photon");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Geoapify/);
    expect(within(credit).getByRole("link")).toHaveAttribute(
      "href",
      "https://photon.komoot.io/",
    );
  });
});