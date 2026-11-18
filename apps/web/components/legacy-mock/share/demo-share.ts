import {
  PublicTripResponseSchema,
  type PublicMedia,
  type PublicTripResponse,
} from "@roamlog/contracts";
import { demoFixtureState } from "@roamlog/api-mocks/fixtures";

const SHARE_STORAGE_PREFIX = "roamlog:mock-share:";
const DEFAULT_PASSWORD = "roamlog";
const MOCK_MEDIA_ORIGIN = "https://media.example.invalid";
const MOCK_MEDIA_EXPIRES_AT = "2027-01-01T00:00:00.000Z";

export interface MockShareMeta {
  password?: string;
  showBudget: boolean;
  expiresAt?: string | null;
  revoked?: boolean;
}

export type DemoShareResolution =
  | { status: "ready"; data: PublicTripResponse }
  | { status: "password" }
  | { status: "invalid-password" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "not-found" };

export function registerMockShare(token: string, meta: MockShareMeta) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(`${SHARE_STORAGE_PREFIX}${token}`, JSON.stringify(meta));
}

export function readMockShareMeta(token: string): MockShareMeta | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${SHARE_STORAGE_PREFIX}${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MockShareMeta;
  } catch {
    return null;
  }
}

export function resolveDemoShare(token: string, password?: string): DemoShareResolution {
  if (token === "expired-demo") return { status: "expired" };
  if (token === "revoked-demo") return { status: "revoked" };
  if (
    !token.startsWith("demo") &&
    token !== "password-demo" &&
    token !== "no-budget-demo"
  ) {
    return { status: "not-found" };
  }

  const meta = readMockShareMeta(token);
  const requiredPassword =
    meta?.password ?? (token === "password-demo" ? DEFAULT_PASSWORD : undefined);
  if (requiredPassword) {
    if (!password) return { status: "password" };
    if (password !== requiredPassword) return { status: "invalid-password" };
  }

  const showBudget = meta?.showBudget ?? token !== "no-budget-demo";
  return { status: "ready", data: buildDemoPublicTrip({ showBudget }) };
}

export function buildDemoPublicTrip({
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

function publicMedia(media: (typeof demoFixtureState.media)[number]): PublicMedia {
  return {
    id: media.id,
    url: `${MOCK_MEDIA_ORIGIN}/mock/display/${media.id}.jpg`,
    thumbUrl: `${MOCK_MEDIA_ORIGIN}/mock/thumb/${media.id}.jpg`,
    expiresAt: MOCK_MEDIA_EXPIRES_AT,
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
