import { userIds, workspaceId } from "./core.js";
import { media } from "./entries.js";
import { tripId } from "./trips.js";
import type {
  SeedExpense,
  SeedExpenseParticipant,
  SeedPackingItem,
} from "./types.js";
import {
  customSplit,
  deterministicId,
  equalSplit,
  timestamp,
} from "./util.js";

interface ExpenseDefinition {
  key: string;
  trip: string;
  date: string;
  category: SeedExpense["category"];
  note: string;
  amountMinor: number;
  currency: string;
  paidById: string;
  splitMode: SeedExpense["splitMode"];
  participantIds: string[];
  customWeights?: { userId: string; weight: number }[];
}

const allKyoto = [userIds.owner, userIds.editor, userIds.viewer];

const definitions: ExpenseDefinition[] = [
  {
    key: "kyoto-train",
    trip: "kyoto",
    date: "2026-11-21",
    category: "transport",
    note: "关西机场到京都的 HARUKA 指定席",
    amountMinor: 5_480,
    currency: "JPY",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: allKyoto,
  },
  {
    key: "kyoto-ryokan",
    trip: "kyoto",
    date: "2026-11-22",
    category: "stay",
    note: "东山六间宿四晚",
    amountMinor: 146_000,
    currency: "JPY",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "kyoto-kaiseki",
    trip: "kyoto",
    date: "2026-11-27",
    category: "food",
    note: "祇园怀石晚餐",
    amountMinor: 72_300,
    currency: "JPY",
    paidById: userIds.owner,
    splitMode: "custom",
    participantIds: allKyoto,
    customWeights: [
      { userId: userIds.owner, weight: 2 },
      { userId: userIds.editor, weight: 1 },
      { userId: userIds.viewer, weight: 1 },
    ],
  },
  {
    key: "seoul-cafe",
    trip: "seoul",
    date: "2026-11-15",
    category: "food",
    note: "西村咖啡馆与早餐",
    amountMinor: 48_000,
    currency: "KRW",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "seoul-stay",
    trip: "seoul",
    date: "2026-11-14",
    category: "stay",
    note: "西村公寓五晚",
    amountMinor: 420_000,
    currency: "KRW",
    paidById: userIds.editor,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "iceland-car",
    trip: "iceland",
    date: "2026-08-02",
    category: "transport",
    note: "十天四驱车与砂石险",
    amountMinor: 186_400,
    currency: "ISK",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "iceland-stays",
    trip: "iceland",
    date: "2026-08-03",
    category: "stay",
    note: "环岛九晚住宿",
    amountMinor: 320_000,
    currency: "ISK",
    paidById: userIds.editor,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "iceland-fuel",
    trip: "iceland",
    date: "2026-08-07",
    category: "transport",
    note: "环岛油费与洗车",
    amountMinor: 42_750,
    currency: "ISK",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "lisbon-apartment",
    trip: "lisbon",
    date: "2026-05-10",
    category: "stay",
    note: "阿尔法玛公寓六晚",
    amountMinor: 74_000,
    currency: "EUR",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor, userIds.viewer],
  },
  {
    key: "lisbon-fado",
    trip: "lisbon",
    date: "2026-05-12",
    category: "activity",
    note: "法多小馆门票与饮品",
    amountMinor: 9_600,
    currency: "EUR",
    paidById: userIds.editor,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor, userIds.viewer],
  },
  {
    key: "santorini-stay",
    trip: "santorini",
    date: "2025-09-14",
    category: "stay",
    note: "费拉悬崖边三晚",
    amountMinor: 112_000,
    currency: "EUR",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "santorini-dinner",
    trip: "santorini",
    date: "2025-09-18",
    category: "food",
    note: "日落后的海边晚餐",
    amountMinor: 8_650,
    currency: "EUR",
    paidById: userIds.editor,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "tokyo-hotel",
    trip: "tokyo",
    date: "2025-03-02",
    category: "stay",
    note: "新宿两晚商务旅馆",
    amountMinor: 38_600,
    currency: "JPY",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner],
  },
  {
    key: "tokyo-movie",
    trip: "tokyo",
    date: "2025-03-03",
    category: "activity",
    note: "早场电影票",
    amountMinor: 2_000,
    currency: "JPY",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner],
  },
  {
    key: "marrakech-riad",
    trip: "marrakech",
    date: "2024-10-05",
    category: "stay",
    note: "麦地那 riad 四晚",
    amountMinor: 280_000,
    currency: "MAD",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "marrakech-guide",
    trip: "marrakech",
    date: "2024-10-09",
    category: "activity",
    note: "阿特拉斯山当地向导",
    amountMinor: 60_000,
    currency: "MAD",
    paidById: userIds.editor,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "patagonia-glacier",
    trip: "patagonia",
    date: "2027-02-11",
    category: "activity",
    note: "佩里托莫雷诺冰川一日",
    amountMinor: 24_000,
    currency: "USD",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor, userIds.viewer],
  },
  {
    key: "patagonia-lodge",
    trip: "patagonia",
    date: "2027-02-15",
    category: "stay",
    note: "百内山屋三晚订金",
    amountMinor: 54_000,
    currency: "USD",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "amalfi-ferry",
    trip: "amalfi",
    date: "2027-05-20",
    category: "transport",
    note: "索伦托到波西塔诺渡轮",
    amountMinor: 3_860,
    currency: "EUR",
    paidById: userIds.owner,
    splitMode: "equal",
    participantIds: [userIds.owner, userIds.editor],
  },
  {
    key: "amalfi-dinner",
    trip: "amalfi",
    date: "2027-05-24",
    category: "food",
    note: "柠檬园最后一晚晚餐",
    amountMinor: 12_400,
    currency: "EUR",
    paidById: userIds.owner,
    splitMode: "custom",
    participantIds: [userIds.owner, userIds.editor],
    customWeights: [
      { userId: userIds.owner, weight: 3 },
      { userId: userIds.editor, weight: 2 },
    ],
  },
];

export const expenses: SeedExpense[] = definitions.map((definition) => {
  const shares =
    definition.splitMode === "custom"
      ? customSplit(
          definition.amountMinor,
          definition.customWeights ?? definition.participantIds.map((userId) => ({
            userId,
            weight: 1,
          })),
        )
      : equalSplit(
          definition.amountMinor,
          definition.participantIds,
          definition.paidById,
        );
  const receipt = media.find(
    (item) => item.tripId === tripId(definition.trip),
  );
  const participants: SeedExpenseParticipant[] = shares.map((share) => ({
    workspaceId,
    expenseId: deterministicId("expense", definition.key),
    userId: share.userId,
    shareAmountMinor: share.shareAmountMinor,
  }));
  return {
    id: deterministicId("expense", definition.key),
    workspaceId,
    tripId: tripId(definition.trip),
    date: definition.date,
    category: definition.category,
    note: definition.note,
    amountMinor: definition.amountMinor,
    currency: definition.currency,
    paidById: definition.paidById,
    splitMode: definition.splitMode,
    receiptMediaId: receipt?.id ?? null,
    createdById: definition.paidById,
    version: 1,
    createdAt: timestamp(definition.date, "10:15:00"),
    updatedAt: timestamp(definition.date, "10:20:00"),
    deletedAt: null,
    participants,
  };
});

interface PackingDefinition {
  trip: string;
  category: SeedPackingItem["category"];
  name: string;
  quantity: number;
  assigneeId: string | null;
}

const basePacking: Omit<PackingDefinition, "trip">[] = [
  {
    category: "documents",
    name: "护照与签证复印件",
    quantity: 1,
    assigneeId: userIds.owner,
  },
  {
    category: "clothing",
    name: "可叠穿薄外套",
    quantity: 2,
    assigneeId: userIds.editor,
  },
  {
    category: "gear",
    name: "万能转换插头",
    quantity: 1,
    assigneeId: userIds.owner,
  },
];

const tripKeys = [
  "kyoto",
  "seoul",
  "iceland",
  "lisbon",
  "santorini",
  "tokyo",
  "marrakech",
  "patagonia",
  "amalfi",
] as const;

const extras: PackingDefinition[] = [
  {
    trip: "kyoto",
    category: "other",
    name: "ICOCA 交通卡",
    quantity: 2,
    assigneeId: userIds.owner,
  },
  {
    trip: "seoul",
    category: "gear",
    name: "轻便三脚架",
    quantity: 1,
    assigneeId: userIds.editor,
  },
  {
    trip: "iceland",
    category: "gear",
    name: "防水袋与备用相机电池",
    quantity: 2,
    assigneeId: userIds.owner,
  },
];

const packingDefinitions: PackingDefinition[] = [
  ...tripKeys.flatMap((trip) =>
    basePacking.map((item) => ({ ...item, trip })),
  ),
  ...extras,
];

const packingOrder = new Map<string, number>();

export const packingItems: SeedPackingItem[] = packingDefinitions.map(
  (definition) => {
    const parentTrip = tripKeys.includes(
      definition.trip as (typeof tripKeys)[number],
    )
      ? definition.trip
      : null;
    if (!parentTrip) {
      throw new Error(`Unknown packing trip: ${definition.trip}`);
    }
    const order = packingOrder.get(parentTrip) ?? 0;
    packingOrder.set(parentTrip, order + 1);
    const packed =
      ["iceland", "lisbon", "santorini", "tokyo", "marrakech"].includes(
        parentTrip,
      ) || (parentTrip === "seoul" && order < 2);
    return {
      id: deterministicId("packing-item", `${parentTrip}:${definition.name}`),
      workspaceId,
      tripId: tripId(parentTrip),
      category: definition.category,
      name: definition.name,
      quantity: definition.quantity,
      packed,
      assigneeId: definition.assigneeId,
      order,
      version: 1,
      createdById: userIds.owner,
      updatedById: definition.assigneeId ?? userIds.owner,
      createdAt: timestamp("2026-01-20", "05:00:00"),
      updatedAt: timestamp("2026-11-12", "06:00:00"),
      deletedAt: null,
    };
  },
);
