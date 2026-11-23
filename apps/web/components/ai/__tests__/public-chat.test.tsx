import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicChat } from "../public-chat";

describe("PublicChat", () => {
  it("renders the read-only conversation and never mounts a composer", () => {
    render(
      <PublicChat
        data={{
          title: "京都慢游",
          createdAt: "2026-11-20T08:00:00.000Z",
          lastMessageAt: "2026-11-20T09:00:00.000Z",
          isReadOnly: true,
          messages: [
            {
              id: "01942f30-1200-7000-8000-000000000005",
              role: "user",
              content: [{ type: "text", text: "帮我规划京都。" }],
              createdAt: "2026-11-20T08:00:00.000Z",
            },
            {
              id: "01942f30-1200-7000-8000-000000000006",
              role: "assistant",
              content: [
                { type: "text", text: "第一天去清水寺，晚上到鸭川散步。" },
                {
                  type: "image",
                  image: "https://cdn.example.test/kyoto.webp",
                  filename: "kyoto.webp",
                },
              ],
              createdAt: "2026-11-20T08:01:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "京都慢游" })).toBeVisible();
    expect(screen.getByText("帮我规划京都。")).toBeVisible();
    expect(screen.getByText("第一天去清水寺，晚上到鸭川散步。")).toBeVisible();
    expect(screen.getByAltText("kyoto.webp")).toHaveAttribute(
      "src",
      "https://cdn.example.test/kyoto.webp",
    );
    expect(screen.queryByLabelText("给 AI 助手发消息")).toBeNull();
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
    expect(screen.queryByTestId("artifact")).toBeNull();
  });
});
