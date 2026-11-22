import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
} from "../index";

describe("design system primitives", () => {
  it("builds every button variant from semantic theme tokens", () => {
    const variants = ["primary", "ghost", "outline", "subtle", "link", "danger"] as const;
    const rawColor = /#[0-9a-f]{3,8}|(?:bg|text|border|ring)-(?:black|white)(?:\/|\b)/iu;

    for (const variant of variants) {
      const classes = buttonVariants({ variant });
      expect(classes).not.toMatch(rawColor);
      expect(classes).toContain("focus-visible:ring-focus-ring");
    }

    expect(buttonVariants({ variant: "primary" })).toContain("text-canvas");
    expect(buttonVariants({ variant: "danger" })).toContain("text-danger");
  });

  it("renders one native button and blocks clicks while disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button variant="primary" disabled onClick={onClick}>
        保存旅行
      </Button>,
    );

    const button = screen.getByRole("button", { name: "保存旅行" });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("connects a dialog title and description to the dialog role", async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>删除这趟旅行？</DialogTitle>
          <DialogDescription>旅行、日志和照片将进入回收站。</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", { name: "删除这趟旅行？" });
    const description = screen.getByText("旅行、日志和照片将进入回收站。");

    expect(dialog).toHaveAccessibleDescription("旅行、日志和照片将进入回收站。");
    expect(dialog).toHaveAttribute("aria-describedby", description.id);
  });

  it("associates a form error with its control", () => {
    render(
      <FormField label="邮箱" error="请输入有效邮箱">
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText("邮箱");
    const error = screen.getByRole("alert");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });
});
