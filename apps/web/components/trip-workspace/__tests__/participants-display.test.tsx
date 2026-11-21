import type { TripParticipant } from "@roamlog/contracts";
import { screen } from "@testing-library/react";
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

const TRIP_ID = "0198f000-0000-7000-8000-0000000000g1";
const OTHER_USER_ID = "0198f000-0000-7000-8000-0000000000g2";
const PARTICIPANT_ID = "0198f000-0000-7000-8000-0000000000g3";

const TRIP = makeTrip({
  id: TRIP_ID,
  title: "京都慢行",
  startDate: "2026-11-01",
  endDate: "2026-11-03",
});
const EDITOR = makeWorkspace({ role: "editor" });
const VIEWER = makeWorkspace({ role: "viewer" });

const SELF_MEMBER = makeMember(makeUser({ id: TEST_USER_ID, name: "顾行舟" }), "editor");
const FRIEND_MEMBER = makeMember(
  makeUser({ id: OTHER_USER_ID, name: "沈青禾" }),
  "viewer",
);

/** The two spellings the screen must tolerate: the new invitation vocabulary and
 * the `invited` / `joined` values `presentParticipant` emits today. */
type UnknownStatus = TripParticipant["status"];

function participantOf(
  overrides: Partial<TripParticipant> & { id: string; userId: string },
): TripParticipant {
  return {
    workspaceId: TEST_WORKSPACE_ID,
    tripId: TRIP_ID,
    status: "invited",
    role: "viewer",
    joinedAt: TEST_NOW,
    invitedAt: TEST_NOW,
    respondedAt: null,
    ...overrides,
  };
}

function renderParticipants(workspace = EDITOR) {
  return renderTab(<ParticipantsTab tripId={TRIP_ID} />, { trip: TRIP, workspace });
}

beforeEach(() => {
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [SELF_MEMBER, FRIEND_MEMBER],
    trips: [TRIP],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("参与者：真实邀请状态与角色", () => {
  it("待接受的邀请显示「待接受」徽章、角色徽章与邀请时间", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "pending" as unknown as UnknownStatus,
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("待接受")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.getByText("沈青禾")).toBeInTheDocument();
    expect(screen.getByText(/邀请于/)).toBeInTheDocument();
    expect(screen.queryByText("已接受")).not.toBeInTheDocument();
  });

  it("已接受的邀请显示「已接受」徽章，并区分邀请与加入时间", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "accepted" as unknown as UnknownStatus,
          joinedAt: "2026-11-02T02:00:00.000Z",
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("已接受")).toBeInTheDocument();
    expect(screen.getByText(/邀请于/)).toBeInTheDocument();
    expect(screen.getByText(/加入于/)).toBeInTheDocument();
    expect(screen.queryByText("待接受")).not.toBeInTheDocument();
  });

  it("兼容服务端当前的 invited / joined 词表", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "joined",
          role: "editor",
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("已接受")).toBeInTheDocument();
    // Workspace member role (viewer) wins over the trip invitation role (editor):
    // workspace grants cover every member.
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("明确拒绝邀请显示「已拒绝」而不是「未知」", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "declined",
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("已拒绝")).toBeInTheDocument();
    expect(screen.queryByText("未知")).not.toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("未知邀请状态显示「未知」而不是空白或崩溃", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "paused" as unknown as UnknownStatus,
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("未知")).toBeInTheDocument();
    expect(screen.getByText("沈青禾")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("没有 invitedAt 时不显示邀请时间", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({
          id: PARTICIPANT_ID,
          userId: OTHER_USER_ID,
          status: "accepted" as unknown as UnknownStatus,
          invitedAt: "",
        }),
      ]),
    ]);

    renderParticipants();

    expect(await screen.findByText("已接受")).toBeInTheDocument();
    expect(screen.queryByText(/邀请于/)).not.toBeInTheDocument();
    expect(screen.getByText(/加入于/)).toBeInTheDocument();
  });

  it("说明新邀请默认 viewer、分享链接与参与者相互独立，创建者可调整旅行角色", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({ id: PARTICIPANT_ID, userId: OTHER_USER_ID }),
      ]),
    ]);

    renderParticipants();

    expect(
      await screen.findByText(
        /新邀请默认是 viewer，可另行提升为 editor；分享链接与参与者相互独立/,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: "更改 沈青禾 的旅行角色" }),
    ).toHaveValue("viewer");
  });

  it("没有参与者时显示可读空状态，规则说明仍然存在", async () => {
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/participants`, [])]);

    renderParticipants();

    expect(await screen.findByText("还没有参与者")).toBeInTheDocument();
    expect(screen.getByText(/新邀请默认是 viewer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加第一位/ })).toBeEnabled();
  });

  it("Viewer 只读：添加/移除被阻止并有一行可读说明", async () => {
    adapterState.adapter = adapterWith({
      workspace: VIEWER,
      members: [SELF_MEMBER, FRIEND_MEMBER],
      trips: [TRIP],
    });
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/participants`, [])]);

    renderParticipants(VIEWER);

    expect(await screen.findByRole("note")).toHaveTextContent("不能添加或移除");
    expect(await screen.findByText("还没有参与者")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加参与者/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /添加第一位/ })).toBeDisabled();
  });

  it("角色调整失败时使用用户语言，不暴露 HTTP 或状态码", async () => {
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/participants`, [
        participantOf({ id: PARTICIPANT_ID, userId: OTHER_USER_ID }),
      ]),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}/participants/${OTHER_USER_ID}`,
        problem(500, "INTERNAL_ERROR", "role update failed"),
        500,
      ),
    ]);

    const user = userEvent.setup();
    renderParticipants();

    const select = await screen.findByRole("combobox", { name: "更改 沈青禾 的旅行角色" });
    await user.selectOptions(select, "editor");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("角色调整失败，请稍后重试。");
    expect(alert).not.toHaveTextContent(/HTTP|服务端|后端|API|数据库|500/);
    expect(select).toHaveValue("viewer");
  });
});
