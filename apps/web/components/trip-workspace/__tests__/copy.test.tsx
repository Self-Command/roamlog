import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItineraryList } from "@/components/trips/trip-detail-parts";
import { makeStop, makeTrip, makeUser, makeWorkspace } from "@/test/fake-data";

import { DeleteTripDialog } from "../dialogs";
import { ExpensesTab } from "../expenses-tab";
import { PackingTab } from "../packing-tab";
import { ParticipantsTab } from "../participants-tab";
import { ShareTab } from "../share-tab";
import { StopsTab } from "../stops-tab";
import { adapterWith, makeMember, renderTab, route, stubFetch } from "./harness";

const adapterState = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapterState.adapter,
}));

const TRIP_ID = "0198f000-0000-7000-8000-0000000000a1";
const STOP_ID = "0198f000-0000-7000-8000-0000000000a2";
const TRIP = makeTrip({ id: TRIP_ID, title: "京都慢行" });
const EDITOR = makeWorkspace({ role: "editor" });

/** API paths, provider names and implementation words that must never be copy. */
const DEVELOPER_COPY =
  /POST \/v1|PATCH \/v1|写入|minor units|均摊|后续接入|接入写接口|provider|服务端|前端不拼接|robots/;

beforeEach(() => {
  adapterState.adapter = adapterWith({
    workspace: EDITOR,
    members: [makeMember(makeUser({ name: "顾行舟" }))],
  });
});

describe("行程节点对话框文案", () => {
  it("添加节点用产品语言描述字段，不出现 API 路径或 provider", async () => {
    const user = userEvent.setup();
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/stops`, [])]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: /添加第一个节点/ }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        "记录停留的城市、国家、日期与坐标，可补充备注；不确定坐标时可以留空。",
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });

  it("编辑节点只解释版本冲突，不暴露 PATCH 路径与 version 字段", async () => {
    const user = userEvent.setup();
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/stops`, [makeStop({ id: STOP_ID, version: 3 })]),
    ]);

    renderTab(<StopsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "编辑行程节点 京都" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        "修改这趟停留的城市、日期与备注；如果其他成员同时修改，会请你选择保留哪一版。",
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });
});

describe("费用与分摊文案", () => {
  it("记账对话框用金额与平分说明，不出现 minor units 或均摊", async () => {
    const user = userEvent.setup();
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/expenses`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<ExpensesTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(
      await screen.findByText("金额按币种分开展示，不做汇率折算。记账后预算摘要会立刻更新。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "记一笔" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("记录这笔支出的日期、分类、金额与付款人；费用由选中的参与者平分。"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("按原币种输入金额")).toBeInTheDocument();
    expect(within(dialog).getByText("分摊参与者（平分）")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });
});

describe("行李与参与者对话框文案", () => {
  it("添加行李只说明清单字段，不出现 POST 路径或排序实现", async () => {
    const user = userEvent.setup();
    stubFetch([
      route("GET", `/v1/trips/${TRIP_ID}/packing`, {
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
    ]);

    renderTab(<PackingTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "添加行李" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("把要带的物品加入清单，按分类整理并填写数量。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });

  it("添加参与者保留工作区成员规则，不出现 POST 路径", async () => {
    const user = userEvent.setup();
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/participants`, [])]);

    renderTab(<ParticipantsTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    await user.click(await screen.findByRole("button", { name: "添加参与者" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        "从当前工作区成员中选择一位加入这趟旅行；只有当前工作区成员可以被加入。",
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });
});

describe("分享对话框文案", () => {
  it("创建链接说明公开页边界，不出现 POST 路径或服务端实现", async () => {
    const user = userEvent.setup();
    stubFetch([route("GET", `/v1/trips/${TRIP_ID}/share-links`, [])]);

    renderTab(<ShareTab tripId={TRIP_ID} />, { trip: TRIP, workspace: EDITOR });

    expect(
      await screen.findByText("创建后会显示只读公开页的地址，可设置访问密码和过期时间。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建链接" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        "创建后，拿到链接的人可以阅读这趟旅行的公开内容；公开页只展示旅行、日志和照片，不展示评论、邮箱和内部备注。",
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(DEVELOPER_COPY);
  });
});

describe("行程空态文案", () => {
  it("只说明条目会按日期显示，不解释写接口或数据来源", () => {
    render(<ItineraryList items={[]} />);

    expect(screen.getByText("还没有排定行程")).toBeInTheDocument();
    expect(screen.getByText("行程条目会按日期显示在这里。")).toBeInTheDocument();
    expect(screen.queryByText(/接入写接口|来源为空|凭空补齐/)).not.toBeInTheDocument();
  });
});

describe("删除旅行对话框文案", () => {
  it("只说明删除后果，不解释软删除或物理清除", () => {
    render(
      <DeleteTripDialog
        open
        onOpenChange={() => undefined}
        trip={TRIP}
        pending={false}
        onConfirm={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "删除后，这趟旅行及其日程节点、费用、行李和分享链接都会从界面上消失。",
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/软删除|物理清除|服务器|令牌/);
  });
});
