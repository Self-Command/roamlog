import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PublicTripResponseSchema,
  type PublicMedia,
  type PublicTripResponse,
} from "@roamlog/contracts";
import { demoFixtureState } from "@roamlog/api-mocks/fixtures";

import { PublicSharePage } from "./public-share-page";
import { ShareArticle } from "./share-article";
import { ShareLinkDialog } from "./share-link-dialog";

/**
 * Local, schema-valid public payload built from the shared test fixtures.
 *
 * The retired `legacy-mock/share/demo-share` builder was removed with the mock
 * data mode; this test helper keeps the same public-trip shape so the
 * production `PublicTripResponseSchema` still validates it.
 */
function buildDemoPublicTrip({
  tripId,
  showBudget = true,
}: {
  tripId?: string;
  showBudget?: boolean;
} = {}): PublicTripResponse {
  const trip =
    demoFixtureState.trips.find((candidate) => candidate.id === tripId) ??
    [...demoFixtureState.trips]
      .filter((candidate) =>
        demoFixtureState.entries.some((entry) => entry.tripId === candidate.id),
      )
      .sort(
        (left, right) =>
          demoFixtureState.entries.filter((entry) => entry.tripId === right.id).length -
          demoFixtureState.entries.filter((entry) => entry.tripId === left.id).length,
      )[0] ??
    demoFixtureState.trips[0]!;

  const stops = demoFixtureState.stops
    .filter((stop) => stop.tripId === trip.id)
    .sort((left, right) => left.order - right.order);
  const entries = demoFixtureState.entries
    .filter((entry) => entry.tripId === trip.id)
    .sort((left, right) => right.date.localeCompare(left.date));
  const media = demoFixtureState.media.filter((item) => item.tripId === trip.id);
  const expenses = demoFixtureState.expenses.filter((expense) => expense.tripId === trip.id);

  return PublicTripResponseSchema.parse({
    trip: {
      id: trip.id,
      title: trip.title,
      summary: trip.summary,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      durationDays: trip.durationDays,
      coverMediaId: trip.coverMediaId,
      cover: trip.cover,
      origin: trip.origin,
      destinations: trip.destinations,
      countryCodes: trip.countryCodes,
      tags: trip.tags,
    },
    stops: stops.map((stop) => ({
      id: stop.id,
      city: stop.city,
      country: stop.country,
      countryCode: stop.countryCode,
      lat: stop.lat,
      lng: stop.lng,
      startDate: stop.startDate,
      endDate: stop.endDate,
      notes: "",
      order: stop.order,
    })),
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      date: entry.date,
      location: entry.location,
      lat: entry.lat,
      lng: entry.lng,
      mood: entry.mood,
      weather: entry.weather,
      contentHtml: entry.contentHtml,
      excerpt: entry.excerpt,
      tags: entry.tags,
      media: media.slice(0, 3).map(publicMedia),
    })),
    media: media.map(publicMedia),
    budget: showBudget && expenses.length ? demoBudget(trip.id, expenses) : null,
  });
}

const TEST_MEDIA_ORIGIN = "https://media.example.invalid";
const TEST_MEDIA_EXPIRES_AT = "2027-01-01T00:00:00.000Z";

function publicMedia(media: (typeof demoFixtureState.media)[number]): PublicMedia {
  return {
    id: media.id,
    url: `${TEST_MEDIA_ORIGIN}/mock/display/${media.id}.jpg`,
    thumbUrl: `${TEST_MEDIA_ORIGIN}/mock/thumb/${media.id}.jpg`,
    expiresAt: TEST_MEDIA_EXPIRES_AT,
    width: media.width,
    height: media.height,
    blurhash: media.blurhash,
    caption: media.caption,
    date: media.date,
    location: media.location,
  };
}

function demoBudget(
  tripId: string,
  expenses: typeof demoFixtureState.expenses,
): NonNullable<PublicTripResponse["budget"]> {
  const total = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const currencies = [...new Set(expenses.map((expense) => expense.currency))];
  const categories = [...new Set(expenses.map((expense) => expense.category))].map(
    (category) => ({
      category,
      totals: [
        {
          currency: "CNY",
          amountMinor: expenses
            .filter((expense) => expense.category === category)
            .reduce((sum, expense) => sum + expense.amountMinor, 0),
        },
      ],
    }),
  );

  return {
    tripId,
    displayCurrency: "CNY",
    originalTotals: currencies.map((currency) => ({
      currency,
      amountMinor: expenses
        .filter((expense) => expense.currency === currency)
        .reduce((sum, expense) => sum + expense.amountMinor, 0),
    })),
    displayTotal: { currency: "CNY", amountMinor: total, approx: true },
    categories,
    expenseCount: expenses.length,
    overBudget: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

type TripCover = NonNullable<PublicTripResponse["trip"]["cover"]>;

const COVER_URL =
  "https://signed-cover.example.test/tenant-media/covers/hero.jpg?X-Amz-Expires=900&X-Amz-Signature=test-signature";
const COVER_THUMB_URL =
  "https://signed-cover.example.test/tenant-media/covers/hero-thumb.jpg?X-Amz-Signature=test-thumb";

function publicShareWithCover(cover: TripCover | null): PublicTripResponse {
  const data = buildDemoPublicTrip({ showBudget: false });
  return {
    ...data,
    trip: { ...data.trip, coverMediaId: cover?.mediaId ?? null, cover },
  };
}

function readyCover(overrides: Partial<TripCover> = {}): TripCover {
  return {
    mediaId: "0193d3a0-0000-7000-8000-000000000001",
    status: "ready",
    url: COVER_URL,
    thumbUrl: COVER_THUMB_URL,
    width: 1600,
    height: 1067,
    blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
    expiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The hero image only; photo-wall images live outside `<header>`. */
function coverImage(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector<HTMLImageElement>("header img");
}

describe("ShareArticle cover", () => {
  it("renders the signed cover from the public payload instead of the gradient", () => {
    const data = publicShareWithCover(readyCover());
    const { container } = render(<ShareArticle data={data} />);

    const image = coverImage(container);
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", COVER_URL);
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("decoding", "async");
    expect(container.querySelector(".trip-cover")).toBeNull();
    expect(container.querySelector('[class*="trip-cover--"]')).toBeNull();
  });

  it("keeps the generated gradient when the trip has no cover", () => {
    const { container } = render(<ShareArticle data={publicShareWithCover(null)} />);

    expect(coverImage(container)).toBeNull();
    const fallback = container.querySelector(".trip-cover");
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("class")).toMatch(
      /trip-cover--(amber|moss|ice|coast|rose)/,
    );
    expect(fallback?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back while the cover is still processing and has no usable URL", () => {
    const data = publicShareWithCover(
      readyCover({ status: "processing", url: null, thumbUrl: null, expiresAt: null }),
    );
    const { container } = render(<ShareArticle data={data} />);

    expect(coverImage(container)).toBeNull();
    expect(container.querySelector(".trip-cover")).not.toBeNull();
  });

  it("falls back to the gradient when the signed URL fails to load", () => {
    const { container } = render(<ShareArticle data={publicShareWithCover(readyCover())} />);

    const image = coverImage(container);
    if (!image) throw new Error("expected the cover image to render");

    fireEvent.error(image);

    expect(coverImage(container)).toBeNull();
    expect(container.querySelector(".trip-cover")).not.toBeNull();
  });

  it("sources the cover URL from the payload and hardcodes no origin, bucket, or key", () => {
    const data = publicShareWithCover(readyCover());
    const { container } = render(<ShareArticle data={data} />);

    expect(coverImage(container)?.getAttribute("src")).toBe(data.trip.cover?.url);
    const hero = container.querySelector("header")?.innerHTML ?? "";
    expect(hero).not.toContain("media.example.invalid");
    expect(hero).not.toMatch(/s3[.-]|amazonaws|storage\.googleapis|minio/i);
  });
});

/**
 * Defensive fixture: the strict contract keeps `url` non-null, but a stale
 * cached payload can still reach the client without a signed URL, so the
 * renderer must degrade instead of painting a broken frame.
 */
type PhotoFixture = Omit<PublicMedia, "url" | "thumbUrl"> & {
  url: string | null;
  thumbUrl: string | null;
};

const PHOTO_URL =
  "https://signed-photos.example.test/tenant-media/display/photo-1.jpg?X-Amz-Expires=900&X-Amz-Signature=display-signature";
const PHOTO_THUMB_URL =
  "https://signed-photos.example.test/tenant-media/thumbs/photo-1.jpg?X-Amz-Signature=thumb-signature";

function photo(overrides: Partial<PhotoFixture> = {}): PhotoFixture {
  return {
    id: "0193d3a0-0000-7000-8000-0000000000a1",
    url: PHOTO_URL,
    thumbUrl: PHOTO_THUMB_URL,
    expiresAt: "2027-01-01T00:00:00.000Z",
    width: 1600,
    height: 1200,
    blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
    caption: "日落前的礁石",
    date: "2026-03-02",
    location: "里斯本",
    ...overrides,
  };
}

function shareWithPhotos(
  photos: PhotoFixture[],
  inlineInFirstEntry = false,
): PublicTripResponse {
  const data = buildDemoPublicTrip({ showBudget: false });
  return {
    ...data,
    trip: { ...data.trip, coverMediaId: null, cover: null },
    media: photos as unknown as PublicMedia[],
    entries: data.entries.map((entry, index) => ({
      ...entry,
      media:
        inlineInFirstEntry && index === 0 ? (photos as unknown as PublicMedia[]) : [],
    })),
  };
}

/** Photo tiles are the only `<figure>` elements on the public page. */
function photoImages(container: HTMLElement): HTMLImageElement[] {
  return [...container.querySelectorAll<HTMLImageElement>("figure img")];
}

function photoGradients(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("figure .bg-gradient-to-br")];
}

describe("ShareArticle photo wall", () => {
  it("renders the signed display URL instead of the gradient placeholder", () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([photo()])} />);

    const images = photoImages(container);
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", PHOTO_URL);
    expect(images[0]).toHaveAttribute("alt", "日落前的礁石");
    expect(images[0]).toHaveAttribute("loading", "lazy");
    expect(images[0]).toHaveAttribute("decoding", "async");
    expect(photoGradients(container)).toHaveLength(0);
  });

  it("renders the signed thumbnail when only the thumbnail is available", () => {
    const { container } = render(
      <ShareArticle data={shareWithPhotos([photo({ url: null })])} />,
    );

    const images = photoImages(container);
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", PHOTO_THUMB_URL);
    expect(photoGradients(container)).toHaveLength(0);
  });

  it("offers the thumbnail to the grid through srcSet while src keeps the display URL", () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([photo()])} />);

    const [image] = photoImages(container);
    expect(image?.getAttribute("src")).toBe(PHOTO_URL);
    expect(image?.getAttribute("srcset")).toContain(`${PHOTO_THUMB_URL} 320w`);
    expect(image?.getAttribute("srcset")).toContain(`${PHOTO_URL} 960w`);
    expect(image?.getAttribute("sizes")).toContain("min-width: 1024px");
  });

  it("keeps the generated gradient when neither URL is signed", () => {
    const { container } = render(
      <ShareArticle data={shareWithPhotos([photo({ url: null, thumbUrl: null })])} />,
    );

    expect(photoImages(container)).toHaveLength(0);
    const gradients = photoGradients(container);
    expect(gradients).toHaveLength(1);
    expect(gradients[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(gradients[0]?.getAttribute("class")).toBeTruthy();
  });

  it("falls back to the gradient when the signed photo fails to load", () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([photo()])} />);

    const [image] = photoImages(container);
    if (!image) throw new Error("expected the photo to render");

    fireEvent.error(image);

    expect(photoImages(container)).toHaveLength(0);
    expect(photoGradients(container)).toHaveLength(1);
  });

  it("renders journal photos through the same signed path", () => {
    const { container } = render(
      <ShareArticle data={shareWithPhotos([photo()], true)} />,
    );

    const images = photoImages(container);
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("src")).toBe(PHOTO_URL);
    }
  });

  it("marks decorative photos with an empty alt instead of inventing copy", () => {
    const { container } = render(
      <ShareArticle data={shareWithPhotos([photo({ caption: "   " })])} />,
    );

    const [image] = photoImages(container);
    const figure = image?.closest("figure") ?? null;
    expect(image).toHaveAttribute("alt", "");
    expect(figure?.textContent).not.toContain("日落前的礁石");
  });

  it("sources every photo URL from the payload and hardcodes no origin, bucket, or key", () => {
    const photos = [
      photo(),
      photo({
        id: "0193d3a0-0000-7000-8000-0000000000a2",
        url: "https://signed-photos.example.test/tenant-media/display/photo-2.jpg?X-Amz-Signature=second",
        thumbUrl: null,
        caption: "第二张",
      }),
    ];
    const { container } = render(<ShareArticle data={shareWithPhotos(photos)} />);

    const payloadUrls = new Set(
      photos
        .flatMap((item) => [item.url, item.thumbUrl])
        .filter((url): url is string => Boolean(url)),
    );
    const images = photoImages(container);
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(payloadUrls.has(image.getAttribute("src") ?? "")).toBe(true);
      expect(image.getAttribute("src")).toMatch(
        /^https:\/\/signed-photos\.example\.test\/tenant-media\//,
      );
      expect(image.hasAttribute("data-nimg")).toBe(false);
    }

    const html = container.innerHTML;
    expect(html).toContain("signed-photos.example.test");
    expect(html).not.toContain("media.example.invalid");
    expect(html).not.toMatch(/s3[.-]|amazonaws|storage\.googleapis|minio/i);
    expect(html).not.toContain("/_next/image");
  });
});

describe("PublicSharePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function problem(status: number, code: string): Response {
    return jsonResponse(
      { type: "about:blank", title: "Share error", status, code, errors: [] },
      status,
    );
  }

  function stubShareApi(): PublicTripResponse {
    const publicTrip = buildDemoPublicTrip({ showBudget: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("password=roamlog")) return jsonResponse(publicTrip);
        if (url.includes("password=")) return problem(401, "SHARE_PASSWORD_INVALID");
        return problem(401, "SHARE_PASSWORD_REQUIRED");
      }),
    );
    return publicTrip;
  }

  it("requires a password, rejects a wrong password, and then opens the share", async () => {
    stubShareApi();
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

  it("maps an unknown, expired, or revoked link to the same safe 404 copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ type: "about:blank", title: "Not found", status: 404 }, 404),
      ),
    );

    for (const token of ["expired-demo", "revoked-demo"]) {
      const { unmount } = render(<PublicSharePage token={token} />);
      expect(
        await screen.findByRole("heading", { name: "这个分享链接已失效" }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe("ShareLinkDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the token once and clears it when the dialog is reopened", async () => {
    const user = userEvent.setup();
    const shareToken = "0123456789abcdef0123456789abcdef";
    const createdByApi = {
      id: "0193d3a0-0000-7000-8000-000000000001",
      workspaceId: "0193d3a0-0000-7000-8000-000000000002",
      tripId: "0193d3a0-0000-7000-8000-000000000003",
      createdById: "0193d3a0-0000-7000-8000-000000000004",
      expiresAt: null,
      revokedAt: null,
      hasPassword: false,
      allowIndex: false,
      showBudget: false,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: "2026-11-19T00:00:00.000Z",
      token: shareToken,
      url: `https://roamlog.test/share/${shareToken}`,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(createdByApi, 201)));

    render(<ShareLinkDialog tripId={createdByApi.tripId} />);

    await user.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByRole("heading", { name: "公开分享这趟旅行" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建链接" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "分享链接已创建" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(new RegExp(`/share/${shareToken}`))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByRole("heading", { name: "公开分享这趟旅行" })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`/share/${shareToken}`))).not.toBeInTheDocument();
  });
});
