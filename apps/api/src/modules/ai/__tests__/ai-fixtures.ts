import { vi } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { AiProtocolAdapter, AiStepInput, AiStepResult } from "../adapters/adapter.js";
import type { AiSettings } from "../ai.settings.js";
import type { AiPlaceCandidate } from "../ai-tools.js";

export const TRIP_ID = "01942f30-1200-7000-8000-000000000201";
export const STOP_ID = "01942f30-1200-7000-8000-000000000202";
export const ITEM_ID = "01942f30-1200-7000-8000-000000000203";
export const PACKING_ID = "01942f30-1200-7000-8000-000000000204";

export const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
export const USER_ID = "01942f30-1200-7000-8000-000000000002";

export function aiSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  const settings: AiSettings = {
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:3425/v1",
    apiKey: null,
    model: "auto/deepseek-v4.1-flash",
    allowedModels: ["auto/deepseek-v4.1-flash"],
    timeoutMs: 60_000,
    maxOutputTokens: 6_000,
    dailyQuota: 20,
    configured: true,
    ...overrides,
  };
  // Keep the allow-list consistent with an overridden model unless the test says
  // otherwise: the default model is always selectable (`parseAllowedModels`).
  return {
    ...settings,
    allowedModels: overrides.allowedModels ?? [settings.model],
  };
}

/** Frozen "now" for the planner tests: 2026-11-19 in Asia/Shanghai. */
export const FIXED_NOW_ISO = "2026-11-19T03:00:00.000Z";

export function fixedClock(iso: string = FIXED_NOW_ISO): () => Date {
  const value = new Date(iso);
  return () => value;
}

export const KINKAKUJI: AiPlaceCandidate = {
  providerPlaceId: "N:1234",
  provider: "photon",
  name: "Kinkaku-ji",
  country: "Japan",
  countryCode: "JP",
  lat: 35.0394,
  lng: 135.7292,
  timeZone: null,
  address: "金閣寺, 京都府, 日本",
  bbox: [135.72, 35.03, 135.74, 35.05],
};

/** A Geoapify search hit, the source that used to be unstorable on a stop. */
export const GEOAPIFY_KYOTO: AiPlaceCandidate = {
  providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
  provider: "geoapify",
  name: "京都市",
  country: "日本",
  countryCode: "JP",
  lat: 35.0115754,
  lng: 135.7681441,
  timeZone: "Asia/Tokyo",
  address: "京都市, 京都府, 日本",
  bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
};

export function placeSearchItems(candidate: AiPlaceCandidate = KINKAKUJI) {
  return [
    {
      provider: candidate.provider,
      providerPlaceId: candidate.providerPlaceId,
      name: candidate.name,
      address: candidate.address,
      country: candidate.country,
      countryCode: candidate.countryCode,
      lat: candidate.lat,
      lng: candidate.lng,
      timeZone: candidate.timeZone,
      bbox: candidate.bbox,
      importance: null,
      type: "attraction" as const,
    },
  ];
}

export function tripRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Kyoto",
    summary: "",
    status: "planning",
    startDate: "2026-12-01",
    endDate: "2026-12-07",
    origin: null,
    originLat: null,
    originLng: null,
    originCountryCode: null,
    timeZone: null,
    destinations: [],
    countryCodes: [],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "private",
    favorite: false,
    cover: null,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export interface ToolServiceMocks {
  places: { search: ReturnType<typeof vi.fn> };
  trips: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  stops: { create: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
  itinerary: { create: ReturnType<typeof vi.fn> };
  packing: { create: ReturnType<typeof vi.fn> };
}

export function toolServiceMocks(): ToolServiceMocks {
  return {
    places: { search: vi.fn().mockResolvedValue({ items: placeSearchItems() }) },
    trips: {
      create: vi.fn().mockResolvedValue(tripRecord({ id: TRIP_ID })),
      get: vi.fn().mockResolvedValue(tripRecord()),
      list: vi.fn().mockResolvedValue({
        items: [tripRecord()],
        nextCursor: null,
        hasMore: false,
      }),
      update: vi.fn().mockResolvedValue(tripRecord({ budgetAmountMinor: 800_000 })),
    },
    stops: {
      create: vi.fn().mockResolvedValue({
        id: STOP_ID,
        city: "Kinkaku-ji",
        startDate: "2026-12-01",
        endDate: "2026-12-02",
      }),
      list: vi.fn().mockResolvedValue([]),
    },
    itinerary: { create: vi.fn().mockResolvedValue({ id: ITEM_ID }) },
    packing: { create: vi.fn().mockResolvedValue({ id: PACKING_ID, name: "Rain jacket" }) },
  };
}

function hasQueuedConfirmation(messages: AiStepInput["messages"]): boolean {
  return messages.some(
    (message) =>
      message.role === "tool" &&
      message.results.some((result) => result.content.includes("queued_for_confirmation")),
  );
}

/**
 * The production prompt now always asks for a complete plan before the card.
 * Tests use short scripted turns for arrangement; this fixture supplies the
 * missing human-readable sections so the gate is exercised without pretending
 * the short turn was a complete plan.
 */
function detailedPlanText(base: string | null): string {
  return [
    "# 最终计划",
    base?.trim() ? base.trim() : "已按确认需求整理计划。",
    "## 约束与假设",
    "- 按已确认的日期、预算和偏好执行；未出现的信息不自行补造。",
    "## 逐日安排",
    "### 第 1 天（2026-12-01）",
    "- 09:00 清水寺，步行前往，上午避开人流。",
    "- 14:00 祇园咖啡，下午休息。",
    "## 交通与住宿",
    "- 市内以地铁和步行为主，住宿按商务酒店估算。",
    "## 预算",
    "- 总预算 8000 元，包含住宿、交通、餐饮和门票。",
    "## 风险与备选",
    "- 热门寺院可能需要排队；雨天改去博物馆。",
    "## 将写入的内容",
    "- 创建旅行、添加行程节点和逐日安排；确认前不会写入。",
  ].join("\n");
}

/** Scripted adapter: returns one turn per `step` call, then a plain final answer. */
export function scriptedAdapter(turns: AiStepResult[]): AiProtocolAdapter & {
  readonly inputs: AiStepInput[];
} {
  const inputs: AiStepInput[] = [];
  let index = 0;
  let lastText: string | null = null;
  return {
    protocol: "openai-chat" as const,
    inputs,
    async step(input: AiStepInput): Promise<AiStepResult> {
      inputs.push(input);
      const turn = turns[index];
      index += 1;
      const result = turn ?? { text: lastText ?? "Done.", toolCalls: [] };
      if (turn?.text) lastText = turn.text;
      return input.tools.length === 0 && hasQueuedConfirmation(input.messages)
        ? { ...result, text: detailedPlanText(result.text) }
        : result;
    },
  };
}

export function loggerStub(): Record<"log" | "warn" | "error" | "debug", ReturnType<typeof vi.fn>> {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

export function quotaStub(
  overrides: Record<string, unknown> = {},
): { consume: ReturnType<typeof vi.fn> } {
  return {
    consume: vi.fn().mockResolvedValue({
      allowed: true,
      limit: 20,
      remaining: 19,
      retryAfterSeconds: 3_600,
      ...overrides,
    }),
  };
}

export function runStoreStub(): {
  runs: Map<string, unknown>;
  save: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  isConsumed: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
  loadConsumed: ReturnType<typeof vi.fn>;
  boundAssistantMessage: ReturnType<typeof vi.fn>;
  bindAssistantMessage: ReturnType<typeof vi.fn>;
} {
  const runs = new Map<string, unknown>();
  return {
    runs,
    save: vi.fn(async (run: { runId: string }) => {
      runs.set(run.runId, run);
    }),
    load: vi.fn(),
    isConsumed: vi.fn().mockResolvedValue(false),
    consume: vi.fn(),
    loadConsumed: vi.fn(),
    boundAssistantMessage: vi.fn().mockResolvedValue(undefined),
    bindAssistantMessage: vi.fn().mockResolvedValue(undefined),
  };
}

export function actorStub(): AuthenticatedActor {
  return {
    user: { id: USER_ID, email: "planner@roamlog.local", name: "Planner" },
    ip: "127.0.0.1",
    userAgent: "vitest",
  } as unknown as AuthenticatedActor;
}

export function membershipStub(
  role: "viewer" | "editor" | "admin" | "owner" = "editor",
): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-000000000003",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role,
    status: "active",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    invitedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    workspaceName: "Studio",
  } as unknown as WorkspaceMembershipAccess;
}
