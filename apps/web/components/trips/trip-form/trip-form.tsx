"use client";

import type {
  CreateTripRequest,
  Place,
  Trip,
  TripStatus,
  TripVisibility,
  UpdateTripRequest,
} from "@roamlog/contracts";
import {
  Badge,
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Switch,
  Textarea,
  buttonVariants,
} from "@roamlog/ui";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ChipsInput } from "@/components/forms/chips-input";
import type { ComboboxOption, ComboboxSearch } from "@/components/forms/searchable-combobox";
import { CoverUploader } from "@/components/media";
import type { CoverChange, CoverUploadError, CoverUploadPhase } from "@/components/media";
import { isApiError, isForbidden, isVersionConflict } from "@/lib/api/errors";
import {
  TripAccessGrantsSaveError,
  type TripAccessGrantsInput,
  withTripAccessGrants,
} from "@/lib/api/trip-form";
import type { PlacesProvider } from "@/lib/places-attribution";
import { formatBudget, getTripStatusLabel, getTripStatusTone } from "@/lib/trip-presentation";

import { AccessGrantsField, useTripAccessGrantEditor } from "./access-grants-field";
import { BudgetField } from "./budget-field";
import { DatePicker } from "./date-picker";
import { DestinationsField } from "./destinations-field";
import { formatDateRangeLabel } from "./date-utils";
import { FormRow } from "./field-shell";
import { OriginField } from "./origin-field";
import {
  STATUS_LABELS,
  TRIP_FORM_LIMITS,
  VISIBILITY_LABELS,
  applyTripDateChange,
  buildCreateTripRequest,
  buildUpdateTripRequest,
  destinationFromPlace,
  emptyTripFormValues,
  manualDestination,
  mapServerFieldErrors,
  originFromPlace,
  parseBudgetAmount,
  tripFormDurationLabel,
  validateTripForm,
  valuesFromTrip,
  type TripFormErrors,
  type TripFormField,
  type TripFormValues,
} from "./trip-form-state";

export interface TripFormPlaceSearchResult {
  items: Place[];
  degraded?: boolean;
  /**
   * Provider that actually produced `items`. Optional so existing callers keep
   * working, but place searches must forward it or the UI can only show the
   * conservative OSM credit instead of the real source.
   */
  provider?: PlacesProvider;
}

export type TripFormPlaceSearch = (
  query: string,
  context: { signal: AbortSignal },
) => Promise<TripFormPlaceSearchResult>;

interface TripFormSharedProps {
  workspaceId: string;
  workspaceName?: string;
  /** Injected so the form never fetches on its own during tests. */
  searchPlaces: TripFormPlaceSearch;
  cancelHref: string;
  submitLabel?: string;
}

export interface TripFormSubmitContext {
  /** `mediaId` staged by the cover uploader in create mode; null when no cover. */
  coverMediaId: string | null;
}

export type TripFormProps = TripFormSharedProps &
  (
    | {
        mode: "create";
        onSubmit: (input: CreateTripRequest, context: TripFormSubmitContext) => Promise<void>;
      }
    | {
        mode: "edit";
        initialTrip: Trip;
        onSubmit: (input: UpdateTripRequest) => Promise<void>;
        onReload?: () => void;
      }
  );

interface FormBanner {
  tone: "error" | "info";
  message: string;
  conflict?: boolean;
}

interface AccessGrantSaveFailure {
  stage: "created" | "updated";
  trip: Trip;
}

const CREATE_SUBMIT_LABEL = "创建旅行";
const EDIT_SUBMIT_LABEL = "保存旅行";

const FIELD_IDS: Partial<Record<TripFormField, string>> = {
  title: "trip-title",
  summary: "trip-summary",
  status: "trip-status",
  visibility: "trip-visibility",
  accessGrants: "trip-access-grants",
  startDate: "trip-start-date",
  endDate: "trip-end-date",
  origin: "trip-origin",
  destinations: "trip-destination-search",
  budgetAmount: "trip-budget-amount",
  budgetCurrency: "trip-budget-currency",
  tags: "trip-tags",
  guestNames: "trip-guests",
};

const FIELD_ORDER: TripFormField[] = [
  "title",
  "summary",
  "visibility",
  "accessGrants",
  "startDate",
  "endDate",
  "origin",
  "destinations",
  "budgetAmount",
  "budgetCurrency",
  "tags",
  "guestNames",
];

const COVER_BUSY_PHASES: readonly CoverUploadPhase[] = [
  "validating",
  "presigning",
  "uploading",
  "completing",
  "processing",
  "applying",
];

function firstErrorId(errors: TripFormErrors): string | undefined {
  const field = FIELD_ORDER.find((key) => errors[key]);
  return field ? FIELD_IDS[field] : undefined;
}

function focusField(id: string | undefined) {
  if (!id || typeof document === "undefined") return;
  globalThis.requestAnimationFrame?.(() => {
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) element.focus();
  });
}

function placeOptionId(place: Place): string {
  return `${place.provider}:${String(place.providerPlaceId)}`;
}

const EXACT_LOCATION_FIELD_ID = "trip-exact-photo-location";
const EXACT_LOCATION_HINT_ID = `${EXACT_LOCATION_FIELD_ID}-hint`;

/**
 * Trip-level privacy switch.
 *
 * It belongs to the trip settings — this form, reached through "编辑旅行" — and
 * not to the photos tab, because it is a decision about the trip rather than
 * about one tab. `Trip.showExactPhotoLocation` is read by the public share page
 * only (the authenticated media reads ignore it), so the copy must promise
 * exactly that and nothing wider.
 *
 * A boolean is submitted on the same `PATCH /v1/trips/{id}` as every other field,
 * which is also where `version` rides, so a stale write is still rejected.
 */
function ExactPhotoLocationField({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="surface-card flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={EXACT_LOCATION_FIELD_ID} className="text-[13px] text-ink">
          公开页显示精确位置
        </Label>
        <p id={EXACT_LOCATION_HINT_ID} className="text-xs leading-5 text-muted">
          默认开启。关闭后，公开分享页只显示城市，不显示照片拍摄的精确位置；工作区成员在应用内看到的照片位置不受影响。
        </p>
      </div>
      <Switch
        id={EXACT_LOCATION_FIELD_ID}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label="公开页显示精确位置"
        aria-describedby={EXACT_LOCATION_HINT_ID}
      />
    </div>
  );
}

export function TripForm(props: TripFormProps) {
  const { workspaceId, workspaceName, searchPlaces, cancelHref, submitLabel } = props;
  const isCreate = props.mode === "create";

  const [values, setValues] = React.useState<TripFormValues>(() =>
    props.mode === "edit" ? valuesFromTrip(props.initialTrip) : emptyTripFormValues(),
  );
  const [errors, setErrors] = React.useState<TripFormErrors>({});
  const [banner, setBanner] = React.useState<FormBanner | null>(null);
  const [pending, setPending] = React.useState(false);
  const [tripState, setTripState] = React.useState<Trip | null>(() =>
    props.mode === "edit" ? props.initialTrip : null,
  );
  const [pendingCoverMediaId, setPendingCoverMediaId] = React.useState<string | null>(null);
  const [coverError, setCoverError] = React.useState<string | null>(null);
  const [coverPhase, setCoverPhase] = React.useState<CoverUploadPhase>("idle");
  const [accessGrantFailure, setAccessGrantFailure] =
    React.useState<AccessGrantSaveFailure | null>(null);

  const coverBusy = COVER_BUSY_PHASES.includes(coverPhase);
  // A failed grants write means the trip row is already saved. Keep the rest of
  // the form read-only until the retry completes, otherwise another submit would
  // look like it could change fields that this retry will intentionally skip.
  const accessGrantRetrying = Boolean(accessGrantFailure);
  const busy = pending || coverBusy || accessGrantRetrying;
  const grantEditor = useTripAccessGrantEditor({
    mode: props.mode,
    tripId: props.mode === "edit" ? props.initialTrip.id : undefined,
    workspaceId,
    createdById: props.mode === "edit" ? props.initialTrip.createdById : undefined,
    enabled: values.visibility === "custom",
  });
  const grantSelectionCount =
    grantEditor.selection.workspaces.length + grantEditor.selection.users.length;

  React.useEffect(() => {
    if (grantSelectionCount === 0) return;
    setErrors((current) => {
      if (!current.accessGrants) return current;
      const next = { ...current };
      delete next.accessGrants;
      return next;
    });
  }, [grantSelectionCount]);

  const placeIndex = React.useRef(new Map<string, Place>());

  const search: ComboboxSearch = React.useCallback(
    async (query, { signal }) => {
      const result = await searchPlaces(query, { signal });
      const items: ComboboxOption[] = result.items.map((place) => {
        const id = placeOptionId(place);
        placeIndex.current.set(id, place);
        return {
          id,
          label: place.name,
          // A full address beats a bare country for disambiguating "Springfield".
          description: place.address ?? place.country,
          meta: place.countryCode || undefined,
        };
      });
      return { items, degraded: result.degraded, provider: result.provider };
    },
    [searchPlaces],
  );

  const durationLabel = tripFormDurationLabel(values);
  const titleValue = values.title.trim();
  const originName = values.origin?.name ?? values.originQuery.trim();
  const parsedBudget = parseBudgetAmount(values.budgetAmount);
  const budgetPreview =
    parsedBudget.ok &&
    parsedBudget.amountMinor !== null &&
    /^[A-Z]{3}$/.test(values.budgetCurrency.trim().toUpperCase())
      ? formatBudget(parsedBudget.amountMinor, values.budgetCurrency.trim().toUpperCase())
      : null;

  function clearFieldErrors(...fields: TripFormField[]) {
    setErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  function updateFields(patch: Partial<TripFormValues>, cleared: TripFormField[] = []) {
    setValues((current) => ({ ...current, ...patch }));
    if (cleared.length > 0) clearFieldErrors(...cleared);
  }

  /**
   * Date pickers no longer clamp each other (which made future starts
   * unreachable on a new `today/today` trip). Instead the opposite endpoint
   * follows the pick, and the pair is re-validated so stale field errors clear.
   */
  function handleDateChange(field: "startDate" | "endDate", value: string) {
    const change = applyTripDateChange(values, field, value);
    setValues(change.values);
    setErrors((current) => {
      const validated = validateTripForm(change.values);
      const next = { ...current };
      for (const key of ["startDate", "endDate"] as const) {
        const message = validated[key];
        if (message) next[key] = message;
        else delete next[key];
      }
      return next;
    });
  }

  function handleOriginQueryChange(query: string) {
    setValues((current) => ({
      ...current,
      originQuery: query,
      // Editing the text after picking a place invalidates the stored coordinates.
      origin: current.origin && current.origin.name !== query ? null : current.origin,
    }));
    clearFieldErrors("origin");
  }

  function handleOriginSelect(option: ComboboxOption) {
    const place = placeIndex.current.get(option.id);
    const origin = place
      ? originFromPlace(place)
      : {
          name: option.label,
          provider: "local" as const,
          lat: null,
          lng: null,
          countryCode: option.meta ?? null,
          timeZone: null,
          address: null,
          bbox: null,
        };
    updateFields({ origin, originQuery: origin.name }, ["origin"]);
  }

  function handleOriginManual(query: string) {
    const name = query.trim();
    if (!name) return;
    updateFields(
      {
        origin: {
          name,
          provider: "local",
          lat: null,
          lng: null,
          countryCode: null,
          timeZone: null,
          address: null,
          bbox: null,
        },
        originQuery: name,
      },
      ["origin"],
    );
  }

  function handleOriginClear() {
    updateFields({ origin: null, originQuery: "" }, ["origin"]);
  }

  function handleAddPlaceDestination(place: Place) {
    const destination = destinationFromPlace(place);
    setValues((current) => ({
      ...current,
      destinations: [...current.destinations, destination],
    }));
    clearFieldErrors("destinations");
  }

  function handleAddManualDestination(name: string) {
    setValues((current) => ({
      ...current,
      destinations: [...current.destinations, manualDestination(name)],
    }));
    clearFieldErrors("destinations");
  }

  function handleReplaceWithPlace(index: number, place: Place) {
    const destination = destinationFromPlace(place);
    setValues((current) => ({
      ...current,
      destinations: current.destinations.map((existing, currentIndex) =>
        currentIndex === index ? destination : existing,
      ),
    }));
    clearFieldErrors("destinations");
  }

  function handleReplaceWithManual(index: number, name: string) {
    const destination = manualDestination(name);
    setValues((current) => ({
      ...current,
      destinations: current.destinations.map((existing, currentIndex) =>
        currentIndex === index ? destination : existing,
      ),
    }));
    clearFieldErrors("destinations");
  }

  function handleRemoveDestination(index: number) {
    setValues((current) => ({
      ...current,
      destinations: current.destinations.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function handleMoveDestination(index: number, direction: -1 | 1) {
    setValues((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.destinations.length) return current;
      const destinations = [...current.destinations];
      const moving = destinations[index];
      const displaced = destinations[target];
      if (moving === undefined || displaced === undefined) return current;
      destinations[index] = displaced;
      destinations[target] = moving;
      return { ...current, destinations };
    });
  }

  function handleCoverChange(change: CoverChange) {
    setCoverError(null);
    if (props.mode === "create") {
      setPendingCoverMediaId(change.mediaId);
      return;
    }
    // The uploader has already called POST /v1/trips/{id}/cover (or the versioned
    // PATCH that clears it) and returns the freshest trip, including its version.
    if (change.trip) setTripState(change.trip);
  }

  function handleCoverError(error: CoverUploadError) {
    setCoverError(
      error.detail ? `${error.message}：${error.detail}` : error.message || "封面上传失败。",
    );
  }

  function applyServerError(error: unknown) {
    if (isVersionConflict(error)) {
      setBanner({
        tone: "error",
        conflict: true,
        message:
          "保存失败：旅行已被其他人更新（409 版本冲突）。请重新加载最新版本，再重新提交你的修改。",
      });
      return;
    }
    if (isApiError(error)) {
      if (error.status === 422) {
        const fieldErrors = mapServerFieldErrors(error.problem?.errors ?? []);
        setErrors(fieldErrors);
        focusField(firstErrorId(fieldErrors));
        setBanner({
          tone: "error",
          message:
            fieldErrors.form ??
            `保存失败，请检查标记的字段。${error.problem?.detail ? ` ${error.problem.detail}` : ""}`,
        });
        return;
      }
      if (isForbidden(error)) {
        setBanner({
          tone: "error",
          message: "保存失败：你没有编辑此旅行的权限（Viewer 角色或被移出工作区）。",
        });
        return;
      }
      if (error.status === 401) {
        setBanner({ tone: "error", message: "登录状态已失效，请重新登录后再保存。" });
        return;
      }
      setBanner({
        tone: "error",
        message: `保存失败，请稍后重试。${error.problem?.detail ? `：${error.problem.detail}` : ""}`,
      });
      return;
    }
    setBanner({
      tone: "error",
      message: "网络异常，未能保存。请检查网络连接后重试，已填写的内容不会丢失。",
    });
  }

  function selectedAccessGrantCount(): number {
    return grantSelectionCount;
  }

  function accessGrantPayload(): TripAccessGrantsInput | null {
    if (values.visibility !== "custom" || !grantEditor.canManage) return null;
    return {
      workspaces: [...grantEditor.selection.workspaces],
      users: [...grantEditor.selection.users],
    };
  }

  function accessGrantValidationError(): string | null {
    if (values.visibility !== "custom") return null;
    if (grantEditor.status === "loading" || grantEditor.status === "idle") {
      return "正在读取可见范围，请稍候再保存。";
    }
    if (grantEditor.status === "error") {
      return "可见范围读取失败，请点击“重新加载”后再保存，避免覆盖已有设置。";
    }
    if (!grantEditor.canManage) {
      const alreadyCustom =
        props.mode === "edit" && props.initialTrip.visibility === "custom";
      if (!alreadyCustom) {
        return "只有行程创建者或工作区 Owner/Admin 可以设置指定可见范围。";
      }
      return null;
    }
    if (selectedAccessGrantCount() === 0) {
      return "指定可见至少需要选择一个工作区或一位成员，否则没有人能进入这趟旅行。";
    }
    return null;
  }

  function applyAccessGrantFailure(error: TripAccessGrantsSaveError) {
    setAccessGrantFailure({ stage: error.stage, trip: error.trip });
    if (error.stage === "updated") setTripState(error.trip);

    const reason = isForbidden(error.reason)
      ? "当前角色没有管理可见范围的权限。"
      : isApiError(error.reason)
        ? error.reason.code === "INVALID_RESPONSE"
          ? "可见范围已提交，但返回的数据无法识别。"
          : "保存可见范围失败，请稍后重试。"
        : "网络异常，保存可见范围失败。";
    setBanner({
      tone: "error",
      message:
        error.stage === "created"
          ? `行程已创建，但可见范围未保存。${reason} 请点击「重试保存可见范围」，不会重复创建行程。`
          : `行程字段已保存，但可见范围未保存。${reason} 请点击「重试保存可见范围」，不会重复提交行程字段。`,
    });
  }

  async function retryAccessGrantSave() {
    if (!accessGrantFailure || pending) return;
    const grants = accessGrantPayload();
    if (!grants) {
      setBanner({
        tone: "error",
        message: "可见范围没有成功载入，暂时无法重试。请返回旅行详情后重新进入编辑页。",
      });
      return;
    }

    setPending(true);
    setBanner(null);
    try {
      if (accessGrantFailure.stage === "created" && props.mode === "create") {
        await props.onSubmit(withTripAccessGrants(buildCreateTripRequest(values), grants), {
          coverMediaId: pendingCoverMediaId,
        });
      } else if (accessGrantFailure.stage === "updated" && props.mode === "edit") {
        await props.onSubmit(
          withTripAccessGrants({ version: accessGrantFailure.trip.version }, grants),
        );
      } else {
        throw new Error("Access grant retry does not match the form mode.");
      }
      setAccessGrantFailure(null);
    } catch (error) {
      if (error instanceof TripAccessGrantsSaveError) {
        applyAccessGrantFailure(error);
      } else {
        applyServerError(error);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || coverBusy || accessGrantFailure) return;

    const nextErrors = validateTripForm(values);
    const grantError = accessGrantValidationError();
    if (grantError) nextErrors.accessGrants = grantError;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusField(firstErrorId(nextErrors));
      setBanner({
        tone: "error",
        message: nextErrors.form ?? nextErrors.accessGrants ?? "还有字段需要修正，请检查下方标记。",
      });
      return;
    }

    const grants = accessGrantPayload();
    setErrors({});
    setBanner(null);
    setPending(true);
    try {
      if (props.mode === "create") {
        const input = buildCreateTripRequest(values);
        await props.onSubmit(
          grants ? withTripAccessGrants(input, grants) : input,
          { coverMediaId: pendingCoverMediaId },
        );
        return;
      }

      const patch = buildUpdateTripRequest(values, tripState ?? props.initialTrip);
      const grantsChanged = Boolean(grants && grantEditor.dirty);
      if (!patch && !grantsChanged) {
        setBanner({ tone: "info", message: "没有检测到修改，未提交请求。" });
        return;
      }
      if (!patch && grants) {
        // `UpdateTripRequestSchema` rejects a version-only patch, so a
        // grants-only edit must still carry a real field. Re-asserting the
        // current `visibility: "custom"` keeps the mandatory trip write valid
        // before the full grants replacement.
        await props.onSubmit(
          withTripAccessGrants(
            {
              version: (tripState ?? props.initialTrip).version,
              visibility: values.visibility,
            },
            grants,
          ),
        );
        return;
      }
      if (!patch) return;
      await props.onSubmit(grants ? withTripAccessGrants(patch, grants) : patch);
    } catch (error) {
      if (error instanceof TripAccessGrantsSaveError) {
        applyAccessGrantFailure(error);
      } else {
        applyServerError(error);
      }
    } finally {
      setPending(false);
    }
  }

  const pageTitle = isCreate ? "新建旅行" : "编辑旅行";
  const pageDescription = isCreate
    ? workspaceName
      ? `为「${workspaceName}」记录一段新的旅程。标题与日期是必填项，保存后会直接进入旅行详情。`
      : "记录一段新的旅程。标题与日期是必填项，保存后会直接进入旅行详情。"
    : "更新旅行的基本信息、路线与预算。只有改动过的字段会提交，保存后立即生效。";
  const defaultSubmitLabel = isCreate ? CREATE_SUBMIT_LABEL : EDIT_SUBMIT_LABEL;
  const grantFailureHref = accessGrantFailure
    ? accessGrantFailure.stage === "created"
      ? `${cancelHref.replace(/\/$/, "")}/${accessGrantFailure.trip.id}`
      : cancelHref
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        eyebrow={isCreate ? "TRIPS / NEW" : "TRIPS / EDIT"}
        title={pageTitle}
        description={pageDescription}
        titleSize="page"
      />

      <form noValidate onSubmit={handleSubmit} className="mt-8">
        {banner ? (
          <div
            role={banner.tone === "error" ? "alert" : "status"}
            className={
              banner.tone === "error"
                ? "mb-8 flex flex-col gap-3 rounded-control border border-accent-red/30 bg-accent-red/5 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
                : "mb-8 flex flex-col gap-3 rounded-control border border-hairline-strong bg-surface-1 px-4 py-3 text-sm text-body sm:flex-row sm:items-center sm:justify-between"
            }
          >
            <p className="leading-6">{banner.message}</p>
            {accessGrantFailure ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void retryAccessGrantSave()}
                  disabled={pending}
                >
                  {pending ? "重试中…" : "重试保存可见范围"}
                </Button>
                {grantFailureHref ? (
                  <Link href={grantFailureHref} className={buttonVariants({ variant: "ghost" })}>
                    前往旅行详情
                  </Link>
                ) : null}
              </div>
            ) : banner.conflict && props.mode === "edit" && props.onReload ? (
              <Button type="button" variant="outline" size="sm" onClick={props.onReload}>
                重新加载最新版本
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-12">
          <fieldset disabled={pending || accessGrantRetrying} className="min-w-0 space-y-10">
            <section className="space-y-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">01 / 基本信息</h2>
                <span className="type-meta text-stone">* 为必填</span>
              </div>

              <FormRow
                id="trip-title"
                label="旅行标题"
                required
                hint={`最多 ${TRIP_FORM_LIMITS.title} 个字符 · ${values.title.length}/${TRIP_FORM_LIMITS.title}`}
                error={errors.title}
              >
                {({ describedBy, invalid }) => (
                  <Input
                    id="trip-title"
                    value={values.title}
                    onChange={(event) => updateFields({ title: event.target.value }, ["title"])}
                    placeholder="例如「京都七日：寺院、咖啡与雨」"
                    autoComplete="off"
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                  />
                )}
              </FormRow>

              <FormRow
                id="trip-summary"
                label="简介"
                hint={`可选，会显示在旅行卡片与详情页顶部 · ${values.summary.length}/${TRIP_FORM_LIMITS.summary}`}
                error={errors.summary}
              >
                {({ describedBy, invalid }) => (
                  <Textarea
                    id="trip-summary"
                    value={values.summary}
                    onChange={(event) => updateFields({ summary: event.target.value }, ["summary"])}
                    placeholder="这段旅程是什么样子？写给同行的人，也写给未来的自己。"
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                  />
                )}
              </FormRow>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormRow id="trip-status" label="状态" error={errors.status}>
                  {({ describedBy, invalid }) => (
                    <Select
                      id="trip-status"
                      value={values.status}
                      onChange={(event) =>
                        updateFields({ status: event.target.value as TripStatus }, ["status"])
                      }
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                    >
                      {Object.entries(STATUS_LABELS).map(([status, label]) => (
                        <option key={status} value={status}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormRow>

                <FormRow id="trip-visibility" label="可见性" error={errors.visibility}>
                  {({ describedBy, invalid }) => (
                    <Select
                      id="trip-visibility"
                      value={values.visibility}
                      onChange={(event) =>
                        updateFields(
                          { visibility: event.target.value as TripVisibility },
                          ["visibility", "accessGrants"],
                        )
                      }
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                    >
                      {Object.entries(VISIBILITY_LABELS).map(([visibility, label]) => (
                        <option key={visibility} value={visibility}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormRow>
              </div>

              {values.visibility === "custom" ? (
                <AccessGrantsField
                  editor={grantEditor}
                  disabled={pending || accessGrantRetrying}
                  error={errors.accessGrants}
                />
              ) : null}
            </section>

            <section className="space-y-5" data-testid="trip-cover-field">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">02 / 封面</h2>
                <span className="type-meta text-stone">可选 · 上传封面</span>
              </div>

              {coverError ? (
                <p role="alert" className="text-sm leading-6 text-accent-red">
                  {coverError}
                </p>
              ) : null}

              <CoverUploader
                workspaceId={workspaceId}
                trip={props.mode === "edit" ? tripState : null}
                onChange={handleCoverChange}
                onError={handleCoverError}
                onTransition={(transition) => setCoverPhase(transition.phase)}
                disabled={pending}
                size="cover"
              />

              <p className="type-meta leading-5 text-stone">
                支持 JPEG、PNG、WebP、AVIF、HEIC、HEIF，最大 25 MB。
                {isCreate
                  ? "新建时先完成上传，创建请求会带上 coverMediaId；上传失败可重试且不会丢失已上传的媒体。"
                  : "已有旅行会立即保存封面；替换或移除封面不会改动其它字段。"}
              </p>
            </section>

            <section className="space-y-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">03 / 日期</h2>
                <span className="type-meta text-stone">
                  {durationLabel ?? "返回日期需不早于出发日期"}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormRow id="trip-start-date" label="出发日期" required error={errors.startDate}>
                  {({ describedBy, invalid }) => (
                    <DatePicker
                      id="trip-start-date"
                      value={values.startDate}
                      onChange={(value) => handleDateChange("startDate", value)}
                      disabled={pending}
                      invalid={invalid}
                      describedBy={describedBy}
                      gridLabel="选择出发日期"
                    />
                  )}
                </FormRow>

                <FormRow id="trip-end-date" label="返回日期" required error={errors.endDate}>
                  {({ describedBy, invalid }) => (
                    <DatePicker
                      id="trip-end-date"
                      value={values.endDate}
                      onChange={(value) => handleDateChange("endDate", value)}
                      disabled={pending}
                      invalid={invalid}
                      describedBy={describedBy}
                      gridLabel="选择返回日期"
                    />
                  )}
                </FormRow>
              </div>

              <p className="type-meta text-stone">
                {durationLabel
                  ? `${formatDateRangeLabel(values.startDate, values.endDate)} · ${durationLabel}（含首尾两天）`
                  : "请选择有效的出发与返回日期，时长按含首尾两天计算。"}
              </p>
            </section>

            <section className="space-y-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">04 / 路线</h2>
                <span className="type-meta text-stone">
                  {values.destinations.length}/{TRIP_FORM_LIMITS.destinationCount} 个目的地
                </span>
              </div>

              <OriginField
                id="trip-origin"
                origin={values.origin}
                query={values.originQuery}
                onQueryChange={handleOriginQueryChange}
                onSelect={handleOriginSelect}
                onManual={handleOriginManual}
                onClear={handleOriginClear}
                search={search}
                disabled={pending}
                error={errors.origin}
              />

              <DestinationsField
                comboboxId="trip-destination-search"
                manualInputId="trip-destination-manual"
                destinations={values.destinations}
                resolvePlace={(optionId) => placeIndex.current.get(optionId)}
                onAddPlace={handleAddPlaceDestination}
                onAddManual={handleAddManualDestination}
                onReplacePlace={handleReplaceWithPlace}
                onReplaceManual={handleReplaceWithManual}
                onRemove={handleRemoveDestination}
                onMove={handleMoveDestination}
                search={search}
                disabled={pending}
                error={errors.destinations}
              />
            </section>

            <section className="space-y-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">05 / 预算</h2>
                <span className="type-meta text-stone">
                  {budgetPreview ?? "可留空，表示不设置预算"}
                </span>
              </div>

              <BudgetField
                amountId="trip-budget-amount"
                currencyId="trip-budget-currency"
                amount={values.budgetAmount}
                currency={values.budgetCurrency}
                onAmountChange={(value) => updateFields({ budgetAmount: value }, ["budgetAmount"])}
                onCurrencyChange={(value) =>
                  updateFields({ budgetCurrency: value }, ["budgetCurrency"])
                }
                amountError={errors.budgetAmount}
                currencyError={errors.budgetCurrency}
                disabled={pending}
              />
            </section>

            <section className="space-y-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                <h2 className="type-eyebrow">06 / 标记与同行人</h2>
                <span className="type-meta text-stone">可选</span>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <ChipsInput
                  id="trip-tags"
                  label="标签"
                  values={values.tags}
                  onChange={(tags) => updateFields({ tags }, ["tags"])}
                  placeholder="输入标签后回车"
                  hint="用于筛选与检索，不区分大小写去重。"
                  error={errors.tags}
                  disabled={pending}
                  maxItems={TRIP_FORM_LIMITS.tagCount}
                  maxLength={TRIP_FORM_LIMITS.tagLength}
                  itemNoun="标签"
                />

                <ChipsInput
                  id="trip-guests"
                  label="同行人"
                  values={values.guestNames}
                  onChange={(guestNames) => updateFields({ guestNames }, ["guestNames"])}
                  placeholder="输入姓名后回车"
                  hint="只记录姓名，本轮不会发送邀请或通知。"
                  error={errors.guestNames}
                  disabled={pending}
                  maxItems={TRIP_FORM_LIMITS.guestCount}
                  maxLength={TRIP_FORM_LIMITS.guestLength}
                  itemNoun="同行人"
                />
              </div>
            </section>

            {isCreate ? null : (
              <section className="space-y-5">
                <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
                  <h2 className="type-eyebrow">07 / 隐私</h2>
                  <span className="type-meta text-stone">影响公开分享页</span>
                </div>

                <ExactPhotoLocationField
                  checked={values.showExactPhotoLocation}
                  disabled={pending}
                  onChange={(next) => updateFields({ showExactPhotoLocation: next })}
                />
              </section>
            )}
          </fieldset>

          <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-card border border-hairline bg-surface-1/70 p-5">
              <p className="type-eyebrow">路线预览</p>
              <h2 className="type-trip-title mt-3 break-words text-balance">
                {titleValue || "未命名旅行"}
              </h2>
              <p className="type-meta mt-3">
                {values.startDate && values.endDate
                  ? formatDateRangeLabel(values.startDate, values.endDate)
                  : "日期待定"}
              </p>

              <dl className="mt-5 space-y-3 border-t border-hairline pt-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">状态</dt>
                  <dd>
                    <Badge tone={getTripStatusTone(values.status)}>
                      {getTripStatusLabel(values.status)}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">时长</dt>
                  <dd className="type-meta tabular-nums">{durationLabel ?? "—"}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="shrink-0 text-muted">起点</dt>
                  <dd className="min-w-0 truncate text-right text-sm">
                    {originName || "未填写"}
                    {values.origin?.timeZone ? (
                      <span className="ml-2 type-meta">{values.origin.timeZone}</span>
                    ) : null}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">目的地</dt>
                  <dd className="type-meta tabular-nums">{values.destinations.length} 个</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">预算</dt>
                  <dd className="type-meta tabular-nums">
                    {budgetPreview ??
                      (values.budgetAmount.trim() || values.budgetCurrency.trim()
                        ? "填写不完整"
                        : "未设置")}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-hairline pt-4">
                <p className="type-eyebrow">顺序</p>
                {values.destinations.length === 0 ? (
                  <p className="mt-2 text-xs leading-5 text-muted">
                    添加目的地后，会按上方顺序显示在这里。
                  </p>
                ) : (
                  <ol className="mt-2 space-y-1.5">
                    {values.destinations.slice(0, 6).map((destination, index) => (
                      <li
                        key={`${destination.name}-${index}`}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <span className="type-meta w-4 shrink-0 tabular-nums text-stone">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-body">{destination.name}</span>
                        {destination.countryCode ? (
                          <span className="type-meta">{destination.countryCode}</span>
                        ) : null}
                      </li>
                    ))}
                    {values.destinations.length > 6 ? (
                      <li className="type-meta pl-6 text-stone">
                        还有 {values.destinations.length - 6} 个目的地
                      </li>
                    ) : null}
                  </ol>
                )}
              </div>
            </div>

            <p className="mt-3 type-meta leading-5 text-stone">
              日期、坐标、时区与金额会一并保存；手动填写的地点不附带坐标。
            </p>
          </aside>
        </div>

        <div className="sticky bottom-0 z-10 mt-10 -mx-4 border-t border-hairline bg-canvas/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="type-meta text-stone" role="status">
              {pending
                ? "正在保存…"
                : accessGrantRetrying
                  ? "行程已保存，正在等待重试可见范围…"
                  : coverBusy
                    ? "封面上传/处理中，完成后即可保存…"
                    : props.mode === "edit"
                      ? "仅保存本次修改"
                      : `保存后跳转到旅行详情 · 标题上限 ${TRIP_FORM_LIMITS.title} 字`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link
                href={cancelHref}
                className={buttonVariants({ variant: "ghost" })}
                aria-disabled={pending || undefined}
                tabIndex={pending ? -1 : undefined}
              >
                取消
              </Link>
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
                {pending ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    保存中…
                  </>
                ) : (
                  (submitLabel ?? defaultSubmitLabel)
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
