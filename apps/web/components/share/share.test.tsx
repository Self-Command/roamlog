import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PublicTripResponseSchema,
  type PublicMedia,
  type PublicStop,
  type PublicTripResponse,
} from "@roamlog/contracts";
import { demoFixtureState } from "@/test/fixtures";

import { PublicSharePage } from "./public-share-page";
import { ShareArticle } from "./share-article";
import { ShareLinkDialog } from "./share-link-dialog";
import { photosFromPublicMedia } from "./share-map";

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
      // The demo fixtures predate the origin-provider column: the share page must
      // stay conservative (OSM) when a legacy payload carries no source.
      originProvider: null,
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
      provider: stop.provider,
      // `PublicStopSchema` requires the key since the stop-address migration;
      // the demo fixture simply has no formatted address.
      address: null,
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

describe("ShareArticle rich journal content", () => {
  it("renders uploaded body images without overflow and keeps task-list checked state", () => {
    const data = buildDemoPublicTrip({ showBudget: false });
    const imageUrl =
      "https://signed-media.example.test/tenant/photo.jpg?X-Amz-Expires=900&X-Amz-Signature=body-signature";
    const contentHtml = [
      "<p>正文</p>",
      `<img src="${imageUrl}" alt="旅途照片" width="800" height="600">`,
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>带帐篷</p></div></li>',
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>买车票</p></div></li>',
      "</ul>",
    ].join("");
    const withContent = {
      ...data,
      entries: data.entries.map((entry, index) =>
        index === 0 ? { ...entry, contentHtml } : entry,
      ),
    };

    const { container } = render(<ShareArticle data={withContent} />);

    const bodyImage = container.querySelector<HTMLImageElement>(
      `.share-prose img[src="${imageUrl}"]`,
    );
    expect(bodyImage).not.toBeNull();
    expect(bodyImage?.closest(".share-prose")?.className).toContain("journal-layout");

    const checked = container.querySelector<HTMLInputElement>(
      'li[data-checked="true"] input[type="checkbox"]',
    );
    expect(checked).not.toBeNull();
    expect(checked).toBeChecked();
    expect(checked).toBeDisabled();

    const unchecked = container.querySelector<HTMLInputElement>(
      'li[data-checked="false"] input[type="checkbox"]',
    );
    expect(unchecked).not.toBeNull();
    expect(unchecked).not.toBeChecked();
    expect(unchecked).toBeDisabled();

    expect(screen.getByText("带帐篷")).toBeInTheDocument();
    expect(screen.getByText("买车票")).toBeInTheDocument();
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

type ShareProvider = NonNullable<PublicTripResponse["stops"][number]["provider"]>;

/**
 * Public payload with explicit place sources. The stop template comes from the
 * demo fixtures, so the rest of the payload stays schema-valid while the
 * providers under test are exact.
 */
function shareWithPlaceProviders({
  stops,
  originProvider = null,
}: {
  stops: Array<ShareProvider | null>;
  originProvider?: ShareProvider | null;
}): PublicTripResponse {
  const data = buildDemoPublicTrip({ showBudget: false });
  const template = data.stops[0]!;
  return {
    ...data,
    trip: { ...data.trip, originProvider },
    stops: stops.map((provider, index) => ({
      ...template,
      id: `${template.id.slice(0, -1)}${index}`,
      order: index,
      provider,
    })),
  };
}

describe("ShareArticle place attribution", () => {
  it("shows the Geoapify credit required by a Geoapify-sourced stop", () => {
    render(<ShareArticle data={shareWithPlaceProviders({ stops: ["geoapify"] })} />);

    const credit = within(screen.getByRole("contentinfo")).getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "geoapify");
    expect(credit).toHaveTextContent("Powered by Geoapify");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Photon/);
    expect(credit).not.toHaveTextContent("手动录入");
    expect(within(credit).getByRole("link", { name: /Powered by Geoapify/ })).toHaveAttribute(
      "href",
      "https://www.geoapify.com/",
    );
  });

  it("shows the Photon credit for a Photon-sourced stop", () => {
    render(<ShareArticle data={shareWithPlaceProviders({ stops: ["photon"] })} />);

    const credit = within(screen.getByRole("contentinfo")).getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "photon");
    expect(credit).toHaveTextContent("Search by Photon");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Geoapify/);
    expect(credit).not.toHaveTextContent("手动录入");
    expect(within(credit).getByRole("link", { name: /Search by Photon/ })).toHaveAttribute(
      "href",
      "https://photon.komoot.io/",
    );
  });

  it("labels manually entered places without borrowing a third-party credit", () => {
    render(<ShareArticle data={shareWithPlaceProviders({ stops: ["local"] })} />);

    const credit = within(screen.getByRole("contentinfo")).getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "local");
    expect(credit).toHaveTextContent("手动录入");
    expect(credit).not.toHaveTextContent(/Geoapify|Photon|OpenStreetMap/);
    // A manual entry has no upstream source, so there is nothing to link.
    expect(within(credit).queryByRole("link")).toBeNull();
  });

  it("credits every distinct source once when a shared trip mixes providers", () => {
    render(
      <ShareArticle
        data={shareWithPlaceProviders({
          stops: ["geoapify", "photon", "local"],
          originProvider: "photon",
        })}
      />,
    );

    const credits = within(screen.getByRole("contentinfo")).getAllByTestId(
      "places-attribution",
    );
    expect(credits.map((credit) => credit.getAttribute("data-provider"))).toEqual([
      "geoapify",
      "photon",
      "local",
    ]);
    // No credit borrows another provider's copy: the Geoapify line only carries
    // the Geoapify wording, and the same holds for Photon and manual entry.
    expect(credits[0]).toHaveTextContent("Powered by Geoapify");
    expect(credits[0]).not.toHaveTextContent(/Photon/);
    expect(credits[1]).toHaveTextContent("Search by Photon");
    expect(credits[1]).not.toHaveTextContent(/Geoapify/);
    expect(credits[2]).toHaveTextContent("手动录入");
    expect(credits[2]).not.toHaveTextContent(/Geoapify|Photon/);
  });

  it("credits the origin source when no stop carries a provider", () => {
    render(
      <ShareArticle
        data={shareWithPlaceProviders({ stops: [null], originProvider: "geoapify" })}
      />,
    );

    const credit = within(screen.getByRole("contentinfo")).getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "geoapify");
    expect(credit).toHaveTextContent("Powered by Geoapify");
  });

  it("falls back to the conservative OSM credit for a legacy share without providers", () => {
    render(<ShareArticle data={shareWithPlaceProviders({ stops: [null] })} />);

    const credit = within(screen.getByRole("contentinfo")).getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "unknown");
    expect(credit).not.toHaveAttribute("aria-hidden");

    const link = within(credit).getByRole("link", {
      name: /OpenStreetMap contributors/,
    });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(credit).not.toHaveTextContent(/Geoapify|Photon|手动录入/);
  });
});

const MOTION_URL =
  "https://signed-photos.example.test/tenant-media/motion/photo-1.mov?X-Amz-Expires=900&X-Amz-Signature=motion-signature";

/**
 * A `PublicMedia` shaped exactly like the server's Live Photo projection: the
 * signed still/thumb plus `livePhoto: true` and a signed `motion.url`. The
 * payload has no bucket and no `storageKey`, so the page cannot render one.
 */
function livePhotoFixture(overrides: Partial<PhotoFixture> = {}): PhotoFixture {
  return photo({
    livePhoto: true,
    motion: { url: MOTION_URL, mimeType: "video/quicktime", durationMs: 2400 },
    ...overrides,
  });
}

function liveSurface(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>('[data-testid="live-photo"]');
  if (!surface) throw new Error("expected a Live Photo surface on the public page");
  return surface;
}

function liveVideo(container: HTMLElement): HTMLVideoElement {
  const motion = container.querySelector<HTMLVideoElement>('[data-testid="live-photo-video"]');
  if (!motion) throw new Error("expected the signed motion video on the public page");
  return motion;
}

function liveBadge(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="live-photo-badge"]');
}

function reducedMotionQuery() {
  return {
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe("ShareArticle live photos", () => {
  beforeAll(() => {
    // jsdom implements neither method, and the shared player calls both from
    // real DOM events, so the doubles live on the element prototype.
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

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the shared player and the LIVE badge for a paired motion", () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([livePhotoFixture()])} />);

    const surface = liveSurface(container);
    expect(surface).toHaveAttribute("data-live-photo", "true");
    expect(surface).toHaveAttribute("data-playing", "false");

    const badge = liveBadge(container);
    expect(badge).toHaveTextContent("LIVE");
    // Quiet mono annotation on the photo, not a second headline.
    expect(badge?.className).toContain("text-[10px]");

    // The still is the payload's signed display URL, exactly like a plain tile.
    expect(container.querySelector("figure img")).toHaveAttribute("src", PHOTO_URL);

    const motion = liveVideo(container);
    expect(motion).toHaveAttribute("src", MOTION_URL);
    expect(motion.muted).toBe(true);
    expect(motion).toHaveProperty("playsInline", true);
    expect(motion.getAttribute("preload")).toBe("none");
    expect(motion.getAttribute("poster")).toBe(PHOTO_URL);
  });

  it("keeps an ordinary photo when the payload has no playable motion", () => {
    const { container } = render(
      <ShareArticle
        data={shareWithPhotos([
          livePhotoFixture({ id: "0193d3a0-0000-7000-8000-0000000000b1", livePhoto: false }),
          livePhotoFixture({
            id: "0193d3a0-0000-7000-8000-0000000000b2",
            motion: null,
          }),
          livePhotoFixture({
            id: "0193d3a0-0000-7000-8000-0000000000b3",
            motion: { url: null, mimeType: "video/quicktime", durationMs: 2400 },
          }),
        ])}
      />,
    );

    expect(container.querySelectorAll('[data-testid="live-photo"]')).toHaveLength(0);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(liveBadge(container)).toBeNull();
    expect(photoImages(container)).toHaveLength(3);
  });

  it("plays on hover, pauses on leave, and plays on a mobile click", async () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([livePhotoFixture()])} />);
    const surface = liveSurface(container);
    const motion = liveVideo(container);

    fireEvent.mouseEnter(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(motion.play).toHaveBeenCalled();

    fireEvent.mouseLeave(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "false"));
    expect(motion.pause).toHaveBeenCalled();

    // Touch devices have no hover: a tap is the explicit request to play.
    fireEvent.click(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
  });

  it("does not auto-play under prefers-reduced-motion but keeps the badge and click", async () => {
    vi.stubGlobal("matchMedia", vi.fn(reducedMotionQuery));
    const { container } = render(<ShareArticle data={shareWithPhotos([livePhotoFixture()])} />);
    const surface = liveSurface(container);
    const motion = liveVideo(container);

    fireEvent.mouseEnter(surface);
    await act(async () => undefined);

    expect(surface).toHaveAttribute("data-playing", "false");
    expect(motion.play).not.toHaveBeenCalled();
    expect(liveBadge(container)).toHaveTextContent("LIVE");

    fireEvent.click(surface);
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
  });

  it("falls back to the still when the signed motion URL fails, with no error copy", async () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([livePhotoFixture()])} />);

    fireEvent.error(liveVideo(container));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="live-photo-video"]')).toBeNull(),
    );
    expect(photoImages(container)).toHaveLength(1);
    expect(photoImages(container)[0]).toHaveAttribute("src", PHOTO_URL);
    // An external visitor must never see playback diagnostics.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).not.toMatch(/无法播放|播放失败|加载失败|视频错误|Video error/);
  });

  it("drops the tile to the generated placeholder when the still itself is expired", async () => {
    const { container } = render(<ShareArticle data={shareWithPhotos([livePhotoFixture()])} />);

    fireEvent.error(container.querySelector("figure img")!);

    await waitFor(() => expect(photoGradients(container)).toHaveLength(1));
    expect(container.querySelector('[data-testid="live-photo"]')).toBeNull();
    expect(container.textContent).not.toMatch(/无法播放|加载失败/);
  });

  it("exposes readable labels and plays from Enter and Space", async () => {
    const { container } = render(
      <ShareArticle
        data={shareWithPhotos([livePhotoFixture({ caption: null, location: null })])}
      />,
    );
    const surface = liveSurface(container);
    const motion = liveVideo(container);

    expect(surface.tagName).toBe("BUTTON");
    expect(surface).toHaveAccessibleName("播放这段 Live Photo");
    expect(motion).toHaveAccessibleName("播放这段 Live Photo");
    expect(motion).toHaveAttribute("aria-label", "播放这段 Live Photo");
    expect(motion).not.toHaveAttribute("aria-hidden");

    fireEvent.keyDown(surface, { key: "Enter" });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    expect(motion.play).toHaveBeenCalled();

    fireEvent.keyUp(surface, { key: "Enter" });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "false"));

    fireEvent.keyDown(surface, { key: " " });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "true"));
    fireEvent.keyUp(surface, { key: " " });
    await waitFor(() => expect(surface).toHaveAttribute("data-playing", "false"));
  });

  it("plays only the payload's signed motion URL and leaks no storage coordinates", () => {
    const data = shareWithPhotos([livePhotoFixture()]);
    const { container } = render(<ShareArticle data={data} />);

    expect(liveVideo(container).getAttribute("src")).toBe(data.media[0]?.motion?.url);

    const html = container.innerHTML;
    expect(html).not.toMatch(/storageKey|storage-key|bucket|X-Amz-Security-Token/i);
    expect(html).not.toContain("media.example.invalid");
    expect(html).not.toContain("/_next/image");
  });
});

const MAPPED_STOP: PublicStop = {
  id: "019b7b6b-4658-769e-8153-9f88eba061c3",
  city: "京都市",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  provider: null,
  address: null,
  startDate: "2026-11-21",
  endDate: "2026-11-25",
  notes: "",
  order: 0,
};

const SECOND_MAPPED_STOP: PublicStop = {
  ...MAPPED_STOP,
  id: "019b7b6b-4658-769e-8153-9f88eba061c4",
  city: "大阪市",
  lat: 34.6937,
  lng: 135.5023,
  order: 1,
};

const UNMAPPED_STOP: PublicStop = {
  ...MAPPED_STOP,
  id: "019b7b6b-4658-769e-8153-9f88eba061c5",
  city: "奈良市",
  lat: null,
  lng: null,
  order: 2,
};

const NON_FINITE_STOP: PublicStop = {
  ...UNMAPPED_STOP,
  id: "019b7b6b-4658-769e-8153-9f88eba061c6",
  city: "宇治市",
  lat: Number.POSITIVE_INFINITY,
  lng: 135.8,
  order: 3,
};

const GEOTAGGED_MEDIA: PublicMedia = {
  id: "019b7b6b-4658-769e-8153-9f88eba061d1",
  url: "https://signed-photos.example.test/display/geotagged.jpg",
  thumbUrl: "https://signed-photos.example.test/thumb/geotagged.jpg",
  expiresAt: "2027-01-01T00:00:00.000Z",
  width: 1600,
  height: 1200,
  blurhash: null,
  caption: "鸭川边",
  date: "2026-11-22",
  location: "京都市",
  lat: 35.0116,
  lng: 135.7681,
};

function shareWithMapStops(stops: PublicStop[], media: PublicMedia[] = []): PublicTripResponse {
  const data = buildDemoPublicTrip({ showBudget: false });
  return { ...data, stops, media };
}

describe("ShareArticle route map", () => {
  beforeAll(() => {
    // jsdom has no WebGL, so the shared TripStopMap intentionally falls back to
    // its accessible schematic map. Stub the probe to keep the test output free
    // of jsdom's "getContext not implemented" noise.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("renders the shared map for stops with finite coordinates", () => {
    render(
      <ShareArticle
        data={shareWithMapStops([MAPPED_STOP, SECOND_MAPPED_STOP], [
          GEOTAGGED_MEDIA,
          {
            ...GEOTAGGED_MEDIA,
            id: "019b7b6b-4658-769e-8153-9f88eba061d5",
            lat: undefined,
            lng: undefined,
          },
        ])}
      />,
    );

    const map = screen.getByTestId("share-map");
    expect(map).toHaveAttribute("data-mapped-stops", "2");
    expect(map).toHaveAttribute("data-photo-points", "1");
    expect(within(map).getByTestId("world-map")).toHaveAttribute(
      "aria-label",
      "简化世界地图，显示 2 个停靠点",
    );
    expect(screen.getByText("ROUTE MAP / 2 MAPPED STOPS")).toBeInTheDocument();
    expect(screen.getByTestId(`trip-map-stop-${MAPPED_STOP.id}`)).toBeInTheDocument();
  });

  it("does not render a map when no stop has finite coordinates", () => {
    render(<ShareArticle data={shareWithMapStops([UNMAPPED_STOP, NON_FINITE_STOP])} />);

    expect(screen.queryByTestId("share-map")).toBeNull();
  });

  it("adapts only public media with finite coordinates into photo points", () => {
    const points = photosFromPublicMedia([
      GEOTAGGED_MEDIA,
      {
        ...GEOTAGGED_MEDIA,
        id: "019b7b6b-4658-769e-8153-9f88eba061d2",
        lat: undefined,
        lng: undefined,
      },
      {
        ...GEOTAGGED_MEDIA,
        id: "019b7b6b-4658-769e-8153-9f88eba061d3",
        lat: Number.NaN,
        lng: 135.7681,
      },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      id: GEOTAGGED_MEDIA.id,
      lat: 35.0116,
      lng: 135.7681,
      thumbUrl: GEOTAGGED_MEDIA.thumbUrl,
      tripId: null,
    });

    const withoutThumb = photosFromPublicMedia([
      { ...GEOTAGGED_MEDIA, id: "019b7b6b-4658-769e-8153-9f88eba061d4", thumbUrl: null },
    ]);
    expect(withoutThumb[0]?.thumbUrl).toBe(GEOTAGGED_MEDIA.url);
  });

  it("exposes no editing controls inside the public map", () => {
    render(<ShareArticle data={shareWithMapStops([MAPPED_STOP])} />);

    const map = screen.getByTestId("share-map");
    expect(within(map).queryByRole("button", { name: /编辑|删除|添加/ })).toBeNull();
    expect(within(map).queryByRole("link", { name: /编辑|删除|添加/ })).toBeNull();
  });
});
