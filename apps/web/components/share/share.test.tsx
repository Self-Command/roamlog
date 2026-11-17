import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { buildDemoPublicTrip } from "./demo-share";
import { PublicSharePage } from "./public-share-page";
import { ShareArticle } from "./share-article";
import { ShareLinkDialog } from "./share-link-dialog";

describe("ShareArticle", () => {
  it("never renders comments, emails, or internal notes from a public payload", () => {
    const publicData = buildDemoPublicTrip({ showBudget: true });
    const withPrivateFields = {
      ...publicData,
      comments: [{ body: "内部评论不要泄漏", authorEmail: "mira@roamlog.local" }],
      workspace: {
        members: [{ email: "lin.mo@roamlog.local", name: "林墨" }],
      },
      stops: publicData.stops.map((stop) => ({
        ...stop,
        internalNotes: "内部备注：不要公开酒店地址",
        authorEmail: "editor@roamlog.local",
      })),
    } as typeof publicData;

    render(<ShareArticle data={withPrivateFields} />);

    expect(screen.getByText(publicData.trip.title)).toBeInTheDocument();
    expect(screen.getByText("旅行日志")).toBeInTheDocument();
    expect(screen.queryByText(/mira@roamlog.local/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lin.mo@roamlog.local/)).not.toBeInTheDocument();
    expect(screen.queryByText(/内部评论不要泄漏/)).not.toBeInTheDocument();
    expect(screen.queryByText(/内部备注/)).not.toBeInTheDocument();
  });
});

describe("PublicSharePage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("requires a password, rejects a wrong password, and then opens the share", async () => {
    const user = userEvent.setup();
    render(<PublicSharePage token="password-demo" />);

    expect(
      await screen.findByRole("heading", { name: "输入分享密码" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("分享密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "打开分享" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");

    await user.type(screen.getByLabelText("分享密码"), "roamlog");
    await user.click(screen.getByRole("button", { name: "打开分享" }));
    expect(await screen.findByRole("heading", { name: "旅行日志" })).toBeInTheDocument();
  });

  it("shows distinct expired and revoked states", async () => {
    const { unmount } = render(<PublicSharePage token="expired-demo" />);
    expect(
      await screen.findByRole("heading", { name: "这个分享链接已过期" }),
    ).toBeInTheDocument();
    unmount();

    render(<PublicSharePage token="revoked-demo" />);
    expect(
      await screen.findByRole("heading", { name: "这个分享链接已被撤销" }),
    ).toBeInTheDocument();
  });
});

describe("ShareLinkDialog", () => {
  it("shows the token once and clears it when the dialog is reopened", async () => {
    const user = userEvent.setup();
    renderWithDemo(<ShareLinkDialog tripId="trip-demo" />);

    await user.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByRole("heading", { name: "公开分享这趟旅行" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建链接" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "分享链接已创建" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/\/share\/demo-/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByRole("heading", { name: "公开分享这趟旅行" })).toBeInTheDocument();
    expect(screen.queryByText(/\/share\/demo-/)).not.toBeInTheDocument();
  });
});
