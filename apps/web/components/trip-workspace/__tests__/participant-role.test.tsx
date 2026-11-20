import type { TripParticipant } from "@roamlog/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_NOW,
  TEST_USER_ID,
  TEST_WORKSPACE_ID,
  makeTrip,
  makeUser,
  makeWorkspace,
} from "@/test/fake-data";

import { ParticipantsTab } from "../participants-tab";
import { adapterWith, makeMember, problem, renderTab, route, stubFetch } from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000c1";
const OTHER_USER_ID = "0198f000-0000-7000-8000-0000000000c2";
const PARTICIPANT_ID = "0198f000-0000-7000-8000-0000000000c3";

function participantOf(overrides: Partial<TripParticipant> = {}): TripParticipant {
  return {
    id: PARTICIPANT_ID,
    workspaceId: TEST_WORKSPACE_ID,
    tripId: TRIP_ID,
    userId: OTHER_USER_ID,
    status: "joined",
    role: "viewer",
    joinedAt: TEST_NOW,
    invitedAt: TEST_NOW,
    respondedAt: null,
    ...overrides,
  };
}

function setup(role: "owner" | "admin" | "editor" | "viewer", createdById = OTHER_USER_ID) {
  const workspace = makeWorkspace({ role });
  const trip = makeTrip({ id: TRIP_ID, title: "京都慢行", createdById });
  adapterState.adapter = adapterWith({
    workspace,
    members: [
      makeMember(makeUser({ id: TEST_USER_ID, name: "顾行舟" }), role),
      makeMember(makeUser({ id: OTHER_USER_ID, name: "沈青禾" }), "viewer"),
    ],
    trips: [trip],
  });
  return { workspace, trip };
}

function renderParticipants(context: { trip: ReturnType<typeof makeTrip>; workspace: ReturnType<typeof makeWorkspace> }) {
  return renderTab(<ParticipantsTab tripId={TRIP_ID} />, context);
}

beforeEach(() => {
  vi.stubGlobal("fetch", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("参与者角色调整", () => {
  it("Owner 改角色：PATCH 正确端点与 body，并用返回 participant 更新列表", async () => {
    const context = setup("owner");
    const calls = stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [participantOf()]),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}/participants/${OTHER_USER_ID}`,
        participantOf({ role: "editor" }),
      ),
    ]);
    const user = userEvent.setup();
    renderParticipants(context);

    const select = await screen.findByRole("combobox", { name: "更改 沈青禾 的旅行角色" });
    expect(select).toHaveValue("viewer");
    await user.selectOptions(select, "editor");

    await waitFor(() => expect(select).toHaveValue("editor"));
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toBe(`/v1/trips/${TRIP_ID}/participants/${OTHER_USER_ID}`);
    expect(patches[0]?.body).toEqual({ role: "editor" });
  });

  it("Admin 改角色：非创建者的 Workspace Admin 也能调整", async () => {
    const context = setup("admin", OTHER_USER_ID);
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [participantOf()]),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}/participants/${OTHER_USER_ID}`,
        participantOf({ role: "editor" }),
      ),
    ]);
    const user = userEvent.setup();
    renderParticipants(context);

    const select = await screen.findByRole("combobox", { name: "更改 沈青禾 的旅行角色" });
    await user.selectOptions(select, "editor");
    await waitFor(() => expect(select).toHaveValue("editor"));
  });

  it("角色保存失败时显示可读错误并回滚选择", async () => {
    const context = setup("owner");
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [participantOf()]),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}/participants/${OTHER_USER_ID}`,
        problem(500, "INTERNAL_ERROR", "role update failed"),
        500,
      ),
    ]);
    const user = userEvent.setup();
    renderParticipants(context);

    const select = await screen.findByRole("combobox", { name: "更改 沈青禾 的旅行角色" });
    await user.selectOptions(select, "editor");

    expect(await screen.findByRole("alert")).toHaveTextContent("角色调整失败（HTTP 500）");
    expect(select).toHaveValue("viewer");
  });

  it("Viewer 看不到角色控件，只看到只读说明", async () => {
    const context = setup("viewer", TEST_USER_ID);
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/participants`, [participantOf()])]);
    renderParticipants(context);

    expect(await screen.findByText("沈青禾")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "更改 沈青禾 的旅行角色" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("不能添加或移除");
  });

  it("非创建者的 Editor 看不到角色控件", async () => {
    const context = setup("editor", OTHER_USER_ID);
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/participants`, [participantOf()])]);
    renderParticipants(context);

    expect(await screen.findByText("沈青禾")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "更改 沈青禾 的旅行角色" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("只有行程创建者");
  });
});
