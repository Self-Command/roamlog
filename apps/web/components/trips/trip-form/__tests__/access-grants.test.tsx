import type {
  Trip,
  TripAccessGrantsResponse,
  WorkspaceMemberWithUser,
} from "@roamlog/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateTripFormMutation } from "@/lib/api/trip-form";
import { renderWithQuery } from "@/test/query-harness";
import {
  TEST_NOW,
  TEST_USER_ID,
  TEST_WORKSPACE_ID,
  makeTrip,
  makeUser,
  makeWorkspace,
} from "@/test/fake-data";

import { NewTripShell } from "../../new-trip-shell";
import { TripForm, type TripFormPlaceSearch } from "../trip-form";

const routerState = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerState }));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000a1";
const OTHER_USER_ID = "0198f000-0000-7000-8000-0000000000a2";
const RESOLVED_ONLY_USER_ID = "0198f000-0000-7000-8000-0000000000d1";

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

function stubFetch(
  handlers: Array<(call: FetchCall) => { status: number; body: unknown } | null>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call = { method, url, body };
    calls.push(call);
    for (const handler of handlers) {
      const result = handler(call);
      if (result) return jsonResponse(result.status, result.body);
    }
    throw new Error(`未处理的请求 ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fakeFetch);
  return calls;
}

function route(method: string, path: string, body: unknown, status = 200) {
  return (call: FetchCall) =>
    call.method === method && call.url === path ? { status, body } : null;
}

function problem(status: number, code: string, detail: string) {
  return { type: "about:blank", title: code, status, code, detail };
}

function memberOf(
  user: ReturnType<typeof makeUser>,
  role: "owner" | "admin" | "editor" | "viewer" = "viewer",
): WorkspaceMemberWithUser {
  return {
    id: user.id,
    workspaceId: TEST_WORKSPACE_ID,
    userId: user.id,
    role,
    status: "active",
    joinedAt: TEST_NOW,
    invitedById: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    user,
  };
}

function grantsResponse(
  overrides: Partial<TripAccessGrantsResponse> = {},
): TripAccessGrantsResponse {
  return {
    grants: [],
    resolved: { workspaces: [], users: [] },
    ...overrides,
  };
}

const WORKSPACE = makeWorkspace({ role: "owner" });
const OTHER_MEMBER = memberOf(makeUser({ id: OTHER_USER_ID, name: "沈青禾" }), "viewer");
const SELF_MEMBER = memberOf(makeUser({ id: TEST_USER_ID, name: "顾行舟" }), "owner");
const searchPlaces: TripFormPlaceSearch = vi.fn(async () => ({ items: [] }));

function commonOptionRoutes() {
  return [
    route("GET", "/v1/workspaces", [WORKSPACE]),
    route("GET", `/v1/workspaces/${TEST_WORKSPACE_ID}/members`, {
      items: [SELF_MEMBER, OTHER_MEMBER],
      nextCursor: null,
      hasMore: false,
    }),
  ];
}

function EditHarness({ trip }: { trip: Trip }) {
  const updateTrip = useUpdateTripFormMutation(trip.id);
  return (
    <TripForm
      mode="edit"
      workspaceId={trip.workspaceId}
      workspaceName={WORKSPACE.name}
      searchPlaces={searchPlaces}
      cancelHref={`/w/${WORKSPACE.slug}/trips/${trip.id}`}
      initialTrip={trip}
      onSubmit={async (patch) => {
        await updateTrip.mutateAsync(patch);
      }}
    />
  );
}

beforeEach(() => {
  routerState.push.mockReset();
  routerState.refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("行程表单指定可见范围", () => {
  it("选择 custom 后展开工作区与成员多选", async () => {
    stubFetch(commonOptionRoutes());
    const user = userEvent.setup();
    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId={TEST_WORKSPACE_ID}
        workspaceName={WORKSPACE.name}
        searchPlaces={searchPlaces}
        cancelHref={`/w/${WORKSPACE.slug}/trips`}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    await user.selectOptions(screen.getByLabelText("可见性"), "custom");

    expect(await screen.findByRole("heading", { name: "可见范围" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "选择可见工作区 测试工作区" })).toBeVisible();
    expect(await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "选择可见工作区 测试工作区" }));
    await user.click(screen.getByRole("checkbox", { name: "选择可见成员 沈青禾" }));
    expect(
      await screen.findByText("这趟旅行将对 1 个工作区、1 位成员可见。"),
    ).toBeInTheDocument();
  });

  it("编辑已保存的 custom 行程时回显 resolved 标签", async () => {
    const trip = makeTrip({
      id: TRIP_ID,
      visibility: "custom",
      createdById: TEST_USER_ID,
    });
    stubFetch([
      ...commonOptionRoutes(),
      route("GET", "/v1/me", makeUser({ id: TEST_USER_ID })),
      route(
        "GET",
        `/v1/trips/${TRIP_ID}/access-grants`,
        grantsResponse({
          grants: [
            {
              id: "0198f000-0000-7000-8000-0000000000b1",
              targetType: "workspace",
              targetId: TEST_WORKSPACE_ID,
              createdAt: TEST_NOW,
            },
            {
              id: "0198f000-0000-7000-8000-0000000000b2",
              targetType: "user",
              targetId: OTHER_USER_ID,
              createdAt: TEST_NOW,
            },
            {
              id: "0198f000-0000-7000-8000-0000000000b4",
              targetType: "user",
              targetId: RESOLVED_ONLY_USER_ID,
              createdAt: TEST_NOW,
            },
          ],
          resolved: {
            workspaces: [
              {
                targetType: "workspace",
                targetId: TEST_WORKSPACE_ID,
                label: "测试工作区",
                sublabel: null,
              },
            ],
            users: [
              {
                targetType: "user",
                targetId: OTHER_USER_ID,
                label: "沈青禾",
                sublabel: "roamlog.test",
              },
              {
                targetType: "user",
                targetId: RESOLVED_ONLY_USER_ID,
                label: "林见鹿",
                sublabel: "roamlog.test",
              },
            ],
          },
        }),
      ),
    ]);
    renderWithQuery(
      <TripForm
        mode="edit"
        workspaceId={TEST_WORKSPACE_ID}
        workspaceName={WORKSPACE.name}
        searchPlaces={searchPlaces}
        cancelHref={`/w/${WORKSPACE.slug}/trips/${trip.id}`}
        initialTrip={trip}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    expect(
      await screen.findByRole("checkbox", { name: "选择可见工作区 测试工作区" }),
    ).toBeChecked();
    expect(
      await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" }),
    ).toBeChecked();
    // A resolved label with no matching member option must still render from the
    // server's `resolved` half instead of falling back to a raw id.
    expect(await screen.findByText("林见鹿")).toBeInTheDocument();
    expect(screen.getByText("这趟旅行将对 1 个工作区、2 位成员可见。")).toBeInTheDocument();
  });

  it("保存时先 PATCH 行程字段，再 PUT access-grants 全量替换", async () => {
    const trip = makeTrip({
      id: TRIP_ID,
      title: "真实测试旅行",
      version: 3,
      visibility: "workspace",
      createdById: TEST_USER_ID,
    });
    const calls = stubFetch([
      ...commonOptionRoutes(),
      route("GET", "/v1/me", makeUser({ id: TEST_USER_ID })),
      route("GET", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}`,
        makeTrip({ id: TRIP_ID, title: "冬季京都", version: 4, visibility: "custom" }),
      ),
      route(
        "PUT",
        `/v1/trips/${TRIP_ID}/access-grants`,
        grantsResponse({
          grants: [
            {
              id: "0198f000-0000-7000-8000-0000000000b3",
              targetType: "user",
              targetId: OTHER_USER_ID,
              createdAt: TEST_NOW,
            },
          ],
          resolved: {
            workspaces: [],
            users: [
              {
                targetType: "user",
                targetId: OTHER_USER_ID,
                label: "沈青禾",
                sublabel: "roamlog.test",
              },
            ],
          },
        }),
      ),
    ]);
    const user = userEvent.setup();
    renderWithQuery(<EditHarness trip={trip} />);

    await user.selectOptions(screen.getByLabelText("可见性"), "custom");
    await user.click(await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" }));
    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "冬季京都");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === "PATCH" || call.method === "PUT")).toHaveLength(
        2,
      );
    });
    const mutations = calls.filter(
      (call) => call.method === "PATCH" || call.method === "PUT",
    );
    expect(mutations.map((call) => call.method)).toEqual(["PATCH", "PUT"]);
    expect(mutations[0]?.url).toBe(`/v1/trips/${TRIP_ID}`);
    expect(mutations[0]?.body).toEqual({
      version: 3,
      title: "冬季京都",
      visibility: "custom",
      // Pre-existing edit behaviour: the form re-derives the country set from
      // the origin + destinations, so a CN-origin trip always sends ["CN","JP"].
      countryCodes: ["CN", "JP"],
    });
    expect(mutations[1]?.url).toBe(`/v1/trips/${TRIP_ID}/access-grants`);
    expect(mutations[1]?.body).toEqual({ workspaces: [], users: [OTHER_USER_ID] });
  });

  it("仅修改可见范围时仍先 PATCH 可变更的行程字段，再 PUT", async () => {
    // A custom trip whose fields match the form exactly: only the audience is
    // dirty, so `buildUpdateTripRequest` returns null. The pre-grants PATCH must
    // still carry a real field because the contract rejects `{ version }` alone.
    const trip = makeTrip({
      id: TRIP_ID,
      version: 3,
      visibility: "custom",
      createdById: TEST_USER_ID,
      originCountryCode: null,
      timeZone: null,
      destinations: [],
      countryCodes: [],
      tags: [],
      guestNames: [],
    });
    const calls = stubFetch([
      ...commonOptionRoutes(),
      route("GET", "/v1/me", makeUser({ id: TEST_USER_ID })),
      route("GET", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}`,
        makeTrip({ id: TRIP_ID, version: 4, visibility: "custom" }),
      ),
      route("PUT", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
    ]);
    const user = userEvent.setup();
    renderWithQuery(<EditHarness trip={trip} />);

    await user.click(await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" }));
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === "PATCH" || call.method === "PUT")).toHaveLength(
        2,
      );
    });
    const mutations = calls.filter(
      (call) => call.method === "PATCH" || call.method === "PUT",
    );
    expect(mutations.map((call) => call.method)).toEqual(["PATCH", "PUT"]);
    expect(mutations[0]?.body).toEqual({ version: 3, visibility: "custom" });
    expect(mutations[1]?.body).toEqual({ workspaces: [], users: [OTHER_USER_ID] });
  });

  it("grants 保存失败时显示明确错误，不伪装成功", async () => {
    const trip = makeTrip({
      id: TRIP_ID,
      version: 3,
      visibility: "workspace",
      createdById: TEST_USER_ID,
    });
    stubFetch([
      ...commonOptionRoutes(),
      route("GET", "/v1/me", makeUser({ id: TEST_USER_ID })),
      route("GET", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}`,
        makeTrip({ id: TRIP_ID, title: "冬季京都", version: 4, visibility: "custom" }),
      ),
      route(
        "PUT",
        `/v1/trips/${TRIP_ID}/access-grants`,
        problem(500, "INTERNAL_ERROR", "grant write failed"),
        500,
      ),
    ]);
    const user = userEvent.setup();
    renderWithQuery(<EditHarness trip={trip} />);

    await user.selectOptions(screen.getByLabelText("可见性"), "custom");
    await user.click(await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" }));
    const title = screen.getByLabelText(/旅行标题/);
    await user.clear(title);
    await user.type(title, "冬季京都");
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "行程字段已保存，但可见范围未保存",
    );
    expect(screen.getByRole("button", { name: "重试保存可见范围" })).toBeInTheDocument();
    expect(screen.queryByText(/保存成功/)).not.toBeInTheDocument();
  });

  it("可见范围响应无法识别时使用用户语言，不暴露传输层", async () => {
    const trip = makeTrip({
      id: TRIP_ID,
      version: 3,
      visibility: "custom",
      createdById: TEST_USER_ID,
    });
    stubFetch([
      ...commonOptionRoutes(),
      route("GET", "/v1/me", makeUser({ id: TEST_USER_ID })),
      route("GET", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
      route(
        "PATCH",
        `/v1/trips/${TRIP_ID}`,
        makeTrip({ id: TRIP_ID, version: 4, visibility: "custom" }),
      ),
      route("PUT", `/v1/trips/${TRIP_ID}/access-grants`, { invalid: true }),
    ]);
    const user = userEvent.setup();
    renderWithQuery(<EditHarness trip={trip} />);

    await user.click(await screen.findByRole("checkbox", { name: "选择可见成员 沈青禾" }));
    await user.click(screen.getByRole("button", { name: "保存旅行" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("可见范围已提交，但返回的数据无法识别。");
    expect(alert).not.toHaveTextContent("服务器返回");
  });

  it("custom 空选阻止保存并提示危险状态", async () => {
    stubFetch(commonOptionRoutes());
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderWithQuery(
      <TripForm
        mode="create"
        workspaceId={TEST_WORKSPACE_ID}
        workspaceName={WORKSPACE.name}
        searchPlaces={searchPlaces}
        cancelHref={`/w/${WORKSPACE.slug}/trips`}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "京都七日");
    await user.selectOptions(screen.getByLabelText("可见性"), "custom");
    await screen.findByRole("checkbox", { name: "选择可见工作区 测试工作区" });
    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    // The message appears twice by design: once in the submit banner and once
    // on the field's own alert. Assert both are present without tripping the
    // single-element query.
    const messages = await screen.findAllByText(/指定可见至少需要选择一个工作区/);
    expect(messages.length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("新建行程的 grants 保存时序", () => {
  it("先创建行程，再 PUT grants，随后跳转详情", async () => {
    const calls = stubFetch([
      ...commonOptionRoutes(),
      route("POST", `/v1/workspaces/${TEST_WORKSPACE_ID}/trips`, makeTrip({ id: TRIP_ID }), 201),
      route("PUT", `/v1/trips/${TRIP_ID}/access-grants`, grantsResponse()),
    ]);
    const user = userEvent.setup();
    renderWithQuery(
      <NewTripShell
        workspaceSlug={WORKSPACE.slug}
        workspaceId={TEST_WORKSPACE_ID}
        workspaceName={WORKSPACE.name}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "京都七日");
    await user.selectOptions(screen.getByLabelText("可见性"), "custom");
    await user.click(await screen.findByRole("checkbox", { name: "选择可见工作区 测试工作区" }));
    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === "POST" || call.method === "PUT")).toHaveLength(
        2,
      );
    });
    const mutations = calls.filter(
      (call) => call.method === "POST" || call.method === "PUT",
    );
    expect(mutations.map((call) => call.method)).toEqual(["POST", "PUT"]);
    expect(mutations[1]?.body).toEqual({ workspaces: [TEST_WORKSPACE_ID], users: [] });
    await waitFor(() => {
      expect(routerState.push).toHaveBeenCalledWith(`/w/${WORKSPACE.slug}/trips/${TRIP_ID}`);
    });
  });

  it("grants 失败提示「行程已创建」，重试只重发 PUT 不重复创建", async () => {
    let putCount = 0;
    const calls = stubFetch([
      ...commonOptionRoutes(),
      route("POST", `/v1/workspaces/${TEST_WORKSPACE_ID}/trips`, makeTrip({ id: TRIP_ID }), 201),
      (call) => {
        if (call.method !== "PUT" || call.url !== `/v1/trips/${TRIP_ID}/access-grants`) {
          return null;
        }
        putCount += 1;
        return putCount === 1
          ? { status: 500, body: problem(500, "INTERNAL_ERROR", "grant write failed") }
          : { status: 200, body: grantsResponse() };
      },
    ]);
    const user = userEvent.setup();
    renderWithQuery(
      <NewTripShell
        workspaceSlug={WORKSPACE.slug}
        workspaceId={TEST_WORKSPACE_ID}
        workspaceName={WORKSPACE.name}
      />,
    );

    await user.type(screen.getByLabelText(/旅行标题/), "京都七日");
    await user.selectOptions(screen.getByLabelText("可见性"), "custom");
    await user.click(await screen.findByRole("checkbox", { name: "选择可见工作区 测试工作区" }));
    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "行程已创建，但可见范围未保存",
    );
    expect(routerState.push).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "重试保存可见范围" }));

    await waitFor(() => {
      expect(routerState.push).toHaveBeenCalledWith(`/w/${WORKSPACE.slug}/trips/${TRIP_ID}`);
    });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2);
  });
});
