import { userIds, workspaceId } from "./core.js";
import type {
  SeedStop,
  SeedTrip,
  SeedTripParticipant,
} from "./types.js";
import { addDays, deterministicId, timestamp } from "./util.js";

interface TripDefinition {
  key: string;
  title: string;
  country: string;
  summary: string;
  status: SeedTrip["status"];
  startDate: string;
  endDate: string;
  origin: string;
  destinations: string[];
  countryCodes: string[];
  tags: string[];
  budgetAmountMinor: number;
  budgetCurrency: string;
  visibility: SeedTrip["visibility"];
  favorite: boolean;
  createdById: string;
  updatedById: string;
}

const definitions: TripDefinition[] = [
  {
    key: "kyoto",
    title: "京都十一月",
    country: "日本",
    summary:
      "沿着鸭川慢慢走，在红叶最盛的几天住进东山小巷。没有打卡清单，只约了两次茶室和一顿久等的怀石。",
    status: "upcoming",
    startDate: "2026-11-21",
    endDate: "2026-11-29",
    origin: "上海",
    destinations: ["京都", "大阪", "奈良"],
    countryCodes: ["JP"],
    tags: ["秋叶", "慢旅行", "茶室"],
    budgetAmountMinor: 980_000,
    budgetCurrency: "CNY",
    visibility: "public_link",
    favorite: true,
    createdById: userIds.owner,
    updatedById: userIds.owner,
  },
  {
    key: "seoul",
    title: "首尔一周",
    country: "韩国",
    summary:
      "把会议塞进上午，下午留给独立书店和汉江。临时加了一场小剧场演出，也终于吃到巷子里的刀削面。",
    status: "active",
    startDate: "2026-11-14",
    endDate: "2026-11-20",
    origin: "上海",
    destinations: ["首尔", "仁川"],
    countryCodes: ["KR"],
    tags: ["城市漫游", "书店", "工作旅行"],
    budgetAmountMinor: 760_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    createdById: userIds.editor,
    updatedById: userIds.editor,
  },
  {
    key: "iceland",
    title: "冰岛环岛",
    country: "冰岛",
    summary:
      "十天逆时针环岛，风比照片里更大。我们把每天的车程压到四小时以内，留给温泉、海鹦和没有名字的瀑布。",
    status: "completed",
    startDate: "2026-08-02",
    endDate: "2026-08-12",
    origin: "哥本哈根",
    destinations: ["雷克雅未克", "维克", "阿克雷里"],
    countryCodes: ["IS"],
    tags: ["公路旅行", "瀑布", "温泉"],
    budgetAmountMinor: 2_460_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: true,
    createdById: userIds.owner,
    updatedById: userIds.owner,
  },
  {
    key: "lisbon",
    title: "里斯本慢日",
    country: "葡萄牙",
    summary:
      "把七天的行程删到只剩三件事：坐 28 路电车、去辛特拉看雾、在阿尔法玛听一场法多。",
    status: "completed",
    startDate: "2026-05-10",
    endDate: "2026-05-16",
    origin: "马德里",
    destinations: ["里斯本", "辛特拉"],
    countryCodes: ["PT"],
    tags: ["法多", "电车", "慢旅行"],
    budgetAmountMinor: 890_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    createdById: userIds.owner,
    updatedById: userIds.editor,
  },
  {
    key: "santorini",
    title: "圣托里尼重启",
    country: "希腊",
    summary:
      "在伊亚之外住进费拉的山坡，早起看海，午后避开邮轮人群。真正记住的是日落之后安静下来的白墙。",
    status: "completed",
    startDate: "2025-09-14",
    endDate: "2025-09-20",
    origin: "雅典",
    destinations: ["伊亚", "费拉"],
    countryCodes: ["GR"],
    tags: ["海岛", "日落", "休整"],
    budgetAmountMinor: 1_320_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    createdById: userIds.owner,
    updatedById: userIds.owner,
  },
  {
    key: "tokyo",
    title: "东京转机",
    country: "日本",
    summary:
      "四十八小时的意外停留。寄存行李，去看一场早场电影，再沿神田川走回住处。",
    status: "completed",
    startDate: "2025-03-02",
    endDate: "2025-03-05",
    origin: "旧金山",
    destinations: ["新宿", "浅草"],
    countryCodes: ["JP"],
    tags: ["转机", "城市漫游", "电影"],
    budgetAmountMinor: 310_000,
    budgetCurrency: "CNY",
    visibility: "private",
    favorite: false,
    createdById: userIds.owner,
    updatedById: userIds.owner,
  },
  {
    key: "marrakech",
    title: "马拉喀什与阿特拉斯",
    country: "摩洛哥",
    summary:
      "从麦地那的喧闹一路开到山里的柏柏尔村庄。夜里很冷，厨房里的薄荷茶一直没停。",
    status: "completed",
    startDate: "2024-10-05",
    endDate: "2024-10-14",
    origin: "巴黎",
    destinations: ["马拉喀什", "阿特拉斯山脉"],
    countryCodes: ["MA"],
    tags: ["麦地那", "徒步", "山居"],
    budgetAmountMinor: 1_180_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: true,
    createdById: userIds.owner,
    updatedById: userIds.editor,
  },
  {
    key: "patagonia",
    title: "巴塔哥尼亚穿越",
    country: "智利/阿根廷",
    summary:
      "还未出发的冬季计划：从埃尔卡拉法特进百内，留出天气窗口，不把每天排满。",
    status: "wishlist",
    startDate: "2027-02-10",
    endDate: "2027-02-24",
    origin: "上海",
    destinations: ["埃尔卡拉法特", "百内国家公园"],
    countryCodes: ["CL", "AR"],
    tags: ["徒步", "冰川", "长线"],
    budgetAmountMinor: 3_800_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: true,
    createdById: userIds.owner,
    updatedById: userIds.owner,
  },
  {
    key: "amalfi",
    title: "阿马尔菲海岸",
    country: "意大利",
    summary:
      "把假期放在五月。以索伦托为基地，坐船去波西塔诺，留一天只走众神之路。",
    status: "planning",
    startDate: "2027-05-18",
    endDate: "2027-05-25",
    origin: "上海",
    destinations: ["索伦托", "波西塔诺", "拉韦洛"],
    countryCodes: ["IT"],
    tags: ["海岸", "徒步", "春天"],
    budgetAmountMinor: 2_100_000,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    createdById: userIds.owner,
    updatedById: userIds.editor,
  },
];

export const tripIds = Object.fromEntries(
  definitions.map((definition) => [
    definition.key,
    deterministicId("trip", definition.key),
  ]),
) as Record<string, string>;

export function tripId(key: keyof typeof tripIds): string {
  const id = tripIds[key];
  if (!id) {
    throw new Error(`Unknown trip fixture key: ${key}`);
  }
  return id;
}

export const trips: SeedTrip[] = definitions.map((definition, index) => ({
  id: tripId(definition.key),
  workspaceId,
  title: definition.title,
  summary: definition.summary,
  country: definition.country,
  status: definition.status,
  startDate: definition.startDate,
  endDate: definition.endDate,
  coverMediaId: null,
  origin: definition.origin,
  destinations: definition.destinations,
  countryCodes: definition.countryCodes,
  tags: definition.tags,
  guestNames: [],
  budgetAmountMinor: definition.budgetAmountMinor,
  budgetCurrency: definition.budgetCurrency,
  visibility: definition.visibility,
  favorite: definition.favorite,
  version: index < 2 ? 3 : 2,
  createdById: definition.createdById,
  updatedById: definition.updatedById,
  createdAt: timestamp(addDays(definition.startDate, -75), "04:00:00"),
  updatedAt:
    index < 2 ? timestamp("2026-11-17", "01:40:00") : timestamp("2026-09-01", "06:20:00"),
  deletedAt: null,
}));

const participantMap: Record<string, string[]> = {
  kyoto: [userIds.owner, userIds.editor, userIds.viewer],
  seoul: [userIds.owner, userIds.editor],
  iceland: [userIds.owner, userIds.editor],
  lisbon: [userIds.owner, userIds.editor, userIds.viewer],
  santorini: [userIds.owner, userIds.editor],
  tokyo: [userIds.owner],
  marrakech: [userIds.owner, userIds.editor],
  patagonia: [userIds.owner, userIds.editor, userIds.viewer],
  amalfi: [userIds.owner, userIds.editor],
};

export const tripParticipants: SeedTripParticipant[] = definitions.flatMap(
  (definition, tripIndex) =>
    (participantMap[definition.key] ?? []).map((userId, index) => ({
      id: deterministicId("trip-participant", `${definition.key}:${userId}`),
      workspaceId,
      tripId: tripId(definition.key),
      userId,
      joinedAt: timestamp(
        addDays(definition.startDate, -70 + index),
        `${String(8 + tripIndex).padStart(2, "0")}:00:00`,
      ),
    })),
);

interface StopDefinition {
  trip: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  startOffset: number;
  endOffset: number;
  notes: string;
}

const stopDefinitions: StopDefinition[] = [
  {
    trip: "kyoto",
    city: "京都市",
    country: "日本",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    startOffset: 0,
    endOffset: 4,
    notes: "住在东山附近，步行去南禅寺和鸭川。",
  },
  {
    trip: "kyoto",
    city: "大阪市",
    country: "日本",
    countryCode: "JP",
    lat: 34.6937,
    lng: 135.5023,
    startOffset: 4,
    endOffset: 8,
    notes: "最后四天住难波，方便去关西机场。",
  },
  {
    trip: "seoul",
    city: "首尔",
    country: "韩国",
    countryCode: "KR",
    lat: 37.5665,
    lng: 126.978,
    startOffset: 0,
    endOffset: 4,
    notes: "西村一带，上午远程工作。",
  },
  {
    trip: "seoul",
    city: "仁川",
    country: "韩国",
    countryCode: "KR",
    lat: 37.4563,
    lng: 126.7052,
    startOffset: 4,
    endOffset: 6,
    notes: "机场附近住一晚，顺便看海。",
  },
  {
    trip: "iceland",
    city: "雷克雅未克",
    country: "冰岛",
    countryCode: "IS",
    lat: 64.1466,
    lng: -21.9426,
    startOffset: 0,
    endOffset: 3,
    notes: "取车、补给，沿海边散步。",
  },
  {
    trip: "iceland",
    city: "维克",
    country: "冰岛",
    countryCode: "IS",
    lat: 63.4187,
    lng: -19.006,
    startOffset: 3,
    endOffset: 6,
    notes: "黑沙滩、瀑布和一次被风吹回的徒步。",
  },
  {
    trip: "iceland",
    city: "阿克雷里",
    country: "冰岛",
    countryCode: "IS",
    lat: 65.6885,
    lng: -18.1262,
    startOffset: 6,
    endOffset: 10,
    notes: "北部峡湾，最后两天放慢车速。",
  },
  {
    trip: "lisbon",
    city: "里斯本",
    country: "葡萄牙",
    countryCode: "PT",
    lat: 38.7223,
    lng: -9.1393,
    startOffset: 0,
    endOffset: 4,
    notes: "阿尔法玛的老公寓，窗外就是电车线。",
  },
  {
    trip: "lisbon",
    city: "辛特拉",
    country: "葡萄牙",
    countryCode: "PT",
    lat: 38.8029,
    lng: -9.3817,
    startOffset: 4,
    endOffset: 6,
    notes: "在雾里看佩纳宫，傍晚回里斯本。",
  },
  {
    trip: "santorini",
    city: "伊亚",
    country: "希腊",
    countryCode: "GR",
    lat: 36.4618,
    lng: 25.3753,
    startOffset: 0,
    endOffset: 3,
    notes: "避开邮轮时段，早起看海。",
  },
  {
    trip: "santorini",
    city: "费拉",
    country: "希腊",
    countryCode: "GR",
    lat: 36.4161,
    lng: 25.431,
    startOffset: 3,
    endOffset: 6,
    notes: "沿悬崖步道走到伊莫洛维里。",
  },
  {
    trip: "tokyo",
    city: "新宿",
    country: "日本",
    countryCode: "JP",
    lat: 35.6938,
    lng: 139.7034,
    startOffset: 0,
    endOffset: 1,
    notes: "机场快线直达，行李寄存在站内。",
  },
  {
    trip: "tokyo",
    city: "浅草",
    country: "日本",
    countryCode: "JP",
    lat: 35.7148,
    lng: 139.7967,
    startOffset: 1,
    endOffset: 3,
    notes: "沿神田川走到御茶之水。",
  },
  {
    trip: "marrakech",
    city: "马拉喀什",
    country: "摩洛哥",
    countryCode: "MA",
    lat: 31.6295,
    lng: -7.9811,
    startOffset: 0,
    endOffset: 4,
    notes: "住麦地那里的 riad，晚上才敢认路。",
  },
  {
    trip: "marrakech",
    city: "阿特拉斯山麓",
    country: "摩洛哥",
    countryCode: "MA",
    lat: 31.156,
    lng: -7.854,
    startOffset: 4,
    endOffset: 9,
    notes: "在伊姆利尔徒步，住柏柏尔家庭旅馆。",
  },
  {
    trip: "patagonia",
    city: "埃尔卡拉法特",
    country: "阿根廷",
    countryCode: "AR",
    lat: -50.3379,
    lng: -72.2648,
    startOffset: 0,
    endOffset: 4,
    notes: "看冰川，留一天适应天气。",
  },
  {
    trip: "patagonia",
    city: "百内国家公园",
    country: "智利",
    countryCode: "CL",
    lat: -50.9423,
    lng: -73.4068,
    startOffset: 4,
    endOffset: 14,
    notes: "W 线不追求全程，选三晚山屋。",
  },
  {
    trip: "amalfi",
    city: "索伦托",
    country: "意大利",
    countryCode: "IT",
    lat: 40.6263,
    lng: 14.3758,
    startOffset: 0,
    endOffset: 4,
    notes: "以这里为基地，坐船或巴士去沿岸。",
  },
  {
    trip: "amalfi",
    city: "波西塔诺",
    country: "意大利",
    countryCode: "IT",
    lat: 40.6281,
    lng: 14.4849,
    startOffset: 4,
    endOffset: 7,
    notes: "最后三天住海边，走众神之路。",
  },
];

export const stops: SeedStop[] = stopDefinitions.map((definition, index) => {
  const parent = definitions.find((trip) => trip.key === definition.trip);
  if (!parent) {
    throw new Error(`Unknown stop trip: ${definition.trip}`);
  }
  return {
    id: deterministicId("stop", `${definition.trip}:${definition.city}`),
    workspaceId,
    tripId: tripId(definition.trip),
    city: definition.city,
    country: definition.country,
    countryCode: definition.countryCode,
    lat: definition.lat,
    lng: definition.lng,
    startDate: addDays(parent.startDate, definition.startOffset),
    endDate: addDays(parent.startDate, definition.endOffset),
    notes: definition.notes,
    order: index,
    version: 1,
    createdById: userIds.owner,
    updatedById: userIds.editor,
    createdAt: timestamp(addDays(parent.startDate, -60), "05:00:00"),
    updatedAt: timestamp(addDays(parent.startDate, -20), "07:00:00"),
    deletedAt: null,
  };
});
