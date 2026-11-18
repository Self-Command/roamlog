/* global AbortSignal, Buffer, URL, URLSearchParams, console, fetch, process, setTimeout */

import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

class SeedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SeedError";
  }
}

class SeedApiError extends SeedError {
  constructor(input) {
    super(
      `${input.method} ${input.path} returned HTTP ${input.status} (${input.code}): ${input.detail}`,
    );
    this.name = "SeedApiError";
    this.method = input.method;
    this.path = input.path;
    this.status = input.status;
    this.code = input.code;
    this.detail = input.detail;
    this.requestId = input.requestId ?? null;
    this.retryAfter = input.retryAfter ?? null;
  }

  toDiagnostic() {
    return {
      kind: "api",
      method: this.method,
      path: this.path,
      status: this.status,
      code: this.code,
      detail: this.detail,
      requestId: this.requestId,
      retryAfter: this.retryAfter,
    };
  }
}

const TASK_ID = "DEMO-SEED-EXPAND";
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");

const apiOrigin = normalizeOrigin(process.env.SEED_API_ORIGIN ?? "https://we.spacedo.org");
const requestOrigin = normalizeOrigin(process.env.SEED_REQUEST_ORIGIN ?? apiOrigin);
const credentialsFile =
  process.env.SEED_ADMIN_CREDENTIALS ?? "/opt/roamlog/config/admin-credentials.json";
const summaryFile = process.env.SEED_SUMMARY_FILE ?? "/opt/roamlog/config/demo-seed-summary.json";
const mediaDirectory =
  process.env.SEED_MEDIA_DIR ?? resolve(REPOSITORY_ROOT, "packages/db/seed-assets");
const workspaceName = process.env.SEED_WORKSPACE_NAME ?? "Roamlog Demo";
const workspaceSlug = process.env.SEED_WORKSPACE_SLUG ?? "roamlog-demo";
const uploadMedia = environmentFlag("SEED_UPLOAD_MEDIA", true);
const requestTimeoutMs = environmentInteger("SEED_REQUEST_TIMEOUT_MS", 20_000, 1_000, 120_000);
const mediaReadyTimeoutMs = environmentInteger(
  "SEED_MEDIA_READY_TIMEOUT_MS",
  90_000,
  1_000,
  900_000,
);
const mediaPollIntervalMs = environmentInteger("SEED_MEDIA_POLL_INTERVAL_MS", 2_000, 250, 30_000);

const startedAt = new Date();
const summary = {
  taskId: TASK_ID,
  status: "running",
  apiOrigin,
  startedAt: startedAt.toISOString(),
  workspace: null,
  actor: null,
  counts: {
    members: 0,
    trips: 0,
    entries: 0,
    expenses: 0,
    packingItems: 0,
    photos: 0,
    albums: 0,
  },
  created: {
    workspace: false,
    trips: 0,
    entries: 0,
    expenses: 0,
    packingItems: 0,
    photos: 0,
  },
  reused: {
    trips: 0,
    entries: 0,
    expenses: 0,
    packingItems: 0,
    photos: 0,
  },
  trips: [],
  albums: [],
  createdItems: {
    trips: [],
    entries: [],
    expenses: [],
    packingItems: [],
    media: [],
  },
  warnings: [],
  errors: [],
};

const demoTrips = [
  {
    key: "seoul",
    title: "首尔一周",
    summary: "工作日的会议，和下班后的圣水洞。",
    status: "active",
    startDate: "2026-11-16",
    endDate: "2026-11-22",
    origin: "上海",
    destinations: ["首尔", "仁川"],
    countryCodes: ["KR"],
    tags: ["城市", "咖啡", "美食"],
    budgetAmountMinor: 1_200_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: true,
    entries: [
      {
        title: "首尔的第一杯手冲",
        date: "2026-11-16",
        location: "首尔 · 西村",
        lat: 37.5796,
        lng: 126.9707,
        mood: "calm",
        weather: "sunny",
        tags: ["抵达", "咖啡", "工作旅行"],
        favorite: false,
        paragraphs: [
          "会议临时改到线上，于是把上午挪到一家有院子的咖啡馆。店主在烘豆，整条巷子都是焦糖味。",
          "点了一杯水洗耶加，酸得干净。写完待办之后没有立刻走，晒了十分钟太阳。旅行和工作混在一起时，这种没有安排的缝隙最珍贵。",
        ],
      },
      {
        title: "汉江边的临时野餐",
        date: "2026-11-18",
        location: "首尔 · 汉江公园",
        lat: 37.5285,
        lng: 126.9342,
        mood: "happy",
        weather: "wind",
        tags: ["汉江", "野餐", "夜"],
        favorite: true,
        paragraphs: [
          "便利店买了紫菜包饭、橘子和两罐啤酒。风把一次性桌布吹起来三次，最后用背包压住四个角。",
          "天黑得很快，对岸的灯一盏一盏亮起来。有人在不远处弹吉他，跑调也没关系。我们聊到下一次旅行，结论是先不订返程。",
        ],
      },
      {
        title: "圣水洞的雨停得很晚",
        date: "2026-11-20",
        location: "首尔 · 圣水洞",
        lat: 37.5446,
        lng: 127.0559,
        mood: "reflective",
        weather: "rain",
        tags: ["圣水洞", "书店", "雨"],
        favorite: false,
        paragraphs: [
          "下午的会提前结束，从写字楼出来时雨刚停。地面还亮着，沿街的玻璃反光把整条路拉得很长。",
          "在独立书店翻完一本摄影集，最后只买了一张明信片。回公寓前绕到便利店，给明天早上的咖啡留了一盒牛奶。",
        ],
      },
    ],
    expenses: [
      {
        date: "2026-11-16",
        category: "stay",
        note: "西村公寓五晚",
        amountMinor: 420_000,
        currency: "KRW",
      },
      {
        date: "2026-11-17",
        category: "food",
        note: "广藏市场晚餐",
        amountMinor: 38_000,
        currency: "KRW",
      },
      {
        date: "2026-11-19",
        category: "transport",
        note: "首尔地铁七日卡",
        amountMinor: 20_000,
        currency: "KRW",
      },
    ],
    packing: [
      { category: "documents", name: "护照与入境材料", quantity: 1, packed: true },
      { category: "clothing", name: "轻薄通勤外套", quantity: 1, packed: true },
      { category: "gear", name: "降噪耳机", quantity: 1, packed: false },
      { category: "health", name: "常用肠胃药", quantity: 1, packed: false },
      { category: "other", name: "T-money 交通卡", quantity: 2, packed: true },
    ],
    photo: {
      asset: "seoul-night.jpg",
      caption: "汉江夜色，灯一盏一盏亮起来",
      date: "2026-11-18",
      location: "首尔 · 汉江公园",
    },
  },
  {
    key: "kyoto",
    title: "京都红叶慢行",
    summary: "把清晨留给寺院，把傍晚留给鸭川。",
    status: "upcoming",
    startDate: "2026-12-03",
    endDate: "2026-12-10",
    origin: "上海",
    destinations: ["京都", "奈良"],
    countryCodes: ["JP"],
    tags: ["红叶", "寺院", "步行"],
    budgetAmountMinor: 2_240_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: true,
    entries: [
      {
        title: "把清晨留给南禅寺",
        date: "2026-12-04",
        location: "京都 · 东山",
        lat: 35.011,
        lng: 135.7944,
        mood: "calm",
        weather: "cloudy",
        tags: ["计划", "南禅寺", "清晨"],
        favorite: true,
        paragraphs: [
          "出发前先把第一天写下来：六点半出门，趁旅行团到达之前走到水路阁。路线不排满，只留一个早餐备选。",
          "如果红叶已经落尽，就改去细见美术馆。真正想保住的是清晨的安静，而不是某一张照片。",
        ],
      },
      {
        title: "鸭川边的步行路线",
        date: "2026-12-06",
        location: "京都 · 鸭川",
        lat: 35.0116,
        lng: 135.7681,
        mood: "reflective",
        weather: "sunny",
        tags: ["鸭川", "步行", "傍晚"],
        favorite: false,
        paragraphs: [
          "从出町柳慢慢往南走，不设终点。沿途只记三件事：买一杯热饮，在桥边坐十分钟，天黑前找一家不用排队的店。",
          "把这条路线留给抵达后的自己。天气好就走到四条，风大就提前拐进商店街。",
        ],
      },
      {
        title: "奈良只安排半天",
        date: "2026-12-08",
        location: "奈良 · 奈良公园",
        lat: 34.6851,
        lng: 135.8048,
        mood: "excited",
        weather: "cloudy",
        tags: ["奈良", "半日", "公园"],
        favorite: false,
        paragraphs: [
          "这次不赶东大寺和春日大社的完整路线，只在公园和附近老街停留。中午前回京都，把下午留给收拾和休息。",
          "行程里故意留出的空白，往往才是回来以后记得最久的部分。",
        ],
      },
    ],
    expenses: [
      {
        date: "2026-12-03",
        category: "transport",
        note: "关西机场到京都 HARUKA 指定席",
        amountMinor: 5_480,
        currency: "JPY",
      },
      {
        date: "2026-12-04",
        category: "stay",
        note: "东山町家四晚",
        amountMinor: 146_000,
        currency: "JPY",
      },
      {
        date: "2026-12-07",
        category: "food",
        note: "祇园怀石晚餐",
        amountMinor: 72_300,
        currency: "JPY",
      },
    ],
    packing: [
      { category: "documents", name: "护照与酒店确认单", quantity: 1, packed: false },
      { category: "clothing", name: "保暖内层", quantity: 2, packed: false },
      { category: "gear", name: "相机备用电池", quantity: 2, packed: true },
      { category: "health", name: "护膝", quantity: 1, packed: false },
      { category: "other", name: "茶室用无香袜子", quantity: 1, packed: false },
    ],
    photo: {
      asset: "kyoto-alley.jpg",
      caption: "京都小巷，雨后的木格窗",
      date: "2026-12-05",
      location: "京都 · 祇园",
    },
  },
  {
    key: "amalfi",
    title: "阿马尔菲海岸",
    summary: "从索伦托出发，沿着海岸线慢慢向南。",
    status: "planning",
    startDate: "2027-05-18",
    endDate: "2027-05-25",
    origin: "上海",
    destinations: ["索伦托", "波西塔诺", "拉韦洛"],
    countryCodes: ["IT"],
    tags: ["海岸", "徒步", "美食"],
    budgetAmountMinor: 3_600_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    entries: [
      {
        title: "从索伦托开始",
        date: "2027-05-18",
        location: "索伦托",
        lat: 40.6263,
        lng: 14.3758,
        mood: "calm",
        weather: "cloudy",
        tags: ["索伦托", "抵达", "柠檬"],
        favorite: false,
        paragraphs: [
          "火车到那不勒斯已经很晚，转私铁到索伦托时正好赶上最后一班渡轮进港。旅馆在悬崖边，房间有个很小的阳台。",
          "第一晚不做攻略，只买柠檬和面包，坐在阳台上听楼下餐厅收桌子的声音。",
        ],
      },
      {
        title: "众神之路的天气窗口",
        date: "2027-05-21",
        location: "阿杰罗拉到波西塔诺",
        lat: 40.634,
        lng: 14.491,
        mood: "excited",
        weather: "sunny",
        tags: ["徒步", "众神之路", "海岸"],
        favorite: true,
        paragraphs: [
          "把徒步放在旅程中段，前后各留一天缓冲。早上先看风力和云量，如果山脊起雾就改走低一点的海岸路线。",
          "水带两升，午餐只带面包和水果。到波西塔诺之后不赶车，找一家能看见海的店慢慢吃饭。",
        ],
      },
      {
        title: "波西塔诺的最后一晚",
        date: "2027-05-24",
        location: "波西塔诺",
        lat: 40.628,
        lng: 14.4849,
        mood: "reflective",
        weather: "sunny",
        tags: ["波西塔诺", "晚餐", "回程"],
        favorite: false,
        paragraphs: [
          "最后一晚不安排景点，只订一张靠窗的桌子。回酒店前沿着海边走到栈桥尽头，再看一次黑下来的海面。",
          "行李在下午就收好，把第二天去那不勒斯的车票放进外套口袋。旅行结束前的空白，也值得被认真安排。",
        ],
      },
    ],
    expenses: [
      {
        date: "2027-05-18",
        category: "transport",
        note: "那不勒斯机场到索伦托接送",
        amountMinor: 8_500,
        currency: "EUR",
      },
      {
        date: "2027-05-19",
        category: "stay",
        note: "索伦托海景房四晚",
        amountMinor: 68_000,
        currency: "EUR",
      },
      {
        date: "2027-05-23",
        category: "activity",
        note: "众神之路当地向导",
        amountMinor: 24_000,
        currency: "EUR",
      },
    ],
    packing: [
      { category: "documents", name: "申根保险与证件复印件", quantity: 1, packed: false },
      { category: "clothing", name: "防滑徒步鞋", quantity: 1, packed: false },
      { category: "gear", name: "防晒与宽檐帽", quantity: 1, packed: true },
      { category: "health", name: "晕船药", quantity: 1, packed: false },
      { category: "other", name: "渡轮船票确认单", quantity: 1, packed: false },
    ],
    photo: {
      asset: "amalfi-cliff.jpg",
      caption: "阿马尔菲悬崖公路，午后海面",
      date: "2027-05-20",
      location: "阿马尔菲海岸",
    },
  },
];

class ApiClient {
  constructor(origin) {
    this.origin = origin;
    this.cookie = null;
  }

  setCookie(cookie) {
    this.cookie = cookie;
  }

  async request(path, options = {}) {
    const method = (options.method ?? "GET").toUpperCase();
    const expected = options.expected ?? [200];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = {
      Accept: "application/json",
      Origin: requestOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.headers ?? {}),
    };

    let response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      throw new SeedError(
        `${method} ${path} could not reach the API: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }

    if (!expected.includes(response.status)) {
      throw new SeedApiError({
        method,
        path,
        status: response.status,
        code: responseCode(json, response.status),
        detail: responseDetail(json, response.status),
        requestId: response.headers.get("x-request-id"),
        retryAfter: response.headers.get("retry-after"),
      });
    }

    return { status: response.status, json, headers: response.headers };
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("unsupported URL");
    }
    return url.origin;
  } catch {
    throw new SeedError("SEED_API_ORIGIN must be a valid HTTP(S) URL without credentials.");
  }
}

function environmentFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function environmentInteger(name, fallback, minimum, maximum) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SeedError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function responseCode(json, status) {
  const candidates = [
    json?.code,
    json?.error?.code,
    status === 401 ? "UNAUTHENTICATED" : undefined,
    status === 403 ? "FORBIDDEN" : undefined,
    status === 404 ? "NOT_FOUND" : undefined,
    status === 409 ? "CONFLICT" : undefined,
    status === 429 ? "RATE_LIMITED" : undefined,
  ];
  return candidates.find((value) => typeof value === "string" && value.length > 0) ?? "HTTP_ERROR";
}

function responseDetail(json, status) {
  const candidates = [json?.detail, json?.message, json?.error?.message];
  const detail = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  if (detail) return bounded(detail, 1_000);
  return status >= 500 ? "The API returned an internal error." : "The request was rejected.";
}

function bounded(value, maximum) {
  const text = String(value).trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replaceAll("=", "").replaceAll(" ", "").toUpperCase();
  const bytes = [];
  let bits = 0;
  let buffer = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new SeedError("The credentials TOTP secret is not valid base32.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  if (bytes.length === 0) throw new SeedError("The credentials TOTP secret is empty.");
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest.at(-1) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function cookiesFrom(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  return values
    .flatMap((value) => String(value).split(/,(?=[^;]+?=)/))
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...headers) {
  const cookies = new Map();
  for (const header of headers) {
    for (const part of String(header ?? "").split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  }
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function loadCredentials() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(credentialsFile, "utf8"));
  } catch (error) {
    throw new SeedError(
      `Admin credentials could not be read from ${credentialsFile}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (
    typeof parsed?.email !== "string" ||
    parsed.email.length === 0 ||
    typeof parsed?.password !== "string" ||
    parsed.password.length === 0
  ) {
    throw new SeedError("Admin credentials must include non-empty email and password fields.");
  }
  return parsed;
}

async function authenticate(api, credentials) {
  const signIn = await api.request("/v1/auth/sign-in/email", {
    method: "POST",
    expected: [200],
    body: {
      email: credentials.email,
      password: credentials.password,
      rememberMe: true,
    },
  });

  let cookie = cookiesFrom(signIn.headers);
  if (signIn.json?.twoFactorRedirect === true) {
    if (typeof credentials.totpSecret !== "string" || credentials.totpSecret.length === 0) {
      throw new SeedError("Admin 2FA is enabled, but the credentials file has no TOTP secret.");
    }
    const verification = await api.request("/v1/auth/two-factor/verify-totp", {
      method: "POST",
      expected: [200],
      headers: cookie ? { Cookie: cookie } : {},
      body: { code: currentTotp(credentials.totpSecret) },
    });
    cookie = mergeCookieHeaders(cookie, cookiesFrom(verification.headers));
  }

  if (!cookie) throw new SeedError("Sign-in succeeded without returning a session cookie.");
  api.setCookie(cookie);

  const me = await api.request("/v1/me", { expected: [200] });
  if (typeof me.json?.id !== "string") {
    throw new SeedError("The authenticated user response did not include an id.");
  }
  return me.json;
}

async function listAll(api, path, query = {}) {
  const items = [];
  let cursor = null;
  let page = 0;

  do {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        parameters.set(key, String(value));
      }
    }
    parameters.set("limit", "100");
    if (cursor) parameters.set("cursor", cursor);

    const result = await api.request(`${path}?${parameters.toString()}`, { expected: [200] });
    if (!Array.isArray(result.json?.items)) {
      throw new SeedError(`Paged response from ${path} did not contain an items array.`);
    }
    items.push(...result.json.items);
    cursor = result.json.nextCursor ?? null;
    page += 1;

    if (result.json.hasMore === true && !cursor) {
      throw new SeedError(`Paged response from ${path} reported more data without a cursor.`);
    }
    if (page > 50) throw new SeedError(`Pagination from ${path} exceeded the safety limit.`);
  } while (cursor);

  return items;
}

async function ensureWorkspace(api) {
  const workspaces = await api.request("/v1/workspaces", { expected: [200] });
  if (!Array.isArray(workspaces.json)) {
    throw new SeedError("Workspace list response was not an array.");
  }

  const existing = workspaces.json.find((workspace) => workspace.slug === workspaceSlug);
  if (existing) {
    if (!["owner", "admin", "editor"].includes(existing.role)) {
      throw new SeedError(
        `Workspace ${workspaceSlug} is visible, but its role (${existing.role}) cannot seed content.`,
      );
    }
    return { workspace: existing, created: false };
  }

  const created = await api.request("/v1/workspaces", {
    method: "POST",
    expected: [201],
    body: {
      name: workspaceName,
      slug: workspaceSlug,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
      weekStartsOn: 1,
    },
  });
  if (typeof created.json?.id !== "string") {
    throw new SeedError("Workspace creation response did not include an id.");
  }
  return { workspace: { ...created.json, role: "owner" }, created: true };
}

async function loadWorkspaceMembers(api, workspaceId, actor) {
  const members = await listAll(api, `/v1/workspaces/${workspaceId}/members`, {
    status: "active",
    sort: "joinedAt:asc",
  });
  const users = members
    .filter((member) => member?.status === "active" && typeof member?.user?.id === "string")
    .map((member) => member.user);

  const ordered = [actor, ...users].filter(
    (user, index, values) =>
      typeof user?.id === "string" &&
      values.findIndex((candidate) => candidate?.id === user.id) === index,
  );
  return ordered.slice(0, 3);
}

async function resolveTrips(api, workspaceId) {
  const existingTrips = await listAll(api, `/v1/workspaces/${workspaceId}/trips`, {
    sort: "updatedAt:desc",
  });
  const byTitle = new Map();
  for (const trip of existingTrips) {
    const matches = byTitle.get(trip.title) ?? [];
    matches.push(trip);
    byTitle.set(trip.title, matches);
  }

  const states = [];
  for (const definition of demoTrips) {
    const matches = byTitle.get(definition.title) ?? [];
    if (matches.length > 1) {
      summary.warnings.push({
        stage: "trips",
        message: `Multiple trips share the title "${definition.title}"; using the most recently updated.`,
      });
    }

    let trip = matches[0];
    let created = false;
    if (!trip) {
      const result = await api.request(`/v1/workspaces/${workspaceId}/trips`, {
        method: "POST",
        expected: [201],
        body: {
          title: definition.title,
          summary: definition.summary,
          status: definition.status,
          startDate: definition.startDate,
          endDate: definition.endDate,
          origin: definition.origin,
          destinations: definition.destinations,
          countryCodes: definition.countryCodes,
          tags: definition.tags,
          budgetAmountMinor: definition.budgetAmountMinor,
          budgetCurrency: definition.budgetCurrency,
          visibility: definition.visibility,
          favorite: definition.favorite,
        },
      });
      trip = result.json;
      created = true;
      summary.created.trips += 1;
      summary.createdItems.trips.push({ id: trip.id, title: trip.title });
      log("trips", `created "${trip.title}"`);
    } else {
      summary.reused.trips += 1;
      log("trips", `reused "${trip.title}"`);
    }

    const state = {
      definition,
      trip,
      created,
      participants: [],
      counts: {
        entries: 0,
        expenses: 0,
        packingItems: 0,
        photos: 0,
      },
      album: null,
    };
    states.push(state);
    summary.counts.trips += 1;
    summary.trips.push({
      key: definition.key,
      id: trip.id,
      title: trip.title,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      created,
      counts: state.counts,
      album: null,
    });
  }

  return states;
}

async function ensureTripParticipants(api, states, members) {
  for (const state of states) {
    const participants = await api.request(`/v1/trips/${state.trip.id}/participants`, {
      expected: [200],
    });
    if (!Array.isArray(participants.json)) {
      throw new SeedError(`Participant response for "${state.trip.title}" was not an array.`);
    }

    const participantIds = new Set(
      participants.json
        .map((participant) => participant?.userId)
        .filter((userId) => typeof userId === "string"),
    );

    for (const member of members) {
      if (participantIds.has(member.id)) continue;
      try {
        await api.request(`/v1/trips/${state.trip.id}/participants`, {
          method: "POST",
          expected: [201],
          body: { userId: member.id },
        });
        participantIds.add(member.id);
      } catch (error) {
        if (error instanceof SeedApiError && error.status === 409) {
          participantIds.add(member.id);
          continue;
        }
        throw error;
      }
    }

    state.participants = members.filter((member) => participantIds.has(member.id));
    if (state.participants.length === 0) {
      throw new SeedError(`Trip "${state.trip.title}" has no participants for expense seeding.`);
    }
  }
}

async function seedEntries(api, states) {
  for (const state of states) {
    const existing = await listAll(api, `/v1/trips/${state.trip.id}/entries`, {
      sort: "date:asc",
    });
    const byKey = indexBy(existing, (entry) => `${entry.date}\u0000${entry.title}`);

    for (const entry of state.definition.entries) {
      const key = `${entry.date}\u0000${entry.title}`;
      const matches = byKey.get(key) ?? [];
      if (matches.length > 0) {
        if (matches.length > 1) {
          summary.warnings.push({
            stage: "entries",
            message: `Multiple journal entries matched "${entry.title}" on ${entry.date}; using the first.`,
          });
        }
        summary.reused.entries += 1;
        state.counts.entries += 1;
        continue;
      }

      const result = await api.request(`/v1/trips/${state.trip.id}/entries`, {
        method: "POST",
        expected: [201],
        body: {
          title: entry.title,
          date: entry.date,
          location: entry.location,
          lat: entry.lat,
          lng: entry.lng,
          mood: entry.mood,
          weather: entry.weather,
          contentJson: tiptapDocument(entry.paragraphs),
          contentHtml: tiptapHtml(entry.paragraphs),
          excerpt: entry.paragraphs.join(" ").slice(0, 600),
          tags: entry.tags,
          favorite: entry.favorite,
        },
      });

      summary.created.entries += 1;
      state.counts.entries += 1;
      summary.createdItems.entries.push({
        id: result.json.id,
        tripId: state.trip.id,
        title: result.json.title,
        date: result.json.date,
      });
      log("entries", `created "${result.json.title}" in "${state.trip.title}"`);
    }
  }
}

async function seedExpenses(api, states) {
  for (const state of states) {
    const existing = await listAll(api, `/v1/trips/${state.trip.id}/expenses`, {
      sort: "date:asc",
    });
    const bySignature = indexBy(existing, expenseSignature);

    for (const [index, expense] of state.definition.expenses.entries()) {
      const signature = expenseSignature(expense);
      if ((bySignature.get(signature) ?? []).length > 0) {
        summary.reused.expenses += 1;
        state.counts.expenses += 1;
        continue;
      }

      const payer = state.participants[index % state.participants.length];
      const result = await api.request(`/v1/trips/${state.trip.id}/expenses`, {
        method: "POST",
        expected: [201],
        body: {
          date: expense.date,
          category: expense.category,
          note: expense.note,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
          paidById: payer.id,
          splitMode: "equal",
          participants: state.participants.map((participant) => ({ userId: participant.id })),
        },
      });

      summary.created.expenses += 1;
      state.counts.expenses += 1;
      summary.createdItems.expenses.push({
        id: result.json.id,
        tripId: state.trip.id,
        note: result.json.note,
        amountMinor: result.json.amountMinor,
        currency: result.json.currency,
      });
      log("expenses", `created "${result.json.note}" in "${state.trip.title}"`);
    }
  }
}

async function seedPacking(api, states) {
  for (const state of states) {
    const existing = await listAll(api, `/v1/trips/${state.trip.id}/packing`, {
      sort: "order:asc",
    });
    const byKey = indexBy(existing, (item) => `${item.category}\u0000${item.name}`);

    for (const [index, item] of state.definition.packing.entries()) {
      const key = `${item.category}\u0000${item.name}`;
      const matches = byKey.get(key) ?? [];
      if (matches.length > 0) {
        summary.reused.packingItems += 1;
        state.counts.packingItems += 1;
        if (item.packed && matches[0].packed !== true) {
          const updated = await api.request(`/v1/packing/${matches[0].id}`, {
            method: "PATCH",
            expected: [200],
            body: { version: matches[0].version, packed: true },
          });
          matches[0] = updated.json;
        }
        continue;
      }

      const assignee = state.participants[index % state.participants.length];
      const created = await api.request(`/v1/trips/${state.trip.id}/packing`, {
        method: "POST",
        expected: [201],
        body: {
          category: item.category,
          name: item.name,
          quantity: item.quantity,
          assigneeId: assignee.id,
        },
      });

      summary.created.packingItems += 1;
      state.counts.packingItems += 1;
      summary.createdItems.packingItems.push({
        id: created.json.id,
        tripId: state.trip.id,
        category: created.json.category,
        name: created.json.name,
      });

      if (item.packed) {
        await api.request(`/v1/packing/${created.json.id}`, {
          method: "PATCH",
          expected: [200],
          body: { version: created.json.version, packed: true },
        });
      }
      log("packing", `created "${created.json.name}" in "${state.trip.title}"`);
    }
  }
}

async function seedPhotos(api, states) {
  if (!uploadMedia) {
    summary.warnings.push({
      stage: "media",
      message: "Photo seeding was skipped because SEED_UPLOAD_MEDIA is disabled.",
    });
    return;
  }

  for (const state of states) {
    const definition = state.definition.photo;
    const existing = await listAll(api, `/v1/trips/${state.trip.id}/media`, {
      sort: "createdAt:desc",
    });
    let media = existing.find((item) => item.caption === definition.caption);

    if (media && ["pending", "failed"].includes(media.status)) {
      summary.warnings.push({
        stage: "media",
        message: `Reset unfinished media "${definition.caption}" before recreating it.`,
      });
      await api.request(`/v1/media/${media.id}`, {
        method: "DELETE",
        expected: [200],
      });
      media = undefined;
    }

    if (media) {
      if (media.status !== "ready") {
        media = await waitForMediaReady(api, state.trip.id, media.id);
      }
      summary.reused.photos += 1;
    } else {
      const assetPath = resolve(mediaDirectory, definition.asset);
      let bytes;
      try {
        bytes = readFileSync(assetPath);
      } catch (error) {
        throw new SeedError(`Seed image could not be read: ${assetPath}`, { cause: error });
      }

      const presign = await api.request(`/v1/workspaces/${state.trip.workspaceId}/media/presign`, {
        method: "POST",
        expected: [201],
        body: {
          tripId: state.trip.id,
          fileName: definition.asset,
          mimeType: "image/jpeg",
          size: bytes.length,
          caption: definition.caption,
          date: definition.date,
          location: definition.location,
        },
      });

      await uploadBinary(presign.json, bytes);
      const completionKey = `demo-media-${createHash("sha256")
        .update(`${state.trip.id}\u0000${definition.caption}`)
        .digest("hex")
        .slice(0, 32)}`;
      const completed = await api.request(`/v1/media/${presign.json.mediaId}/complete`, {
        method: "POST",
        expected: [200],
        idempotencyKey: completionKey,
        body: {},
      });
      media = await waitForMediaReady(api, state.trip.id, completed.json.id);

      summary.created.photos += 1;
      summary.createdItems.media.push({
        id: media.id,
        tripId: state.trip.id,
        caption: media.caption,
        asset: definition.asset,
      });
      log("media", `uploaded "${definition.caption}" for "${state.trip.title}"`);
    }

    state.counts.photos += 1;
    if (!state.trip.coverMediaId && media.status === "ready") {
      const updated = await api.request(`/v1/trips/${state.trip.id}/cover`, {
        method: "POST",
        expected: [200],
        body: { mediaId: media.id },
      });
      state.trip = { ...state.trip, ...updated.json };
    }

    state.album = {
      kind: "trip_media_gallery",
      title: `${state.trip.title} · 旅行相册`,
      tripId: state.trip.id,
      photoCount: 1,
      readyPhotoCount: media.status === "ready" ? 1 : 0,
      mediaIds: [media.id],
    };
    const tripSummary = summary.trips.find((trip) => trip.id === state.trip.id);
    if (tripSummary) tripSummary.album = state.album;
  }

  summary.albums = states.filter((state) => state.album).map((state) => state.album);
  summary.counts.albums = summary.albums.length;
  summary.counts.photos = states.reduce((total, state) => total + state.counts.photos, 0);
}

async function uploadBinary(presign, bytes) {
  const headers = Object.fromEntries(
    Object.entries(presign?.headers ?? {}).filter(
      ([name, value]) => typeof name === "string" && typeof value === "string",
    ),
  );

  let response;
  try {
    response = await fetch(presign.uploadUrl, {
      method: presign.method,
      headers,
      body: bytes,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new SeedError(
      `Media upload could not reach object storage: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const storageCode = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
    throw new SeedError(
      `Media upload failed with HTTP ${response.status}${storageCode ? ` (${storageCode})` : ""}.`,
    );
  }
}

async function waitForMediaReady(api, tripId, mediaId) {
  const deadline = Date.now() + mediaReadyTimeoutMs;

  while (true) {
    const media = (
      await listAll(api, `/v1/trips/${tripId}/media`, {
        sort: "createdAt:desc",
      })
    ).find((item) => item.id === mediaId);

    if (!media) throw new SeedError(`Media ${mediaId} was not found after upload.`);
    if (media.status === "ready") return media;
    if (media.status === "failed") {
      throw new SeedError(
        `Media ${mediaId} failed processing${media.error ? `: ${bounded(media.error, 500)}` : "."}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new SeedError(
        `Media ${mediaId} remained ${media.status} after ${mediaReadyTimeoutMs}ms.`,
      );
    }
    await sleep(mediaPollIntervalMs);
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function indexBy(items, keyFunction) {
  const index = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    const matches = index.get(key) ?? [];
    matches.push(item);
    index.set(key, matches);
  }
  return index;
}

function expenseSignature(expense) {
  return [expense.date, expense.category, expense.amountMinor, expense.currency, expense.note].join(
    "\u0000",
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tiptapDocument(paragraphs) {
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    })),
  };
}

function tiptapHtml(paragraphs) {
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function log(stage, message) {
  console.log(`[seed:${stage}] ${message}`);
}

function errorDiagnostic(error) {
  if (error instanceof SeedApiError) return error.toDiagnostic();
  if (error instanceof SeedError) {
    return { kind: "seed", name: error.name, message: error.message };
  }
  return {
    kind: "unexpected",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function writeSummary() {
  const finishedAt = new Date();
  const output = {
    ...summary,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
  try {
    mkdirSync(dirname(summaryFile), { recursive: true, mode: 0o700 });
    writeFileSync(summaryFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Failed to write demo seed summary.",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function run() {
  log("auth", "signing in");
  const credentials = loadCredentials();
  const api = new ApiClient(apiOrigin);
  const actor = await authenticate(api, credentials);
  summary.actor = { id: actor.id, name: actor.name };
  log("auth", "session established");

  log("workspace", `resolving "${workspaceSlug}"`);
  const { workspace, created } = await ensureWorkspace(api);
  summary.workspace = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: workspace.role,
  };
  summary.created.workspace = created;
  log("workspace", created ? "created" : "reused");

  const members = await loadWorkspaceMembers(api, workspace.id, actor);
  summary.counts.members = members.length;

  log("trips", "resolving demo trips");
  const states = await resolveTrips(api, workspace.id);
  await ensureTripParticipants(api, states, members);

  log("entries", "seeding journals");
  await seedEntries(api, states);

  log("expenses", "seeding expenses");
  await seedExpenses(api, states);

  log("packing", "seeding packing lists");
  await seedPacking(api, states);

  log("media", "seeding photo galleries");
  await seedPhotos(api, states);

  summary.counts.entries = states.reduce((total, state) => total + state.counts.entries, 0);
  summary.counts.expenses = states.reduce((total, state) => total + state.counts.expenses, 0);
  summary.counts.packingItems = states.reduce(
    (total, state) => total + state.counts.packingItems,
    0,
  );
  summary.status = summary.warnings.length > 0 ? "partial" : "ready";

  log(
    "summary",
    JSON.stringify({
      workspace: workspace.slug,
      trips: summary.counts.trips,
      entries: summary.counts.entries,
      expenses: summary.counts.expenses,
      packingItems: summary.counts.packingItems,
      photos: summary.counts.photos,
      albums: summary.counts.albums,
      warnings: summary.warnings.length,
    }),
  );
}

try {
  await run();
} catch (error) {
  summary.status = "failed";
  const diagnostic = errorDiagnostic(error);
  summary.errors.push(diagnostic);
  console.error(JSON.stringify({ level: "error", taskId: TASK_ID, error: diagnostic }));
  process.exitCode = 1;
} finally {
  writeSummary();
  console.log(
    JSON.stringify({
      status: summary.status,
      summaryFile,
      workspaceSlug: summary.workspace?.slug ?? null,
      counts: summary.counts,
      warnings: summary.warnings.length,
    }),
  );
}
