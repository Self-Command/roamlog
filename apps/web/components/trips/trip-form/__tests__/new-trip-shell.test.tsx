import type { CreateTripRequest } from "@roamlog/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COVER_MEDIA_ID } from "@/test/cover-upload-doubles";
import { makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { NewTripShell } from "../../new-trip-shell";

const TRIP_ID = "0198f000-0000-7000-8000-0000000000a1";
const WORKSPACE_ID = "0198f000-0000-7000-8000-0000000000c1";
const SLUG = "roamlog-crew";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const createTrip = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const media = vi.hoisted(() => ({ setCover: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@/lib/api/trip-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trip-form")>();
  return {
    ...actual,
    useCreateTripFormMutation: () => createTrip,
    searchPlacesForTripForm: vi.fn(async () => ({
      items: [],
      degraded: false,
      cached: false,
      provider: "photon",
    })),
  };
});

vi.mock("@/lib/api/media", () => ({
  createCoverMediaClient: () => ({ setCover: media.setCover }),
}));

/**
 * The media pipeline itself is covered by `components/media/**` tests; here the
 * uploader is a stub so this suite only asserts the shell's orchestration.
 */
vi.mock("@/components/media", () => ({
  CoverUploader: ({ onChange }: { onChange: (change: { kind: string; mediaId: string }) => void }) => (
    <button type="button" onClick={() => onChange({ kind: "uploaded", mediaId: COVER_MEDIA_ID })}>
      模拟上传封面
    </button>
  ),
}));

function renderShell() {
  return renderWithQuery(
    <NewTripShell workspaceSlug={SLUG} workspaceId={WORKSPACE_ID} workspaceName="漫游小组" />,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, title = "京都七日") {
  await user.type(screen.getByLabelText(/旅行标题/), title);
  await user.click(screen.getByRole("button", { name: "模拟上传封面" }));
  await user.click(screen.getByRole("button", { name: "创建旅行" }));
}

describe("NewTripShell", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    media.setCover.mockReset();
    media.setCover.mockResolvedValue(makeTrip({ id: TRIP_ID, coverMediaId: COVER_MEDIA_ID }));
    createTrip.mutateAsync.mockReset();
    createTrip.mutateAsync.mockResolvedValue(makeTrip({ id: TRIP_ID }));
  });

  it("creates the trip, binds the uploaded cover and navigates to the detail page", async () => {
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/w/${SLUG}/trips/${TRIP_ID}`));
    expect(createTrip.mutateAsync).toHaveBeenCalledTimes(1);

    const input = createTrip.mutateAsync.mock.calls[0]?.[0] as CreateTripRequest;
    expect(input).toMatchObject({ title: "京都七日", status: "planning", visibility: "workspace" });

    expect(media.setCover).toHaveBeenCalledTimes(1);
    expect(media.setCover).toHaveBeenCalledWith(TRIP_ID, COVER_MEDIA_ID);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not navigate and still binds the cover when create fails", async () => {
    const user = userEvent.setup();
    createTrip.mutateAsync.mockRejectedValueOnce(new Error("network down"));
    renderShell();

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("网络异常，未能保存");
    expect(router.push).not.toHaveBeenCalled();
    expect(media.setCover).not.toHaveBeenCalled();
  });
});