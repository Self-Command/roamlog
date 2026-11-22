import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JournalImageAttributes } from "../journal-image";
import { JournalImageToolbar } from "../journal-image-toolbar";

const ATTRIBUTES: JournalImageAttributes = {
  src: "https://media.example.test/kyoto.jpg",
  alt: "晨雾中的鸭川",
  title: "京都",
  caption: "鸭川边的清晨",
  alignment: "right",
  displayWidth: 480,
  displayHeight: 320,
  linkHref: null,
  linkBlank: false,
  mediaId: null,
};

function toolbar(key: string) {
  return (
    <JournalImageToolbar
      key={key}
      alignment={ATTRIBUTES.alignment}
      attributes={ATTRIBUTES}
      onAlign={vi.fn()}
      onApplySettings={vi.fn()}
      onPreview={vi.fn()}
      replacing={false}
      onReplace={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JournalImageToolbar", () => {
  it("restores focus to the replacement trigger after a NodeView remount", async () => {
    const user = userEvent.setup();
    const view = render(toolbar("first"));
    await user.click(screen.getByRole("button", { name: "图片设置" }));
    expect(await screen.findByRole("dialog", { name: "图片设置" })).toBeVisible();

    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图片设置" })).toBeNull());

    // The real editor closes the Radix portal, then remounts the Tiptap
    // NodeView on the next frame. Replacing the key models that hand-off.
    view.rerender(toolbar("replacement"));

    await act(async () => {
      for (let pass = 0; pass < 4 && frames.size > 0; pass += 1) {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) {
          callback(performance.now());
        }
      }
    });

    expect(screen.getByRole("button", { name: "图片设置" })).toHaveFocus();
  });
});
