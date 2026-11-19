import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { LivePhoto } from "./live-photo";

const STILL = "https://media.example.test/still.jpg?sig=1";
const MOTION = "https://media.example.test/motion.mov?sig=1";

// jsdom implements neither method; the component calls both from real DOM
// events, so the test doubles live on the prototype.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function video(): HTMLVideoElement {
  return screen.getByTestId("live-photo-video") as HTMLVideoElement;
}

describe("<LivePhoto />", () => {
  it("renders the still with a LIVE badge for a paired motion", () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Euljiro at dusk" />);

    expect(screen.getByAltText("Euljiro at dusk")).toHaveProperty("src", STILL);
    expect(screen.getByTestId("live-photo-badge")).toHaveTextContent("LIVE");
    expect(video()).toHaveProperty("src", MOTION);
    expect(video().muted).toBe(true);
    expect(video()).toHaveProperty("playsInline", true);
    expect(video().getAttribute("preload")).toBe("none");
  });

  it("plays on hover and stops on leave", async () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Seoul" />);
    const surface = screen.getByTestId("live-photo");

    fireEvent.mouseEnter(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(video().play).toHaveBeenCalled();

    fireEvent.mouseLeave(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "false"));
    expect(video().pause).toHaveBeenCalled();
  });

  it("does not auto-play under prefers-reduced-motion but still plays on click", async () => {
    render(
      <LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Kyoto" prefersReducedMotion />,
    );
    const surface = screen.getByTestId("live-photo");

    fireEvent.mouseEnter(surface);
    await act(async () => undefined);
    expect(surface).toHaveAttribute("data-playing", "false");
    expect(video().play).not.toHaveBeenCalled();

    // The badge stays: the asset *is* a Live Photo, it just does not animate.
    expect(screen.getByTestId("live-photo-badge")).toBeTruthy();

    fireEvent.click(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(video().play).toHaveBeenCalled();
  });

  it("plays on Enter for keyboard users", async () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Busan" />);
    const surface = screen.getByTestId("live-photo");

    fireEvent.keyDown(surface, { key: "Enter" });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(video().play).toHaveBeenCalled();
  });

  it("falls back to the still when the video fails to load", async () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Jeju" />);

    fireEvent.error(video());

    await waitFor(() => expect(screen.queryByTestId("live-photo-video")).toBeNull());
    expect(screen.getByAltText("Jeju")).toHaveProperty("src", STILL);
    // No LIVE badge for a movie that cannot play, and no thrown error.
    expect(screen.queryByTestId("live-photo-badge")).toBeNull();
  });

  it("renders a plain photo when there is no motion", () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={null} alt="Daejeon" />);

    expect(screen.queryByTestId("live-photo-video")).toBeNull();
    expect(screen.queryByTestId("live-photo-badge")).toBeNull();
    expect(screen.getByTestId("live-photo")).toHaveAttribute("data-live-photo", "false");
  });

  it("shows the duration on the badge when known", () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Daegu" durationMs={2400} />);
    expect(screen.getByTestId("live-photo-badge")).toHaveTextContent("2s");
  });

  it("plays on Space as well as Enter", async () => {
    render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Gwangju" />);
    const surface = screen.getByTestId("live-photo");

    fireEvent.keyDown(surface, { key: " " });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(video().play).toHaveBeenCalled();

    fireEvent.keyUp(surface, { key: " " });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "false"));
    expect(video().pause).toHaveBeenCalled();
  });

  it("accepts embedding labels without changing the private defaults", () => {
    const { rerender } = render(<LivePhoto stillUrl={STILL} motionUrl={MOTION} alt="Suwon" />);

    expect(screen.getByTestId("live-photo")).toHaveAccessibleName(
      "Suwon（实况照片：聚焦或长按播放动图，按 Enter 播放）",
    );
    expect(video()).toHaveAttribute("aria-hidden", "true");
    expect(video()).not.toHaveAttribute("aria-label");

    rerender(
      <LivePhoto
        stillUrl={STILL}
        motionUrl={MOTION}
        alt=""
        labels={{ live: "播放这段 Live Photo", still: "照片" }}
        videoLabel="播放这段 Live Photo"
      />,
    );

    expect(screen.getByTestId("live-photo")).toHaveAccessibleName("播放这段 Live Photo");
    expect(video()).toHaveAttribute("aria-label", "播放这段 Live Photo");
    expect(video()).not.toHaveAttribute("aria-hidden");
  });

  it("reports a still that fails to load so embedders can swap in a placeholder", () => {
    const onStillError = vi.fn();
    render(
      <LivePhoto
        stillUrl={STILL}
        motionUrl={MOTION}
        alt="Andong"
        onStillError={onStillError}
      />,
    );

    fireEvent.error(screen.getByAltText("Andong"));
    expect(onStillError).toHaveBeenCalledTimes(1);
  });
});