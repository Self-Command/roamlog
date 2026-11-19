import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportDialog } from "./report-dialog";
import { ReportMenu } from "./report-menu";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000951";
const TRIP_ID = "01942f30-1200-7000-8000-000000000952";

const target = {
  type: "trip" as const,
  id: TRIP_ID,
  label: "Kyoto in November",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problem(status: number, code: string, detail: string): Response {
  return jsonResponse(status, {
    type: `https://roamlog.app/errors/${code.toLowerCase()}`,
    title: status === 409 ? "Conflict" : "Unprocessable Content",
    status,
    code,
    detail,
    errors: [],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportDialog", () => {
  it("submits reason + detail to the workspace report endpoint and confirms", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: "01942f30-1200-7000-8000-000000000953",
        status: "open",
        createdAt: "2026-11-19T08:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDialog open onOpenChange={() => undefined} workspaceId={WORKSPACE_ID} target={target} />,
    );

    await user.selectOptions(screen.getByLabelText("举报原因"), "harassment");
    await user.type(screen.getByLabelText("补充说明（可选）"), "  人身攻击  ");
    await user.click(screen.getByRole("button", { name: "提交举报" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("举报已提交"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/reports`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      targetType: "trip",
      targetId: TRIP_ID,
      reason: "harassment",
      detail: "人身攻击",
    });
  });

  it("explains a duplicate report with the contract code", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(409, "REPORT_DUPLICATE", "You already reported this content."),
      ),
    );

    render(
      <ReportDialog open onOpenChange={() => undefined} workspaceId={WORKSPACE_ID} target={target} />,
    );

    await user.click(screen.getByRole("button", { name: "提交举报" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("你已举报过这条内容");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("maps a missing target to readable copy", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(404, "REPORT_TARGET_NOT_FOUND", "The reported content was not found."),
      ),
    );

    render(
      <ReportDialog open onOpenChange={() => undefined} workspaceId={WORKSPACE_ID} target={target} />,
    );

    await user.click(screen.getByRole("button", { name: "提交举报" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("这条内容不存在");
  });

  it("explains rate limiting", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(429, "RATE_LIMITED", "Too many reports.")));

    render(
      <ReportDialog open onOpenChange={() => undefined} workspaceId={WORKSPACE_ID} target={target} />,
    );

    await user.click(screen.getByRole("button", { name: "提交举报" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("举报太频繁");
  });
});

describe("ReportMenu", () => {
  it("is available to a Viewer: the menu has no role or capability gate", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: "01942f30-1200-7000-8000-000000000954",
        status: "open",
        createdAt: "2026-11-19T08:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportMenu workspaceId={WORKSPACE_ID} target={target} />);

    await user.click(screen.getByRole("button", { name: `更多操作：${target.label}` }));
    await user.click(await screen.findByRole("menuitem", { name: "举报" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("举报这条内容")).toBeInTheDocument();
  });
});