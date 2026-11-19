import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminUserDetail } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminUserProfilePort } from "../../lib/admin-users";
import { sampleUsers } from "../../test/admin-sample-data";
import { UsersView } from "./users-view";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const user = sampleUsers[0]!;
const LIST_ROW = {
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified,
  name: user.name,
  image: user.image,
  platformRole: user.platformRole,
  status: user.status,
  locale: user.locale,
  timezone: user.timezone,
  lastActiveAt: user.lastActiveAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  deletedAt: user.deletedAt,
  activeSessionCount: 1,
};

function detail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...LIST_ROW,
    workspaceCount: 1,
    tripCount: 2,
    entryCount: 3,
    activeSessionCount: 1,
    workspaces: [],
    sessions: [],
    ...overrides,
  };
}

function stubUserPages(detailBody: () => AdminUserDetail = () => detail()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/v1\/admin\/users\/[^/?]+$/.test(url)) {
      return jsonResponse(detailBody());
    }
    return jsonResponse({ items: [LIST_ROW], nextCursor: null, hasMore: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openEditor(profiles: AdminUserProfilePort) {
  const events = userEvent.setup();
  renderWithClient(<UsersView role="super_admin" profiles={profiles} />);
  const row = await screen.findByRole("row", { name: new RegExp(user.name) });
  await events.click(within(row).getByRole("button", { name: "详情" }));
  const editButton = await screen.findByRole("button", { name: "编辑资料" });
  await waitFor(() => expect(editButton).toBeEnabled());
  await events.click(editButton);
  return events;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UsersView profile editing", () => {
  it("patches changed profile fields and reports the verification email result", async () => {
    const fetchMock = stubUserPages();
    const updateProfile = vi.fn(async () => ({
      ...detail({ name: "新姓名", email: "new@roamlog.test" }),
      delivery: "sent" as const,
    }));
    const events = await openEditor({ updateProfile });

    const nameInput = screen.getByLabelText(/姓名/);
    await events.clear(nameInput);
    await events.type(nameInput, "新姓名");
    const emailInput = screen.getByLabelText(/邮箱/);
    await events.clear(emailInput);
    await events.type(emailInput, "new@roamlog.test");

    await events.click(screen.getByRole("button", { name: "保存资料" }));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(user.id, {
        name: "新姓名",
        email: "new@roamlog.test",
      }),
    );
    expect(await screen.findByText(/已发送验证邮件/)).toBeInTheDocument();
    // The drawer re-read the detail after saving instead of trusting the draft.
    const detailCalls = fetchMock.mock.calls.filter(([input]) =>
      /\/v1\/admin\/users\/[^/?]+$/.test(String(input)),
    );
    expect(detailCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("maps EMAIL_TAKEN to a concrete message and keeps the form open", async () => {
    stubUserPages();
    const updateProfile = vi.fn(async () => {
      throw new AdminMutationError({
        code: "EMAIL_TAKEN",
        status: 409,
        title: "Conflict",
        detail: "Another account already uses this email address.",
        degraded: [],
      });
    });
    const events = await openEditor({ updateProfile });

    const emailInput = screen.getByLabelText(/邮箱/);
    await events.clear(emailInput);
    await events.type(emailInput, "taken@roamlog.test");
    await events.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/已被其他账户占用/);
    expect(screen.getByLabelText(/邮箱/)).toHaveValue("taken@roamlog.test");
  });

  it("blocks invalid locale and timezone before calling the API", async () => {
    stubUserPages();
    const updateProfile = vi.fn();
    const events = await openEditor({ updateProfile });

    const localeInput = screen.getByLabelText("语言");
    await events.clear(localeInput);
    await events.type(localeInput, "x");
    const timezoneInput = screen.getByLabelText("时区");
    await events.clear(timezoneInput);
    await events.type(timezoneInput, "../../etc/passwd");

    await events.click(screen.getByRole("button", { name: "保存资料" }));

    expect(screen.getByText(/语言使用 BCP 47/)).toBeInTheDocument();
    expect(screen.getByText(/时区使用 IANA/)).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("keeps profile editing disabled for a plain admin", async () => {
    stubUserPages();
    renderWithClient(<UsersView role="admin" profiles={{ updateProfile: vi.fn() }} />);
    const row = await screen.findByRole("row", { name: new RegExp(user.name) });
    await userEvent.click(within(row).getByRole("button", { name: "详情" }));
    const editButton = await screen.findByRole("button", { name: "编辑资料" });
    expect(editButton).toBeDisabled();
    expect(screen.getByText(/仅超级管理员可编辑/)).toBeInTheDocument();
  });

  it("refuses to fake a save when no profile port is connected", async () => {
    stubUserPages();
    const events = userEvent.setup();
    renderWithClient(<UsersView role="super_admin" />);
    const row = await screen.findByRole("row", { name: new RegExp(user.name) });
    await events.click(within(row).getByRole("button", { name: "详情" }));
    const editButton = await screen.findByRole("button", { name: "编辑资料" });
    await waitFor(() => expect(editButton).toBeEnabled());
    await events.click(editButton);
    const nameInput = screen.getByLabelText(/姓名/);
    await events.clear(nameInput);
    await events.type(nameInput, "未提交");
    await events.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("未连接后台 API");
  });
});