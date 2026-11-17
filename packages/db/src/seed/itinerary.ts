import { userIds, workspaceId } from "./core.js";
import { entryId } from "./entries.js";
import { tripId, trips } from "./trips.js";
import type {
  SeedComment,
  SeedCommentMention,
  SeedItineraryItem,
} from "./types.js";
import { deterministicId, timestamp } from "./util.js";

interface ItineraryDefinition {
  key: string;
  trip: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  type: SeedItineraryItem["type"];
  location: string;
  notes: string;
  assigneeId: string | null;
}

const definitions: ItineraryDefinition[] = [
  {
    key: "kyoto-arrival",
    trip: "kyoto",
    date: "2026-11-21",
    startTime: "14:30",
    endTime: "16:30",
    title: "关西机场 → 京都",
    type: "transit",
    location: "HARUKA",
    notes: "指定席已订，抵达后先买 ICOCA。",
    assigneeId: userIds.owner,
  },
  {
    key: "kyoto-nanzenji-walk",
    trip: "kyoto",
    date: "2026-11-23",
    startTime: "07:00",
    endTime: "09:30",
    title: "南禅寺与水路阁散步",
    type: "activity",
    location: "南禅寺",
    notes: "尽量在旅行团之前到。",
    assigneeId: userIds.owner,
  },
  {
    key: "kyoto-market-lunch",
    trip: "kyoto",
    date: "2026-11-25",
    startTime: "12:30",
    endTime: "14:00",
    title: "锦市场午餐",
    type: "food",
    location: "锦市场",
    notes: "雨天备选：寺町通的有座小店。",
    assigneeId: userIds.editor,
  },
  {
    key: "kyoto-tea",
    trip: "kyoto",
    date: "2026-11-27",
    startTime: "10:00",
    endTime: "12:00",
    title: "茶室预约",
    type: "activity",
    location: "祇园",
    notes: "提前十分钟到，不喷香水。",
    assigneeId: userIds.owner,
  },
  {
    key: "seoul-coffee",
    trip: "seoul",
    date: "2026-11-15",
    startTime: "09:30",
    endTime: "11:30",
    title: "西村咖啡与远程会议",
    type: "food",
    location: "西村",
    notes: "带降噪耳机，11 点前结束。",
    assigneeId: userIds.editor,
  },
  {
    key: "seoul-bookstores",
    trip: "seoul",
    date: "2026-11-16",
    startTime: "10:00",
    endTime: "17:00",
    title: "独立书店半日",
    type: "activity",
    location: "圣水洞",
    notes: "只看不买，行李已经满了。",
    assigneeId: userIds.owner,
  },
  {
    key: "seoul-han-picnic",
    trip: "seoul",
    date: "2026-11-18",
    startTime: "17:30",
    endTime: "21:00",
    title: "汉江边野餐",
    type: "food",
    location: "汉江公园",
    notes: "买桌布和湿巾，风大就换到桥下。",
    assigneeId: userIds.owner,
  },
  {
    key: "seoul-airport",
    trip: "seoul",
    date: "2026-11-20",
    startTime: "11:00",
    endTime: "14:00",
    title: "仁川机场送机",
    type: "transit",
    location: "仁川",
    notes: "预留退税时间。",
    assigneeId: userIds.owner,
  },
  {
    key: "iceland-car",
    trip: "iceland",
    date: "2026-08-02",
    startTime: "16:00",
    endTime: "17:30",
    title: "机场取车与补给",
    type: "transit",
    location: "凯夫拉维克机场",
    notes: "检查轮胎和车灯，买砂石险。",
    assigneeId: userIds.owner,
  },
  {
    key: "iceland-golden-circle",
    trip: "iceland",
    date: "2026-08-04",
    startTime: "09:30",
    endTime: "18:00",
    title: "黄金圈自驾",
    type: "activity",
    location: "辛格维利尔",
    notes: "不追三个点，中午找地方煮咖啡。",
    assigneeId: userIds.owner,
  },
  {
    key: "iceland-black-sand",
    trip: "iceland",
    date: "2026-08-06",
    startTime: "10:00",
    endTime: "13:00",
    title: "黑沙滩与迪霍拉里",
    type: "activity",
    location: "维克",
    notes: "严格看浪，不背对海。",
    assigneeId: userIds.editor,
  },
  {
    key: "iceland-aurora",
    trip: "iceland",
    date: "2026-08-11",
    startTime: "21:30",
    endTime: "23:30",
    title: "等一次极光",
    type: "note",
    location: "阿克雷里郊外",
    notes: "八月概率不高，但值得留一晚。",
    assigneeId: userIds.owner,
  },
  {
    key: "lisbon-tram",
    trip: "lisbon",
    date: "2026-05-11",
    startTime: "09:00",
    endTime: "11:00",
    title: "28 路电车到格拉萨",
    type: "transit",
    location: "阿尔法玛",
    notes: "避开早高峰，从终点站上车。",
    assigneeId: userIds.owner,
  },
  {
    key: "lisbon-fado",
    trip: "lisbon",
    date: "2026-05-12",
    startTime: "19:30",
    endTime: "22:00",
    title: "阿尔法玛法多演出",
    type: "activity",
    location: "阿尔法玛",
    notes: "小馆只收现金，提前订位。",
    assigneeId: userIds.editor,
  },
  {
    key: "lisbon-sintra",
    trip: "lisbon",
    date: "2026-05-14",
    startTime: "08:30",
    endTime: "18:00",
    title: "辛特拉一日",
    type: "transit",
    location: "罗西乌站",
    notes: "穿防水鞋，带薄外套。",
    assigneeId: userIds.owner,
  },
  {
    key: "santorini-morning",
    trip: "santorini",
    date: "2025-09-15",
    startTime: "07:00",
    endTime: "09:00",
    title: "伊亚清晨散步",
    type: "activity",
    location: "伊亚",
    notes: "趁旅行团到达前走完主巷。",
    assigneeId: userIds.owner,
  },
  {
    key: "santorini-cliff-walk",
    trip: "santorini",
    date: "2025-09-17",
    startTime: "10:30",
    endTime: "13:00",
    title: "费拉悬崖步道",
    type: "activity",
    location: "费拉 → 伊莫洛维里",
    notes: "带足水，中午前折返。",
    assigneeId: userIds.editor,
  },
  {
    key: "santorini-sunset",
    trip: "santorini",
    date: "2025-09-19",
    startTime: "18:30",
    endTime: "20:30",
    title: "日落前找一张空桌",
    type: "food",
    location: "费拉",
    notes: "不执着网红点，能看见海就行。",
    assigneeId: userIds.owner,
  },
  {
    key: "tokyo-movie",
    trip: "tokyo",
    date: "2025-03-03",
    startTime: "09:30",
    endTime: "11:45",
    title: "新宿早场电影",
    type: "activity",
    location: "新宿",
    notes: "现场买票，散场后不要赶。",
    assigneeId: userIds.owner,
  },
  {
    key: "tokyo-kanda",
    trip: "tokyo",
    date: "2025-03-03",
    startTime: "15:00",
    endTime: "17:00",
    title: "沿神田川走到御茶之水",
    type: "activity",
    location: "神田川",
    notes: "下雨就改去神保町书店。",
    assigneeId: userIds.owner,
  },
  {
    key: "tokyo-lunch",
    trip: "tokyo",
    date: "2025-03-04",
    startTime: "11:00",
    endTime: "12:30",
    title: "浅草午餐",
    type: "food",
    location: "浅草",
    notes: "去排队少的那家。",
    assigneeId: userIds.owner,
  },
  {
    key: "marrakech-medina",
    trip: "marrakech",
    date: "2024-10-06",
    startTime: "09:00",
    endTime: "12:30",
    title: "麦地那迷路练习",
    type: "activity",
    location: "马拉喀什",
    notes: "不打开地图，累了就回 riad。",
    assigneeId: userIds.owner,
  },
  {
    key: "marrakech-hike",
    trip: "marrakech",
    date: "2024-10-09",
    startTime: "08:00",
    endTime: "16:00",
    title: "阿特拉斯山徒步",
    type: "activity",
    location: "伊姆利尔",
    notes: "带现金，午后可能起风。",
    assigneeId: userIds.editor,
  },
  {
    key: "marrakech-dinner",
    trip: "marrakech",
    date: "2024-10-12",
    startTime: "18:00",
    endTime: "20:30",
    title: "屋顶晚餐",
    type: "food",
    location: "麦地那",
    notes: "提前一天确认，不要点太多。",
    assigneeId: userIds.owner,
  },
  {
    key: "patagonia-glacier",
    trip: "patagonia",
    date: "2027-02-11",
    startTime: "10:00",
    endTime: "17:00",
    title: "佩里托莫雷诺冰川",
    type: "activity",
    location: "埃尔卡拉法特",
    notes: "只走栈道，不参加冰上徒步。",
    assigneeId: userIds.owner,
  },
  {
    key: "patagonia-bus",
    trip: "patagonia",
    date: "2027-02-15",
    startTime: "08:00",
    endTime: "13:00",
    title: "埃尔卡拉法特 → 百内",
    type: "transit",
    location: "边境",
    notes: "护照和入境表放随身包。",
    assigneeId: userIds.owner,
  },
  {
    key: "patagonia-towers",
    trip: "patagonia",
    date: "2027-02-18",
    startTime: "09:00",
    endTime: "18:00",
    title: "三塔观景台",
    type: "activity",
    location: "百内国家公园",
    notes: "天气不好就取消，不冒险。",
    assigneeId: userIds.editor,
  },
  {
    key: "amalfi-ferry",
    trip: "amalfi",
    date: "2027-05-20",
    startTime: "09:00",
    endTime: "11:00",
    title: "索伦托 → 波西塔诺渡轮",
    type: "transit",
    location: "索伦托港",
    notes: "提前看风浪，晕船药放包里。",
    assigneeId: userIds.owner,
  },
  {
    key: "amalfi-path",
    trip: "amalfi",
    date: "2027-05-22",
    startTime: "08:30",
    endTime: "15:00",
    title: "众神之路",
    type: "activity",
    location: "博梅拉诺 → 波西塔诺",
    notes: "带两升水，登山杖需要就租。",
    assigneeId: userIds.owner,
  },
  {
    key: "amalfi-dinner",
    trip: "amalfi",
    date: "2027-05-24",
    startTime: "19:30",
    endTime: "21:30",
    title: "柠檬园晚餐",
    type: "food",
    location: "索伦托",
    notes: "最后一天不安排远程会议。",
    assigneeId: userIds.editor,
  },
];

export const itineraryIds = Object.fromEntries(
  definitions.map((definition) => [
    definition.key,
    deterministicId("itinerary-item", definition.key),
  ]),
) as Record<string, string>;

export function itineraryId(key: string): string {
  const id = itineraryIds[key];
  if (!id) {
    throw new Error(`Unknown itinerary fixture key: ${key}`);
  }
  return id;
}

const perTripOrder = new Map<string, number>();

export const itineraryItems: SeedItineraryItem[] = definitions.map(
  (definition) => {
    const parent = trips.find((trip) => trip.id === tripId(definition.trip));
    if (!parent) {
      throw new Error(`Unknown itinerary trip: ${definition.trip}`);
    }
    const order = perTripOrder.get(definition.trip) ?? 0;
    perTripOrder.set(definition.trip, order + 1);
    const done =
      parent.status === "completed" ||
      (parent.status === "active" && definition.date <= "2026-11-17");
    return {
      id: itineraryId(definition.key),
      workspaceId,
      tripId: parent.id,
      date: definition.date,
      startTime: definition.startTime,
      endTime: definition.endTime,
      title: definition.title,
      type: definition.type,
      location: definition.location,
      notes: definition.notes,
      done,
      order,
      assigneeId: definition.assigneeId,
      version: done ? 2 : 1,
      createdById: userIds.owner,
      updatedById: definition.assigneeId ?? userIds.owner,
      createdAt: timestamp(definition.date, "03:00:00"),
      updatedAt: timestamp(definition.date, "03:15:00"),
      deletedAt: null,
    };
  },
);

interface CommentDefinition {
  key: string;
  trip: string;
  targetType: SeedComment["targetType"];
  targetKey: string;
  parentKey: string | null;
  authorId: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

const commentDefinitions: CommentDefinition[] = [
  {
    key: "kyoto-1",
    trip: "kyoto",
    targetType: "journal_entry",
    targetKey: "kyoto-arrival",
    parentKey: null,
    authorId: userIds.editor,
    body: "这间旅馆看起来很好。@林墨 记得拍一下房间窗户，我想放进行程封面。",
    resolved: false,
    createdAt: timestamp("2026-11-21", "13:20:00"),
  },
  {
    key: "kyoto-1-reply",
    trip: "kyoto",
    targetType: "journal_entry",
    targetKey: "kyoto-arrival",
    parentKey: "kyoto-1",
    authorId: userIds.owner,
    body: "拍了，明早光线更好，我补到照片里。",
    resolved: true,
    createdAt: timestamp("2026-11-21", "13:34:00"),
  },
  {
    key: "kyoto-2",
    trip: "kyoto",
    targetType: "journal_entry",
    targetKey: "kyoto-market",
    parentKey: null,
    authorId: userIds.viewer,
    body: "雨天的那碗萝卜汤听起来比任何景点都好。",
    resolved: false,
    createdAt: timestamp("2026-11-25", "14:10:00"),
  },
  {
    key: "iceland-1",
    trip: "iceland",
    targetType: "journal_entry",
    targetKey: "iceland-black-sand",
    parentKey: null,
    authorId: userIds.viewer,
    body: "照片里那道浪线很远，实际站在那儿应该很震撼。",
    resolved: false,
    createdAt: timestamp("2026-08-07", "08:45:00"),
  },
  {
    key: "lisbon-1",
    trip: "lisbon",
    targetType: "journal_entry",
    targetKey: "lisbon-tram",
    parentKey: null,
    authorId: userIds.editor,
    body: "这扇窗是整趟旅行最值钱的地方。下次订房我也要选阿尔法玛。",
    resolved: true,
    createdAt: timestamp("2026-05-12", "09:30:00"),
  },
  {
    key: "tokyo-1",
    trip: "tokyo",
    targetType: "itinerary_item",
    targetKey: "tokyo-movie",
    parentKey: null,
    authorId: userIds.owner,
    body: "早场票已经买好，散场后不安排别的事。",
    resolved: true,
    createdAt: timestamp("2025-03-02", "23:10:00"),
  },
  {
    key: "amalfi-1",
    trip: "amalfi",
    targetType: "journal_entry",
    targetKey: "amalfi-path",
    parentKey: null,
    authorId: userIds.owner,
    body: "这条路我走过一次，下午逆光。要不要把出发时间再提前半小时？",
    resolved: false,
    createdAt: timestamp("2027-05-22", "16:20:00"),
  },
  {
    key: "patagonia-1",
    trip: "patagonia",
    targetType: "journal_entry",
    targetKey: "patagonia-blank",
    parentKey: null,
    authorId: userIds.editor,
    body: "同意留两天。百内的天气不该被行程表逼着走。",
    resolved: true,
    createdAt: timestamp("2027-02-12", "07:30:00"),
  },
];

const commentIds = Object.fromEntries(
  commentDefinitions.map((definition) => [
    definition.key,
    deterministicId("comment", definition.key),
  ]),
) as Record<string, string>;

export const comments: SeedComment[] = commentDefinitions.map((definition) => ({
  id: commentIds[definition.key]!,
  workspaceId,
  tripId: tripId(definition.trip),
  targetType: definition.targetType,
  targetId:
    definition.targetType === "journal_entry"
      ? entryId(definition.targetKey)
      : itineraryId(definition.targetKey),
  parentId: definition.parentKey ? (commentIds[definition.parentKey] ?? null) : null,
  authorId: definition.authorId,
  body: definition.body,
  resolvedAt: definition.resolved
    ? timestamp(definition.createdAt.slice(0, 10), "18:00:00")
    : null,
  resolvedById: definition.resolved ? definition.authorId : null,
  createdAt: definition.createdAt,
  updatedAt: definition.createdAt,
  deletedAt: null,
}));

export const commentMentions: SeedCommentMention[] = [
  {
    workspaceId,
    commentId: commentIds["kyoto-1"]!,
    userId: userIds.owner,
  },
  {
    workspaceId,
    commentId: commentIds["amalfi-1"]!,
    userId: userIds.editor,
  },
];
