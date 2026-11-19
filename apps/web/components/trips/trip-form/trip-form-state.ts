import type {
  CreateTripRequest,
  GeoBbox,
  Place,
  Trip,
  TripDestination,
  TripDestinationInput,
  TripDestinationProvider,
  TripStatus,
  TripVisibility,
  UpdateTripRequest,
} from "@roamlog/contracts";

import {
  addDays,
  formatDateOnlyLabel,
  inclusiveDurationDays,
  isValidDateOnly,
  todayDateOnly,
} from "./date-utils";

/** `canonicalTripOrigin()` stores this sentinel when the origin is empty. */
export const UNSPECIFIED_ORIGIN = "未填写";

export const TRIP_FORM_LIMITS = {
  title: 160,
  summary: 1000,
  origin: 120,
  destinationCount: 30,
  /** Matches `TripDestinationSchema.name.max(160)` and DB `VARCHAR(160)`. */
  destinationLength: 160,
  tagCount: 20,
  tagLength: 40,
  guestCount: 30,
  guestLength: 120,
  /** `AmountMinorSchema` is a non-negative safe integer. */
  amountMinorMax: Number.MAX_SAFE_INTEGER,
} as const;

export interface TripFormOrigin {
  name: string;
  provider: Place["provider"];
  lat: number | null;
  lng: number | null;
  countryCode: string | null;
  timeZone: string | null;
  /** Formatted provider address, persisted on `Trip.originAddress`. */
  address: string | null;
  /** `[west, south, east, north]`, persisted on `Trip.originBbox`. */
  bbox: GeoBbox | null;
}

/**
 * Builds the form's origin from the place the user actually picked.
 *
 * `provider` comes from the search result (`geoapify`, `photon` or `local`)
 * instead of a hardcoded literal, so a Geoapify pick stays identifiable in the
 * form. `Trip` has no origin-provider column, so this value is display state
 * and is deliberately not part of the create/update payload.
 */
export function originFromPlace(place: Place): TripFormOrigin {
  return {
    name: place.name,
    provider: place.provider,
    lat: place.lat,
    lng: place.lng,
    countryCode: place.countryCode ?? null,
    timeZone: place.timeZone ?? null,
    address: place.address ?? null,
    bbox: place.bbox ?? null,
  };
}

/**
 * One destination as the form holds it. It is a superset of the request shape:
 * `id` is the stored row id (echo/upgrade only, never submitted) and every
 * metadata field mirrors what the place search returned.
 */
export interface TripFormDestination {
  id: string | null;
  name: string;
  provider: TripDestinationProvider;
  providerPlaceId: string | null;
  address: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  timeZone: string | null;
  bbox: GeoBbox | null;
}

/** Builds the form destination from the place the person actually picked. */
export function destinationFromPlace(place: Place): TripFormDestination {
  return {
    id: null,
    name: place.name,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    address: place.address,
    country: place.country,
    countryCode: place.countryCode ?? null,
    lat: place.lat,
    lng: place.lng,
    timeZone: place.timeZone ?? null,
    bbox: place.bbox ?? null,
  };
}

/** Manually typed destination: a real destination, but no place metadata. */
export function manualDestination(name: string): TripFormDestination {
  return {
    id: null,
    name,
    provider: "local",
    providerPlaceId: null,
    address: null,
    country: null,
    countryCode: null,
    lat: null,
    lng: null,
    timeZone: null,
    bbox: null,
  };
}

/** Stored row -> form value. A `null` provider stays "local" (unknown source). */
function destinationFromStored(row: TripDestination): TripFormDestination {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider ?? "local",
    providerPlaceId: row.providerPlaceId,
    address: row.address,
    country: row.country,
    countryCode: row.countryCode,
    lat: row.lat,
    lng: row.lng,
    timeZone: row.timeZone,
    bbox: row.bbox,
  };
}

/**
 * Form destinations for a saved trip.
 *
 * Prefers `destinationsV2` (ordered, soft-delete-free). A trip that only has the
 * deprecated `destinations` names is shown as name-only rows so the edit page
 * still echoes every place and the person can upgrade a row by searching again.
 */
export function destinationsFromTrip(trip: Trip): TripFormDestination[] {
  if (trip.destinationsV2 && trip.destinationsV2.length > 0) {
    return [...trip.destinationsV2]
      .sort((left, right) => left.order - right.order)
      .map(destinationFromStored);
  }
  return trip.destinations.map(manualDestination);
}

/** Request shape: no `id`, no `order` (the server assigns order). */
export function destinationInput(destination: TripFormDestination): TripDestinationInput {
  return {
    name: destination.name.trim(),
    provider: destination.provider,
    providerPlaceId: destination.providerPlaceId,
    address: destination.address,
    country: destination.country,
    countryCode: destination.countryCode,
    lat: destination.lat,
    lng: destination.lng,
    timeZone: destination.timeZone,
    bbox: destination.bbox,
  };
}

/** Order-aware equality: moving rows is a change, reordering metadata is too. */
export function sameDestinationGroup(
  left: readonly TripFormDestination[],
  right: readonly TripFormDestination[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((destination, index) => {
    const other = right[index];
    if (!other) return false;
    return (
      destination.name.trim() === other.name.trim() &&
      destination.provider === other.provider &&
      destination.providerPlaceId === other.providerPlaceId &&
      destination.address === other.address &&
      destination.country === other.country &&
      destination.countryCode === other.countryCode &&
      destination.lat === other.lat &&
      destination.lng === other.lng &&
      destination.timeZone === other.timeZone &&
      sameBbox(destination.bbox, other.bbox)
    );
  });
}

export interface TripFormValues {
  title: string;
  summary: string;
  status: TripStatus;
  visibility: TripVisibility;
  startDate: string;
  endDate: string;
  /** Selected origin with its place metadata; null when only free text is set. */
  origin: TripFormOrigin | null;
  /** Text currently in the origin combobox (kept when no place was selected). */
  originQuery: string;
  destinations: TripFormDestination[];
  /** Decimal string as typed by the person, e.g. "1200.50". */
  budgetAmount: string;
  budgetCurrency: string;
  tags: string[];
  guestNames: string[];
}

export type TripFormField =
  | "title"
  | "summary"
  | "status"
  | "visibility"
  | "startDate"
  | "endDate"
  | "origin"
  | "destinations"
  | "budgetAmount"
  | "budgetCurrency"
  | "tags"
  | "guestNames"
  | "form";

export type TripFormErrors = Partial<Record<TripFormField, string>>;

export const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "愿望",
  planning: "计划中",
  upcoming: "即将出发",
  active: "在途中",
  completed: "已归来",
};

export const VISIBILITY_LABELS: Record<TripVisibility, string> = {
  workspace: "工作区可见",
  custom: "指定可见",
  private: "仅自己可见",
  public_link: "公开链接",
};

const STATUS_VALUES = Object.keys(STATUS_LABELS) as TripStatus[];
const VISIBILITY_VALUES = Object.keys(VISIBILITY_LABELS) as TripVisibility[];

/** Default new-trip window: `endDate = startDate + 6` (7 days including both). */
export const DEFAULT_TRIP_NIGHTS = 6;

export function emptyTripFormValues(): TripFormValues {
  const today = todayDateOnly();
  return {
    title: "",
    summary: "",
    status: "planning",
    visibility: "workspace",
    startDate: today,
    // A one-week default keeps future departure dates selectable. With
    // `endDate = today` every future day used to be outside `max`.
    endDate: addDays(today, DEFAULT_TRIP_NIGHTS),
    origin: null,
    originQuery: "",
    destinations: [],
    budgetAmount: "",
    budgetCurrency: "",
    tags: [],
    guestNames: [],
  };
}

export interface TripDateChange {
  values: TripFormValues;
  /** The other endpoint that moved to keep the range valid, if any. */
  adjusted: "startDate" | "endDate" | null;
}

/**
 * Apply a date-picker pick and keep the range consistent instead of leaving
 * the person stuck with disabled days: moving the start past the end pushes
 * the end to the new start, and moving the end before the start pulls the
 * start back to the new end. Both are clamped to the picked value (a one-day
 * trip), never dropped.
 */
export function applyTripDateChange(
  values: TripFormValues,
  field: "startDate" | "endDate",
  value: string,
): TripDateChange {
  if (!isValidDateOnly(value)) {
    return { values: { ...values, [field]: value }, adjusted: null };
  }
  if (field === "startDate" && isValidDateOnly(values.endDate) && value > values.endDate) {
    return {
      values: { ...values, startDate: value, endDate: value },
      adjusted: "endDate",
    };
  }
  if (field === "endDate" && isValidDateOnly(values.startDate) && value < values.startDate) {
    return {
      values: { ...values, startDate: value, endDate: value },
      adjusted: "startDate",
    };
  }
  return { values: { ...values, [field]: value }, adjusted: null };
}

export function tripOriginName(trip: Trip): string {
  return trip.origin === UNSPECIFIED_ORIGIN ? "" : trip.origin;
}

export function valuesFromTrip(trip: Trip): TripFormValues {
  const originName = tripOriginName(trip);
  const hasCoordinates = trip.originLat !== null && trip.originLng !== null;
  return {
    title: trip.title,
    summary: trip.summary,
    status: trip.status,
    visibility: trip.visibility,
    startDate: trip.startDate,
    endDate: trip.endDate,
    origin: originName
      ? {
          name: originName,
          // `Trip` does not persist which provider the origin came from; this
          // only drives the "地点库 / 手动地点" badge on the edit page and is
          // never submitted. A place picked in this session keeps its real
          // provider through `originFromPlace`.
          provider: hasCoordinates ? "photon" : "local",
          lat: trip.originLat,
          lng: trip.originLng,
          countryCode: trip.originCountryCode,
          timeZone: trip.timeZone,
          // Persisted since the 0006 migration: an edited trip restores the
          // provider address and box instead of looking like nothing was saved.
          address: trip.originAddress,
          bbox: trip.originBbox,
        }
      : null,
    originQuery: originName,
    destinations: destinationsFromTrip(trip),
    budgetAmount: formatBudgetInput(trip.budgetAmountMinor),
    budgetCurrency: trip.budgetCurrency ?? "",
    tags: [...trip.tags],
    guestNames: [...trip.guestNames],
  };
}

/** "1200.00" -> "1200", "12.30" -> "12.30" for editing. */
export function formatBudgetInput(amountMinor: number | null): string {
  if (amountMinor === null) return "";
  if (amountMinor % 100 === 0) return String(amountMinor / 100);
  return (amountMinor / 100).toFixed(2);
}

export type BudgetParseResult =
  | { ok: true; amountMinor: number | null }
  | { ok: false; message: string };

export function parseBudgetAmount(raw: string): BudgetParseResult {
  const value = raw.trim();
  if (value === "") return { ok: true, amountMinor: null };
  if (value.startsWith("-")) return { ok: false, message: "金额不能为负数" };
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return { ok: false, message: "请输入有效金额，最多两位小数" };
  }
  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = Number(wholePart);
  const fraction = Number((fractionPart + "00").slice(0, 2));
  const amountMinor = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountMinor) || amountMinor > TRIP_FORM_LIMITS.amountMinorMax) {
    return { ok: false, message: "金额超出可保存的范围" };
  }
  return { ok: true, amountMinor };
}

export function deriveCountryCodes(
  values: TripFormValues,
  preserved: readonly string[] = [],
): string[] {
  const codes = new Set<string>();
  const originCode = values.origin?.countryCode?.trim().toUpperCase();
  if (originCode) codes.add(originCode);
  for (const destination of values.destinations) {
    const code = destination.countryCode?.trim().toUpperCase();
    if (code) codes.add(code);
  }
  for (const code of preserved) {
    const normalized = code.trim().toUpperCase();
    if (normalized) codes.add(normalized);
  }
  return [...codes];
}

export function validateTripForm(values: TripFormValues): TripFormErrors {
  const errors: TripFormErrors = {};
  const title = values.title.trim();

  if (!title) {
    errors.title = "请填写旅行标题";
  } else if (title.length > TRIP_FORM_LIMITS.title) {
    errors.title = `标题最多 ${TRIP_FORM_LIMITS.title} 个字符，当前 ${title.length} 个`;
  }

  if (values.summary.trim().length > TRIP_FORM_LIMITS.summary) {
    errors.summary = `摘要最多 ${TRIP_FORM_LIMITS.summary} 个字符（契约限制）`;
  }

  if (!isValidDateOnly(values.startDate)) {
    errors.startDate = "请选择出发日期";
  }
  if (!isValidDateOnly(values.endDate)) {
    errors.endDate = "请选择返回日期";
  } else if (!errors.startDate && values.endDate < values.startDate) {
    errors.endDate = `返回日期不能早于出发日期（${formatDateOnlyLabel(values.startDate)}）`;
  }

  const originName = (values.origin?.name ?? values.originQuery).trim();
  if (originName.length > TRIP_FORM_LIMITS.origin) {
    errors.origin = `起点最多 ${TRIP_FORM_LIMITS.origin} 个字符`;
  }

  const destinationNames = values.destinations.map((destination) => destination.name);
  if (values.destinations.length > TRIP_FORM_LIMITS.destinationCount) {
    errors.destinations = `最多添加 ${TRIP_FORM_LIMITS.destinationCount} 个目的地`;
  } else if (destinationNames.some((name) => name.trim().length === 0)) {
    errors.destinations = "目的地不能为空";
  } else if (
    destinationNames.some((name) => name.trim().length > TRIP_FORM_LIMITS.destinationLength)
  ) {
    errors.destinations = `单个目的地不能超过 ${TRIP_FORM_LIMITS.destinationLength} 个字符`;
  } else if (hasDuplicates(destinationNames)) {
    errors.destinations = "目的地不能重复";
  }

  if (values.tags.length > TRIP_FORM_LIMITS.tagCount) {
    errors.tags = `最多添加 ${TRIP_FORM_LIMITS.tagCount} 个标签`;
  } else if (values.tags.some((tag) => tag.trim().length === 0)) {
    errors.tags = "标签不能为空";
  } else if (values.tags.some((tag) => tag.trim().length > TRIP_FORM_LIMITS.tagLength)) {
    errors.tags = `单个标签不能超过 ${TRIP_FORM_LIMITS.tagLength} 个字符`;
  } else if (hasDuplicates(values.tags)) {
    errors.tags = "标签不能重复";
  }

  if (values.guestNames.length > TRIP_FORM_LIMITS.guestCount) {
    errors.guestNames = `最多添加 ${TRIP_FORM_LIMITS.guestCount} 位同行人`;
  } else if (
    values.guestNames.some((name) => name.trim().length > TRIP_FORM_LIMITS.guestLength)
  ) {
    errors.guestNames = `同行人姓名不能超过 ${TRIP_FORM_LIMITS.guestLength} 个字符`;
  } else if (hasDuplicates(values.guestNames)) {
    errors.guestNames = "同行人不能重复";
  }

  const budget = parseBudgetAmount(values.budgetAmount);
  const currency = values.budgetCurrency.trim().toUpperCase();
  if (!budget.ok) {
    errors.budgetAmount = budget.message;
  }
  if (currency !== "" && !/^[A-Z]{3}$/.test(currency)) {
    errors.budgetCurrency = "请选择有效的 ISO 4217 币种";
  }
  if (budget.ok && budget.amountMinor !== null && currency === "") {
    errors.budgetCurrency = "填写金额后需要选择币种";
  }
  if (budget.ok && budget.amountMinor === null && currency !== "") {
    errors.budgetAmount = "选择币种后需要填写金额";
  }
  if (!STATUS_VALUES.includes(values.status)) {
    errors.status = "状态不在契约枚举内";
  }
  if (!VISIBILITY_VALUES.includes(values.visibility)) {
    errors.visibility = "可见性不在契约枚举内";
  }

  return errors;
}

function hasDuplicates(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function originPayload(values: TripFormValues) {
  const name = (values.origin?.name ?? values.originQuery).trim();
  if (!name) return null;
  return {
    origin: name,
    originLat: values.origin?.lat ?? null,
    originLng: values.origin?.lng ?? null,
    originCountryCode: values.origin?.countryCode ?? null,
    originAddress: values.origin?.address ?? null,
    originBbox: values.origin?.bbox ?? null,
    timeZone: values.origin?.timeZone ?? null,
  };
}

export function buildCreateTripRequest(values: TripFormValues): CreateTripRequest {
  const summary = values.summary.trim();
  const origin = originPayload(values);
  const budget = parseBudgetAmount(values.budgetAmount);
  const countryCodes = deriveCountryCodes(values);
  const destinationsV2 = values.destinations.map(destinationInput);

  return {
    title: values.title.trim(),
    ...(summary ? { summary } : {}),
    status: values.status,
    visibility: values.visibility,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(origin ?? {}),
    // Structured group only: the server mirrors the deprecated names array.
    ...(destinationsV2.length > 0 ? { destinationsV2 } : {}),
    ...(countryCodes.length > 0 ? { countryCodes } : {}),
    ...(values.tags.length > 0 ? { tags: values.tags.map((tag) => tag.trim()) } : {}),
    ...(values.guestNames.length > 0
      ? { guestNames: values.guestNames.map((name) => name.trim()) }
      : {}),
    ...(budget.ok && budget.amountMinor !== null
      ? {
          budgetAmountMinor: budget.amountMinor,
          budgetCurrency: values.budgetCurrency.trim().toUpperCase(),
        }
      : {}),
  };
}

export function buildUpdateTripRequest(
  values: TripFormValues,
  initialTrip: Trip,
): UpdateTripRequest | null {
  const initialOriginName = tripOriginName(initialTrip);
  const currentOrigin = originPayload(values);
  const nextSummary = values.summary.trim();
  const budget = parseBudgetAmount(values.budgetAmount);
  const nextBudgetMinor = budget.ok ? budget.amountMinor : null;
  const nextCurrency = values.budgetCurrency.trim().toUpperCase() || null;
  const initialDestinations = destinationsFromTrip(initialTrip);
  const preservedCountryCodes = initialTrip.countryCodes.filter(
    (code) => code.toUpperCase() !== (initialTrip.originCountryCode ?? "").toUpperCase(),
  );
  const nextCountryCodes = deriveCountryCodes(values, preservedCountryCodes);

  const patch: UpdateTripRequest = { version: initialTrip.version };

  if (values.title.trim() !== initialTrip.title) patch.title = values.title.trim();
  if (nextSummary !== initialTrip.summary) patch.summary = nextSummary;
  if (values.status !== initialTrip.status) patch.status = values.status;
  if (values.visibility !== initialTrip.visibility) patch.visibility = values.visibility;
  if (values.startDate !== initialTrip.startDate) patch.startDate = values.startDate;
  if (values.endDate !== initialTrip.endDate) patch.endDate = values.endDate;

  const originChanged =
    (currentOrigin?.origin ?? "") !== initialOriginName ||
    (currentOrigin?.originLat ?? null) !== initialTrip.originLat ||
    (currentOrigin?.originLng ?? null) !== initialTrip.originLng ||
    (currentOrigin?.originCountryCode ?? null) !== initialTrip.originCountryCode ||
    (currentOrigin?.originAddress ?? null) !== initialTrip.originAddress ||
    !sameBbox(currentOrigin?.originBbox ?? null, initialTrip.originBbox ?? null) ||
    (currentOrigin?.timeZone ?? null) !== initialTrip.timeZone;
  if (originChanged) {
    if (currentOrigin) {
      patch.origin = currentOrigin.origin;
      patch.originLat = currentOrigin.originLat;
      patch.originLng = currentOrigin.originLng;
      patch.originCountryCode = currentOrigin.originCountryCode;
      patch.originAddress = currentOrigin.originAddress;
      patch.originBbox = currentOrigin.originBbox;
      patch.timeZone = currentOrigin.timeZone;
    } else {
      // `origin` cannot be an empty string in the contract; the API normalizes
      // empty input to this sentinel, so sending it is the supported "clear".
      patch.origin = UNSPECIFIED_ORIGIN;
      patch.originLat = null;
      patch.originLng = null;
      patch.originCountryCode = null;
      patch.originAddress = null;
      patch.originBbox = null;
      patch.timeZone = null;
    }
  }

  if (!sameDestinationGroup(values.destinations, initialDestinations)) {
    patch.destinationsV2 = values.destinations.map(destinationInput);
  }
  if (!sameStringSet(nextCountryCodes, initialTrip.countryCodes)) {
    patch.countryCodes = nextCountryCodes;
  }
  if (!sameStringArray(values.tags.map((tag) => tag.trim()), initialTrip.tags)) {
    patch.tags = values.tags.map((tag) => tag.trim());
  }
  if (!sameStringArray(values.guestNames.map((name) => name.trim()), initialTrip.guestNames)) {
    patch.guestNames = values.guestNames.map((name) => name.trim());
  }

  const budgetChanged =
    nextBudgetMinor !== initialTrip.budgetAmountMinor ||
    nextCurrency !== initialTrip.budgetCurrency;
  if (budgetChanged) {
    patch.budgetAmountMinor = nextBudgetMinor;
    patch.budgetCurrency = nextCurrency;
  }

  return Object.keys(patch).length > 1 ? patch : null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Both null, or four identical numbers in `[west, south, east, north]` order. */
function sameBbox(left: GeoBbox | null, right: GeoBbox | null): boolean {
  if (left === null || right === null) return left === right;
  return left.every((value, index) => value === right[index]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export function tripFormDurationLabel(values: TripFormValues): string | null {
  const days = inclusiveDurationDays(values.startDate, values.endDate);
  if (days === null) return null;
  return `共 ${days} 天 · ${Math.max(0, days - 1)} 晚`;
}

export function mapServerFieldErrors(
  issues: ReadonlyArray<{ field?: string; message: string }>,
): TripFormErrors {
  const errors: TripFormErrors = {};
  for (const issue of issues) {
    const field = issue.field?.split(".")[0];
    const mapped = mapServerField(field);
    if (!mapped) {
      errors.form ??= issue.message;
      continue;
    }
    errors[mapped] ??= issue.message;
  }
  return errors;
}

function mapServerField(field: string | undefined): TripFormField | null {
  switch (field) {
    case "title":
    case "summary":
    case "status":
    case "visibility":
    case "startDate":
    case "endDate":
    case "origin":
    case "destinations":
    case "tags":
    case "guestNames":
      return field;
    case "destinationsV2":
      return "destinations";
    case "originLat":
    case "originLng":
    case "originCountryCode":
    case "originAddress":
    case "originBbox":
    case "timeZone":
      return "origin";
    case "countryCodes":
      return "destinations";
    case "budgetAmountMinor":
      return "budgetAmount";
    case "budgetCurrency":
      return "budgetCurrency";
    default:
      return null;
  }
}
