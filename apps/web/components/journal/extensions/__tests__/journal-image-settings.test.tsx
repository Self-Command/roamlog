import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { JournalImageAttributes } from "../journal-image";
import { JournalImageSettings } from "../journal-image-settings";

const ATTRIBUTES: JournalImageAttributes = {
  src: "https://media.example.test/kyoto.jpg",
  alt: "晨雾中的鸭川",
  title: "京都",
  caption: "鸭川边的清晨",
  alignment: "right",
  displayWidth: 480,
  displayHeight: 320,
  linkHref: "https://example.test/kyoto",
  linkBlank: true,
  mediaId: null,
};

function renderSettings(overrides: Partial<JournalImageAttributes> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();

  render(
    <JournalImageSettings
      attributes={{ ...ATTRIBUTES, ...overrides }}
      onApply={onApply}
      onClose={onClose}
    />,
  );

  return { onApply, onClose };
}

describe("JournalImageSettings", () => {
  it("initializes every field from the current image attributes", () => {
    renderSettings();

    expect(screen.getByRole("textbox", { name: "替代文本" })).toHaveValue("晨雾中的鸭川");
    expect(screen.getByRole("textbox", { name: "图片标题" })).toHaveValue("京都");
    expect(screen.getByRole("textbox", { name: "图片说明" })).toHaveValue("鸭川边的清晨");
    expect(screen.getByRole("textbox", { name: "图片链接" })).toHaveValue(
      "https://example.test/kyoto",
    );
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "显示宽度" })).toHaveValue(480);
    expect(screen.getByRole("spinbutton", { name: "显示高度" })).toHaveValue(320);

    for (const name of ["替代文本", "图片标题", "图片说明"]) {
      expect(screen.getByRole("textbox", { name })).toHaveAttribute("maxlength", "280");
    }
  });

  it("applies edited accessibility, link and display-size values", async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = renderSettings();

    fireEvent.change(screen.getByRole("textbox", { name: "替代文本" }), {
      target: { value: "新的替代文本" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片标题" }), {
      target: { value: "新的标题" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片说明" }), {
      target: { value: "新的图注" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片链接" }), {
      target: { value: "mailto:hello@example.test" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示宽度" }), {
      target: { value: "1200" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示高度" }), {
      target: { value: "900" },
    });

    await user.click(screen.getByRole("checkbox", { name: "新窗口打开" }));
    await user.click(screen.getByRole("button", { name: "应用" }));

    expect(onApply).toHaveBeenCalledWith({
      alt: "新的替代文本",
      title: "新的标题",
      caption: "新的图注",
      linkHref: "mailto:hello@example.test",
      linkBlank: false,
      displayWidth: 1200,
      displayHeight: 900,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes the link locally and disables the new-window checkbox", async () => {
    const user = userEvent.setup();
    const { onApply } = renderSettings();
    const removeLink = screen.getByRole("button", { name: "移除链接" });
    const linkBlank = screen.getByRole("checkbox", { name: "新窗口打开" });

    expect(removeLink).toBeEnabled();
    expect(linkBlank).toBeChecked();

    await user.click(removeLink);

    expect(screen.getByRole("textbox", { name: "图片链接" })).toHaveValue("");
    expect(linkBlank).not.toBeChecked();
    expect(linkBlank).toBeDisabled();
    expect(removeLink).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ linkHref: "", linkBlank: false }),
    );
  });

  it("disables link actions when the image has no link", () => {
    renderSettings({ linkHref: null, linkBlank: false });

    expect(screen.getByRole("button", { name: "移除链接" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).toBeDisabled();
  });

  it("cancels without applying form edits", async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = renderSettings();

    fireEvent.change(screen.getByRole("textbox", { name: "替代文本" }), {
      target: { value: "不会保存" },
    });
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats blank numeric inputs as empty display dimensions", async () => {
    const user = userEvent.setup();
    const { onApply } = renderSettings();

    fireEvent.change(screen.getByRole("spinbutton", { name: "显示宽度" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示高度" }), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "应用" }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ displayWidth: null, displayHeight: null }),
    );
  });
});
