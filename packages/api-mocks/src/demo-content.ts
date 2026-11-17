import {
  ActivitySchema,
  CommentSchema,
  ExpenseWithSplitsSchema,
  InvitationSchema,
  ItineraryItemSchema,
  JournalEntrySchema,
  MediaSchema,
  NotificationSchema,
  PackingItemSchema,
  StopSchema,
  UserSchema,
  WorkspaceMemberWithUserSchema,
  splitEqualAmount,
  type Activity,
  type Comment,
  type ExpenseWithSplits,
  type Invitation,
  type ItineraryItem,
  type JournalEntry,
  type Media,
  type Notification,
  type PackingItem,
  type Stop,
  type User,
  type WorkspaceMemberWithUser,
} from "@roamlog/contracts";

import {
  ADMIN_MEMBER_ID,
  ADMIN_USER_ID,
  AMALFI_TRIP_ID,
  CREATED_AT,
  EDITOR_MEMBER_ID,
  ICELAND_TRIP_ID,
  KYOTO_TRIP_ID,
  LISBON_TRIP_ID,
  OWNER_MEMBER_ID,
  PATAGONIA_TRIP_ID,
  SEOUL_TRIP_ID,
  UPDATED_AT,
  USER_ID,
  VIEWER_MEMBER_ID,
  VIEWER_USER_ID,
  WORKSPACE_ID,
  fixtureId,
} from "./fixture-ids";

const SEED_TIME = "2026-10-12T03:40:00.000Z";
const EDITOR_USER_ID = fixtureId(2);

export const demoUsers: User[] = [
  UserSchema.parse({
    id: EDITOR_USER_ID,
    email: "mira@roamlog.local",
    emailVerified: true,
    name: "Mira Chen",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-17T01:12:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }),
  UserSchema.parse({
    id: ADMIN_USER_ID,
    email: "wan@roamlog.local",
    emailVerified: true,
    name: "林晚",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-16T13:42:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }),
  UserSchema.parse({
    id: VIEWER_USER_ID,
    email: "gu.nan@roamlog.local",
    emailVerified: true,
    name: "顾南",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-15T08:18:00.000Z",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }),
];

const memberBase = {
  workspaceId: WORKSPACE_ID,
  status: "active" as const,
  invitedById: USER_ID,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

export const demoMembers: WorkspaceMemberWithUser[] = [
  WorkspaceMemberWithUserSchema.parse({
    ...memberBase,
    id: OWNER_MEMBER_ID,
    userId: USER_ID,
    role: "owner",
    joinedAt: "2024-03-18T02:00:00.000Z",
    user: {
      id: USER_ID,
      email: "lin.mo@roamlog.local",
      emailVerified: true,
      name: "林墨",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: "2026-11-17T01:18:42.000Z",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      deletedAt: null,
    },
  }),
  WorkspaceMemberWithUserSchema.parse({
    ...memberBase,
    id: EDITOR_MEMBER_ID,
    userId: EDITOR_USER_ID,
    role: "editor",
    joinedAt: "2024-04-02T04:30:00.000Z",
    user: demoUsers[0],
  }),
  WorkspaceMemberWithUserSchema.parse({
    ...memberBase,
    id: ADMIN_MEMBER_ID,
    userId: ADMIN_USER_ID,
    role: "admin",
    joinedAt: "2025-01-11T09:15:00.000Z",
    user: demoUsers[1],
  }),
  WorkspaceMemberWithUserSchema.parse({
    ...memberBase,
    id: VIEWER_MEMBER_ID,
    userId: VIEWER_USER_ID,
    role: "viewer",
    joinedAt: "2026-09-08T08:00:00.000Z",
    user: demoUsers[2],
  }),
];

export const demoInvitations: Invitation[] = [
  InvitationSchema.parse({
    id: fixtureId(40),
    workspaceId: WORKSPACE_ID,
    email: "sora@roamlog.local",
    role: "editor",
    invitedById: USER_ID,
    expiresAt: "2026-11-22T03:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: "2026-11-15T03:00:00.000Z",
  }),
  InvitationSchema.parse({
    id: fixtureId(41),
    workspaceId: WORKSPACE_ID,
    email: "daniel@atelier.co",
    role: "viewer",
    invitedById: ADMIN_USER_ID,
    expiresAt: "2026-11-21T06:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: "2026-11-12T06:00:00.000Z",
  }),
];

interface EntrySeed {
  tripId: string;
  title: string;
  date: string;
  location: string;
  mood: JournalEntry["mood"];
  weather: JournalEntry["weather"];
  excerpt: string;
  body: string;
  tags: string[];
  favorite?: boolean;
  createdById?: string;
}

const entrySeeds: EntrySeed[] = [
  {
    tripId: KYOTO_TRIP_ID,
    title: "在哲学之道走到天黑",
    date: "2026-11-15",
    location: "京都 · 哲学之道",
    mood: "calm",
    weather: "cloudy",
    excerpt: "雨停以后，琵琶湖疏水的水面像一张没有写完的信纸。",
    body: "雨是下午三点停的。我们从银阁寺往下走，沿途的店陆续关门，只剩水声和鞋底碰到石板的轻响。Mira 在拐角处找到一家汤豆腐店，说下次一定要进去坐很久。",
    tags: ["京都", "散步", "雨天"],
    favorite: true,
    createdById: VIEWER_USER_ID,
  },
  {
    tripId: KYOTO_TRIP_ID,
    title: "锦市场的第一杯咖啡",
    date: "2026-11-14",
    location: "京都 · 锦市场",
    mood: "happy",
    weather: "sunny",
    excerpt: "在开门前的市场里，先喝到一杯带柚子香的浅烘。",
    body: "七点半的锦市场还没有游客。店主把第一壶手冲放在木台上，问我们是不是从上海来。杯口有很轻的柚子香，后来一整天都没有再找到同样的味道。",
    tags: ["咖啡", "市场"],
    createdById: EDITOR_USER_ID,
  },
  {
    tripId: KYOTO_TRIP_ID,
    title: "把行李先寄去大阪",
    date: "2026-11-13",
    location: "京都站",
    mood: "reflective",
    weather: "rain",
    excerpt: "轻装以后，临时改变路线这件事终于变得容易。",
    body: "在京都站把大箱子寄去大阪，只留一个帆布包。雨下得很密，我们决定不去伏见稻荷，改在车站地下街吃一碗热乌冬。计划被改掉的那一刻，旅行才真正开始。",
    tags: ["计划", "行李"],
  },
  {
    tripId: KYOTO_TRIP_ID,
    title: "南禅寺的清晨",
    date: "2026-11-12",
    location: "京都 · 南禅寺",
    mood: "awe",
    weather: "fog",
    excerpt: "三门前的雾散得很慢，石阶像刚刚被人擦过。",
    body: "六点二十到南禅寺，雾还没散。水道桥上的青苔吸饱了夜里的水，整条石阶都是亮的。我们没有说话，只在门前站到第一班公交经过。",
    tags: ["寺院", "清晨"],
    favorite: true,
  },
  {
    tripId: ICELAND_TRIP_ID,
    title: "风把车门吹开",
    date: "2026-08-03",
    location: "冰岛 · 维克",
    mood: "awe",
    weather: "wind",
    excerpt: "黑沙滩上的风大到让人怀疑自己是不是站错了方向。",
    body: "车刚停稳，侧门就被风掀开。我们花了五分钟才把它关上。黑沙滩的浪从雾里推过来，鞋里全是沙。回程路上谁都没说话，只把暖气开到最大。",
    tags: ["冰岛", "黑沙滩", "公路"],
    favorite: true,
    createdById: EDITOR_USER_ID,
  },
  {
    tripId: ICELAND_TRIP_ID,
    title: "在冰川湖边等到蓝调",
    date: "2026-08-05",
    location: "杰古沙龙冰河湖",
    mood: "calm",
    weather: "cloudy",
    excerpt: "浮冰一块一块推向海边，像一场没有终点的缓慢退潮。",
    body: "下午的湖面是铅灰色，冰块被浪推来推去，碰撞声很轻。太阳落下去以后，整片湖忽然变成深蓝。顾南把三脚架收了又架，最后我们只是站着看完。",
    tags: ["冰川", "蓝调"],
    createdById: VIEWER_USER_ID,
  },
  {
    tripId: ICELAND_TRIP_ID,
    title: "一号公路第 417 公里",
    date: "2026-08-07",
    location: "冰岛 · 米湖",
    mood: "tired",
    weather: "rain",
    excerpt: "开过第九个加油站以后，雨刷和电台都开始有节奏。",
    body: "今天开了七个半小时。中途在一间没有招牌的加油站吃羊肉汤，店员说前面的山口可能有横风。我们在雨里把速度降到六十，直到看见米湖的路牌。",
    tags: ["自驾", "雨"],
  },
  {
    tripId: ICELAND_TRIP_ID,
    title: "雷克雅未克的最后一杯热巧",
    date: "2026-08-12",
    location: "雷克雅未克 · 老港",
    mood: "reflective",
    weather: "sunny",
    excerpt: "回程前，港口的风终于肯停下来一会儿。",
    body: "最后一天没有安排。我们在老港旁边的咖啡馆坐到中午，把没写完的明信片补齐。热巧太甜，窗外的船一直没动。回机场前，林晚买了两包海盐巧克力。",
    tags: ["港口", "归途"],
    createdById: ADMIN_USER_ID,
  },
  {
    tripId: LISBON_TRIP_ID,
    title: "辛特拉的雾比宫殿更早到",
    date: "2026-05-14",
    location: "辛特拉 · 佩纳宫",
    mood: "calm",
    weather: "fog",
    excerpt: "山上什么也看不见，只有树和别人的脚步声。",
    body: "从里斯本坐第一班火车到辛特拉，雾一路跟着我们上山。佩纳宫的红墙在雾里只剩一个轮廓。我们在花园里绕了很久，最后觉得这比看清宫殿更好。",
    tags: ["辛特拉", "雾"],
    favorite: true,
  },
  {
    tripId: LISBON_TRIP_ID,
    title: "阿尔法玛的坡道练习",
    date: "2026-05-12",
    location: "里斯本 · 阿尔法玛",
    mood: "happy",
    weather: "sunny",
    excerpt: "没赶上有轨电车，索性沿着坡道一路走到河边。",
    body: "28 路电车挤满人，我们决定走路。白墙上的瓷砖被下午的光照得发亮，每个拐角都有一家开着门的小店。走到商业广场时，脚已经酸了，但还是觉得值。",
    tags: ["步行", "旧城"],
    createdById: ADMIN_USER_ID,
  },
  {
    tripId: LISBON_TRIP_ID,
    title: "在海边把晚餐吃成夜宵",
    date: "2026-05-10",
    location: "卡斯凯什",
    mood: "excited",
    weather: "sunny",
    excerpt: "本来只想看日落，最后坐到餐厅收椅子。",
    body: "从里斯本坐火车到卡斯凯什，赶上最后一段日落。海边的餐厅没有菜单，老板直接把当天有的鱼写在纸上。我们吃了烤沙丁鱼和很酸的绿酒，回程火车已经过了零点。",
    tags: ["海岸", "晚餐"],
  },
  {
    tripId: SEOUL_TRIP_ID,
    title: "雨里的北村，和一杯太烫的拿铁",
    date: "2026-11-16",
    location: "首尔 · 北村",
    mood: "calm",
    weather: "rain",
    excerpt: "屋檐下躲雨十五分钟，顺便把整条巷子看了个够。",
    body: "从安国站出来就开始下雨。北村的坡道比照片更陡，屋檐一间挨着一间。我们在一个小画廊门口躲雨，里面的人递来两杯热水，说不用买票也可以坐。",
    tags: ["首尔", "雨", "巷子"],
    favorite: true,
  },
  {
    tripId: SEOUL_TRIP_ID,
    title: "广藏市场的第一口",
    date: "2026-11-15",
    location: "首尔 · 广藏市场",
    mood: "excited",
    weather: "cloudy",
    excerpt: "在灯光和蒸汽之间，决定把晚餐分成三次。",
    body: "绿豆煎饼、拌饭、刀削面，最后又加了一份生拌牛肉。摊主看我们拍照，笑着把盘子往灯下推。吃完走出来，衣服上全是油和蒜的味道。",
    tags: ["市场", "美食"],
    createdById: EDITOR_USER_ID,
  },
  {
    tripId: SEOUL_TRIP_ID,
    title: "圣水洞的深夜咖啡",
    date: "2026-11-14",
    location: "首尔 · 圣水洞",
    mood: "reflective",
    weather: "sunny",
    excerpt: "工作邮件关掉以后，街上只剩烘豆机的声音。",
    body: "晚上十点，圣水洞的店还开着。我们坐在窗边，把明天要改的方案写在纸巾上。隔壁桌在讨论一首歌，咖啡师把灯调暗了一档。",
    tags: ["咖啡", "工作"],
  },
  {
    tripId: PATAGONIA_TRIP_ID,
    title: "先记下：我想在巴塔哥尼亚走一次 W 线",
    date: "2026-10-22",
    location: "百内国家公园",
    mood: "excited",
    weather: "wind",
    excerpt: "还没有订机票，先把想看的风写进愿望清单。",
    body: "Mira 发来一组百内的照片。三月的风、冰川和没有尽头的步道。我们查了签证和徒步许可，决定先把 2027 年 2 月空出来。",
    tags: ["愿望清单", "徒步"],
    favorite: true,
    createdById: EDITOR_USER_ID,
  },
  {
    tripId: PATAGONIA_TRIP_ID,
    title: "装备清单的第一版",
    date: "2026-10-25",
    location: "上海",
    mood: "reflective",
    weather: "rain",
    excerpt: "把冲锋衣、睡袋和离线地图放进同一张表。",
    body: "顾南把借来的登山杖送来，顺便留下一份装备表。我们删掉了太多重复的衣物，又把头灯加回去。真正出发前，这张表还会改很多次。",
    tags: ["准备", "装备"],
    createdById: VIEWER_USER_ID,
  },
];

export const demoEntries: JournalEntry[] = entrySeeds.map((entry, index) =>
  JournalEntrySchema.parse({
    id: fixtureId(200 + index),
    tripId: entry.tripId,
    workspaceId: WORKSPACE_ID,
    title: entry.title,
    date: entry.date,
    location: entry.location,
    lat: null,
    lng: null,
    mood: entry.mood,
    weather: entry.weather,
    contentJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: entry.body }] }],
    },
    contentHtml: `<p>${entry.body}</p>`,
    excerpt: entry.excerpt,
    tags: entry.tags,
    favorite: entry.favorite ?? false,
    version: 1 + (index % 4),
    createdById: entry.createdById ?? USER_ID,
    updatedById: entry.createdById ?? USER_ID,
    createdAt: "2026-10-01T02:00:00.000Z",
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }),
);

export const demoMedia: Media[] = Array.from({ length: 28 }, (_, index) => {
  const entry = demoEntries[index % demoEntries.length]!;
  return MediaSchema.parse({
    id: fixtureId(300 + index),
    workspaceId: WORKSPACE_ID,
    tripId: entry.tripId,
    uploaderId: index % 3 === 0 ? EDITOR_USER_ID : USER_ID,
    bucket: "roamlog-local",
    key: `fixtures/${entry.tripId}/frame-${String(index + 1).padStart(2, "0")}.jpg`,
    mimeType: "image/jpeg",
    size: 1_280_000 + index * 12_000,
    width: 1600,
    height: 1067,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: index % 4 === 0 ? entry.excerpt : entry.location,
    date: entry.date,
    location: entry.location,
    createdAt: "2026-10-01T02:00:00.000Z",
    updatedAt: UPDATED_AT,
    deletedAt: null,
  });
});

const itinerarySeeds: Array<{
  tripId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  type: ItineraryItem["type"];
  location: string;
  done?: boolean;
  assigneeId?: string;
  notes?: string;
}> = [
  {
    tripId: SEOUL_TRIP_ID,
    date: "2026-11-17",
    startTime: "09:30",
    endTime: "11:30",
    title: "北村韩屋村与三清洞",
    type: "activity",
    location: "钟路区",
    done: true,
    assigneeId: EDITOR_USER_ID,
  },
  {
    tripId: SEOUL_TRIP_ID,
    date: "2026-11-17",
    startTime: "18:30",
    endTime: "20:00",
    title: "广藏市场晚餐",
    type: "food",
    location: "广藏市场",
    notes: "避开 19:00 的人流高峰。",
  },
  {
    tripId: SEOUL_TRIP_ID,
    date: "2026-11-18",
    startTime: "08:10",
    endTime: "10:45",
    title: "首尔站 → 釜山",
    type: "transit",
    location: "首尔站",
    assigneeId: ADMIN_USER_ID,
  },
  {
    tripId: SEOUL_TRIP_ID,
    date: "2026-11-19",
    startTime: "16:00",
    endTime: "18:30",
    title: "海云台与广安里",
    type: "activity",
    location: "海云台",
  },
  {
    tripId: KYOTO_TRIP_ID,
    date: "2026-11-14",
    startTime: "07:30",
    endTime: "10:00",
    title: "南禅寺清晨散步",
    type: "activity",
    location: "南禅寺",
    done: true,
  },
  {
    tripId: KYOTO_TRIP_ID,
    date: "2026-11-15",
    startTime: "13:00",
    endTime: "16:00",
    title: "奈良旧书街与东大寺",
    type: "activity",
    location: "奈良",
    assigneeId: VIEWER_USER_ID,
  },
  {
    tripId: ICELAND_TRIP_ID,
    date: "2026-08-03",
    startTime: "09:00",
    endTime: "12:00",
    title: "雷克雅未克取车",
    type: "transit",
    location: "Keflavík",
    done: true,
  },
  {
    tripId: LISBON_TRIP_ID,
    date: "2026-05-12",
    startTime: "10:30",
    endTime: "12:00",
    title: "阿尔法玛旧城步行",
    type: "activity",
    location: "Alfama",
    done: true,
  },
];

export const demoItineraryItems: ItineraryItem[] = itinerarySeeds.map((item, index) =>
  ItineraryItemSchema.parse({
    id: fixtureId(400 + index),
    tripId: item.tripId,
    workspaceId: WORKSPACE_ID,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    title: item.title,
    type: item.type,
    location: item.location,
    notes: item.notes ?? "",
    done: item.done ?? false,
    order: index,
    assigneeId: item.assigneeId ?? null,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: SEED_TIME,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }),
);

const stopSeeds: Array<{
  tripId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  startDate: string;
  endDate: string;
}> = [
  { tripId: SEOUL_TRIP_ID, city: "首尔", country: "韩国", countryCode: "KR", lat: 37.5665, lng: 126.978, startDate: "2026-11-16", endDate: "2026-11-18" },
  { tripId: SEOUL_TRIP_ID, city: "釜山", country: "韩国", countryCode: "KR", lat: 35.1796, lng: 129.0756, startDate: "2026-11-18", endDate: "2026-11-21" },
  { tripId: KYOTO_TRIP_ID, city: "京都", country: "日本", countryCode: "JP", lat: 35.0116, lng: 135.7681, startDate: "2026-11-12", endDate: "2026-11-18" },
  { tripId: KYOTO_TRIP_ID, city: "奈良", country: "日本", countryCode: "JP", lat: 34.6851, lng: 135.8048, startDate: "2026-11-15", endDate: "2026-11-15" },
  { tripId: ICELAND_TRIP_ID, city: "雷克雅未克", country: "冰岛", countryCode: "IS", lat: 64.1466, lng: -21.9426, startDate: "2026-08-02", endDate: "2026-08-04" },
  { tripId: ICELAND_TRIP_ID, city: "维克", country: "冰岛", countryCode: "IS", lat: 63.4187, lng: -19.006, startDate: "2026-08-04", endDate: "2026-08-06" },
  { tripId: LISBON_TRIP_ID, city: "里斯本", country: "葡萄牙", countryCode: "PT", lat: 38.7223, lng: -9.1393, startDate: "2026-05-10", endDate: "2026-05-14" },
  { tripId: LISBON_TRIP_ID, city: "辛特拉", country: "葡萄牙", countryCode: "PT", lat: 38.8029, lng: -9.3817, startDate: "2026-05-14", endDate: "2026-05-16" },
  { tripId: AMALFI_TRIP_ID, city: "索伦托", country: "意大利", countryCode: "IT", lat: 40.6263, lng: 14.3758, startDate: "2027-09-10", endDate: "2027-09-18" },
  { tripId: PATAGONIA_TRIP_ID, city: "百内", country: "智利", countryCode: "CL", lat: -50.9423, lng: -73.4068, startDate: "2027-02-10", endDate: "2027-02-24" },
];

export const demoStops: Stop[] = stopSeeds.map((stop, index) =>
  StopSchema.parse({
    id: fixtureId(500 + index),
    workspaceId: WORKSPACE_ID,
    notes: `${stop.city} 的停留与路线。`,
    order: index,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: SEED_TIME,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...stop,
  }),
);

interface ExpenseSeed {
  tripId: string;
  date: string;
  category: ExpenseWithSplits["category"];
  note: string;
  amountMinor: number;
  paidById: string;
}

const expenseSeeds: ExpenseSeed[] = [
  { tripId: SEOUL_TRIP_ID, date: "2026-11-16", category: "food", note: "广藏市场晚餐", amountMinor: 68000, paidById: USER_ID },
  { tripId: SEOUL_TRIP_ID, date: "2026-11-16", category: "transport", note: "仁川机场快线", amountMinor: 42000, paidById: EDITOR_USER_ID },
  { tripId: SEOUL_TRIP_ID, date: "2026-11-16", category: "stay", note: "麻浦酒店三晚", amountMinor: 198000, paidById: USER_ID },
  { tripId: SEOUL_TRIP_ID, date: "2026-11-15", category: "food", note: "圣水洞咖啡", amountMinor: 18200, paidById: ADMIN_USER_ID },
  { tripId: SEOUL_TRIP_ID, date: "2026-11-15", category: "activity", note: "首尔塔门票", amountMinor: 17000, paidById: USER_ID },
  { tripId: KYOTO_TRIP_ID, date: "2026-11-14", category: "stay", note: "祇园町家两晚", amountMinor: 386000, paidById: USER_ID },
  { tripId: KYOTO_TRIP_ID, date: "2026-11-14", category: "transport", note: "京都地铁与巴士", amountMinor: 48000, paidById: EDITOR_USER_ID },
  { tripId: KYOTO_TRIP_ID, date: "2026-11-13", category: "food", note: "汤豆腐与清酒", amountMinor: 126000, paidById: ADMIN_USER_ID },
  { tripId: KYOTO_TRIP_ID, date: "2026-11-12", category: "activity", note: "寺院共通券", amountMinor: 76000, paidById: USER_ID },
  { tripId: KYOTO_TRIP_ID, date: "2026-11-15", category: "shopping", note: "旧书店与纸品", amountMinor: 184000, paidById: VIEWER_USER_ID },
  { tripId: ICELAND_TRIP_ID, date: "2026-08-03", category: "transport", note: "环岛租车与保险", amountMinor: 1_280_000, paidById: USER_ID },
  { tripId: ICELAND_TRIP_ID, date: "2026-08-04", category: "stay", note: "维克民宿两晚", amountMinor: 820_000, paidById: EDITOR_USER_ID },
  { tripId: ICELAND_TRIP_ID, date: "2026-08-06", category: "food", note: "加油站羊肉汤", amountMinor: 168_000, paidById: USER_ID },
  { tripId: ICELAND_TRIP_ID, date: "2026-08-08", category: "activity", note: "冰川湖船票", amountMinor: 420_000, paidById: ADMIN_USER_ID },
  { tripId: LISBON_TRIP_ID, date: "2026-05-10", category: "food", note: "卡斯凯什海边晚餐", amountMinor: 186_000, paidById: ADMIN_USER_ID },
  { tripId: LISBON_TRIP_ID, date: "2026-05-11", category: "transport", note: "辛特拉往返火车", amountMinor: 52_000, paidById: USER_ID },
  { tripId: LISBON_TRIP_ID, date: "2026-05-12", category: "stay", note: "阿尔法玛公寓", amountMinor: 430_000, paidById: USER_ID },
  { tripId: AMALFI_TRIP_ID, date: "2026-10-18", category: "activity", note: "众神之路向导订金", amountMinor: 300_000, paidById: EDITOR_USER_ID },
  { tripId: PATAGONIA_TRIP_ID, date: "2026-10-25", category: "other", note: "徒步许可预登记", amountMinor: 120_000, paidById: USER_ID },
  { tripId: PATAGONIA_TRIP_ID, date: "2026-10-26", category: "shopping", note: "离线地图与头灯", amountMinor: 92000, paidById: VIEWER_USER_ID },
];

export const demoExpenses: ExpenseWithSplits[] = expenseSeeds.map((expense, index) => {
  const participantIds = [...new Set([USER_ID, EDITOR_USER_ID, ADMIN_USER_ID, expense.paidById])];
  return ExpenseWithSplitsSchema.parse({
    id: fixtureId(600 + index),
    workspaceId: WORKSPACE_ID,
    tripId: expense.tripId,
    date: expense.date,
    category: expense.category,
    note: expense.note,
    amountMinor: expense.amountMinor,
    currency: "CNY",
    paidById: expense.paidById,
    splitMode: "equal",
    receiptMediaId: null,
    createdById: expense.paidById,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    participants: splitEqualAmount(expense.amountMinor, participantIds, expense.paidById).map(
      (participant) => ({
        workspaceId: WORKSPACE_ID,
        expenseId: fixtureId(600 + index),
        userId: participant.userId,
        shareAmountMinor: participant.shareAmountMinor,
      }),
    ),
  });
});

const packingSeeds: Array<{
  tripId: string;
  category: PackingItem["category"];
  name: string;
  quantity?: number;
  packed?: boolean;
  assigneeId?: string;
}> = [
  { tripId: SEOUL_TRIP_ID, category: "documents", name: "护照", quantity: 1 },
  { tripId: SEOUL_TRIP_ID, category: "documents", name: "机票与酒店确认单", quantity: 1, packed: true },
  { tripId: SEOUL_TRIP_ID, category: "clothing", name: "轻薄羽绒", quantity: 1, packed: true, assigneeId: EDITOR_USER_ID },
  { tripId: SEOUL_TRIP_ID, category: "clothing", name: "步行鞋", quantity: 1 },
  { tripId: SEOUL_TRIP_ID, category: "gear", name: "相机与 35mm 镜头", quantity: 1, packed: true },
  { tripId: SEOUL_TRIP_ID, category: "gear", name: "充电宝", quantity: 1 },
  { tripId: SEOUL_TRIP_ID, category: "health", name: "常用药", quantity: 1 },
  { tripId: SEOUL_TRIP_ID, category: "other", name: "折叠购物袋", quantity: 2 },
  { tripId: KYOTO_TRIP_ID, category: "documents", name: "护照", quantity: 1, packed: true },
  { tripId: KYOTO_TRIP_ID, category: "clothing", name: "防风外套", quantity: 1 },
  { tripId: KYOTO_TRIP_ID, category: "clothing", name: "围巾", quantity: 1, packed: true },
  { tripId: KYOTO_TRIP_ID, category: "gear", name: "胶片相机", quantity: 1 },
  { tripId: KYOTO_TRIP_ID, category: "gear", name: "备用胶卷", quantity: 5 },
  { tripId: KYOTO_TRIP_ID, category: "health", name: "暖宝宝", quantity: 6 },
  { tripId: KYOTO_TRIP_ID, category: "other", name: "寺庙御朱印册", quantity: 1 },
  { tripId: KYOTO_TRIP_ID, category: "other", name: "环保水杯", quantity: 1, packed: true },
  { tripId: ICELAND_TRIP_ID, category: "documents", name: "驾照翻译件", quantity: 1, packed: true },
  { tripId: ICELAND_TRIP_ID, category: "clothing", name: "防水冲锋衣", quantity: 1, packed: true },
  { tripId: ICELAND_TRIP_ID, category: "clothing", name: "羊毛底层", quantity: 3, packed: true },
  { tripId: ICELAND_TRIP_ID, category: "gear", name: "头灯", quantity: 1, packed: true },
  { tripId: ICELAND_TRIP_ID, category: "gear", name: "离线地图", quantity: 1 },
  { tripId: ICELAND_TRIP_ID, category: "health", name: "晕车药", quantity: 1 },
  { tripId: LISBON_TRIP_ID, category: "clothing", name: "轻便雨衣", quantity: 1, packed: true },
  { tripId: LISBON_TRIP_ID, category: "clothing", name: "舒适凉鞋", quantity: 1, packed: true },
  { tripId: LISBON_TRIP_ID, category: "gear", name: "广角镜头", quantity: 1 },
  { tripId: LISBON_TRIP_ID, category: "other", name: "可重复使用水壶", quantity: 1 },
  { tripId: PATAGONIA_TRIP_ID, category: "gear", name: "登山杖", quantity: 2 },
  { tripId: PATAGONIA_TRIP_ID, category: "gear", name: "睡袋内胆", quantity: 1 },
  { tripId: PATAGONIA_TRIP_ID, category: "clothing", name: "硬壳裤", quantity: 1 },
  { tripId: PATAGONIA_TRIP_ID, category: "health", name: "高倍防晒", quantity: 1 },
  { tripId: AMALFI_TRIP_ID, category: "clothing", name: "徒步鞋", quantity: 1 },
  { tripId: AMALFI_TRIP_ID, category: "gear", name: "轻量背包", quantity: 1 },
  { tripId: AMALFI_TRIP_ID, category: "other", name: "防晒帽", quantity: 1 },
];

export const demoPackingItems: PackingItem[] = packingSeeds.map((item, index) =>
  PackingItemSchema.parse({
    id: fixtureId(700 + index),
    workspaceId: WORKSPACE_ID,
    tripId: item.tripId,
    category: item.category,
    name: item.name,
    quantity: item.quantity ?? 1,
    packed: item.packed ?? false,
    assigneeId: item.assigneeId ?? null,
    order: index,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: SEED_TIME,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    version: 1,
  }),
);

export const demoComments: Comment[] = [
  { entryId: demoEntries[0]!.id, tripId: KYOTO_TRIP_ID, authorId: EDITOR_USER_ID, body: "汤豆腐那家店叫什么？我想加进行程。", createdAt: "2026-11-15T09:20:00.000Z" },
  { entryId: demoEntries[0]!.id, tripId: KYOTO_TRIP_ID, authorId: USER_ID, body: "我把店名补在日志末尾了，周三去刚好。", createdAt: "2026-11-15T10:02:00.000Z" },
  { entryId: demoEntries[1]!.id, tripId: KYOTO_TRIP_ID, authorId: VIEWER_USER_ID, body: "柚子香那杯听起来太好了。", createdAt: "2026-11-14T08:15:00.000Z" },
  { entryId: demoEntries[4]!.id, tripId: ICELAND_TRIP_ID, authorId: ADMIN_USER_ID, body: "风把车门吹开这件事我要记一辈子。", createdAt: "2026-08-04T11:44:00.000Z" },
  { entryId: demoEntries[4]!.id, tripId: ICELAND_TRIP_ID, authorId: EDITOR_USER_ID, body: "下次记得停车时把车门朝背风面。", createdAt: "2026-08-04T14:10:00.000Z" },
  { entryId: demoEntries[6]!.id, tripId: ICELAND_TRIP_ID, authorId: VIEWER_USER_ID, body: "第七个加油站的地图能发我吗？", createdAt: "2026-08-08T07:30:00.000Z" },
  { entryId: demoEntries[11]!.id, tripId: SEOUL_TRIP_ID, authorId: EDITOR_USER_ID, body: "北村那家小画廊还开着吗？", createdAt: "2026-11-16T10:45:00.000Z" },
  { entryId: demoEntries[14]!.id, tripId: PATAGONIA_TRIP_ID, authorId: VIEWER_USER_ID, body: "W 线 +1。二月我可以请一周假。", createdAt: "2026-10-22T12:20:00.000Z" },
].map((comment, index) => {
  const { entryId, ...rest } = comment;
  return CommentSchema.parse({
    id: fixtureId(800 + index),
    workspaceId: WORKSPACE_ID,
    targetType: "journal_entry",
    targetId: entryId,
    parentId: null,
    resolvedAt: null,
    resolvedById: null,
    updatedAt: comment.createdAt,
    deletedAt: null,
    ...rest,
  });
});

const activitySeeds: Array<{
  tripId?: string | null;
  actorId: string;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}> = [
  { tripId: KYOTO_TRIP_ID, actorId: EDITOR_USER_ID, verb: "commented", entityType: "journal_entry", entityId: demoEntries[0]!.id, metadata: { title: demoEntries[0]!.title }, createdAt: "2026-11-17T01:02:00.000Z" },
  { tripId: SEOUL_TRIP_ID, actorId: USER_ID, verb: "completed_itinerary", entityType: "itinerary_item", entityId: demoItineraryItems[0]!.id, metadata: { title: demoItineraryItems[0]!.title }, createdAt: "2026-11-17T00:44:00.000Z" },
  { tripId: SEOUL_TRIP_ID, actorId: ADMIN_USER_ID, verb: "expensed", entityType: "expense", entityId: demoExpenses[1]!.id, metadata: { note: demoExpenses[1]!.note, amountMinor: demoExpenses[1]!.amountMinor }, createdAt: "2026-11-16T13:18:00.000Z" },
  { tripId: KYOTO_TRIP_ID, actorId: VIEWER_USER_ID, verb: "created_entry", entityType: "journal_entry", entityId: demoEntries[0]!.id, metadata: { title: demoEntries[0]!.title }, createdAt: "2026-11-16T08:32:00.000Z" },
  { tripId: SEOUL_TRIP_ID, actorId: USER_ID, verb: "uploaded_media", entityType: "media", entityId: demoMedia[0]!.id, metadata: { count: 3 }, createdAt: "2026-11-15T12:05:00.000Z" },
  { tripId: KYOTO_TRIP_ID, actorId: EDITOR_USER_ID, verb: "updated_packing", entityType: "packing_item", entityId: demoPackingItems[9]!.id, metadata: { packed: true }, createdAt: "2026-11-14T03:40:00.000Z" },
  { tripId: KYOTO_TRIP_ID, actorId: USER_ID, verb: "invited_member", entityType: "invitation", entityId: demoInvitations[0]!.id, metadata: { email: demoInvitations[0]!.email }, createdAt: "2026-11-13T06:20:00.000Z" },
  { tripId: ICELAND_TRIP_ID, actorId: ADMIN_USER_ID, verb: "updated_trip", entityType: "trip", entityId: ICELAND_TRIP_ID, metadata: { field: "budget" }, createdAt: "2026-11-12T10:00:00.000Z" },
  { tripId: LISBON_TRIP_ID, actorId: VIEWER_USER_ID, verb: "favorited_entry", entityType: "journal_entry", entityId: demoEntries[8]!.id, metadata: { title: demoEntries[8]!.title }, createdAt: "2026-11-10T09:20:00.000Z" },
  { tripId: PATAGONIA_TRIP_ID, actorId: EDITOR_USER_ID, verb: "created_trip", entityType: "trip", entityId: PATAGONIA_TRIP_ID, metadata: { title: "巴塔哥尼亚穿越" }, createdAt: "2026-11-09T04:00:00.000Z" },
];

export const demoActivities: Activity[] = activitySeeds.map((activity, index) =>
  ActivitySchema.parse({
    id: fixtureId(900 + index),
    workspaceId: WORKSPACE_ID,
    ...activity,
  }),
);

const notificationSeeds: Array<{
  tripId: string | null;
  type: string;
  title: string;
  body: string;
  actorId: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}> = [
  { tripId: KYOTO_TRIP_ID, type: "mention", title: "Mira Chen 在评论里提到了你", body: "「汤豆腐那家店叫什么？我想加进行程。」 ·《在哲学之道走到天黑》", actorId: EDITOR_USER_ID, entityId: demoEntries[0]!.id, readAt: null, createdAt: "2026-11-17T01:02:00.000Z" },
  { tripId: null, type: "invitation", title: "林晚接受了工作区邀请", body: "现在是 Admin，可以邀请成员并管理旅行内容。", actorId: ADMIN_USER_ID, entityId: null, readAt: null, createdAt: "2026-11-16T23:40:00.000Z" },
  { tripId: KYOTO_TRIP_ID, type: "trip_reminder", title: "京都还有 24 天出发", body: "打包清单还剩 5 项，预算已设置。", actorId: null, entityId: KYOTO_TRIP_ID, readAt: null, createdAt: "2026-11-16T09:12:00.000Z" },
  { tripId: ICELAND_TRIP_ID, type: "budget_alert", title: "冰岛预算已用 93%", body: "已支出 ¥31,200 / 预算 ¥33,600。", actorId: null, entityId: ICELAND_TRIP_ID, readAt: null, createdAt: "2026-11-15T18:40:00.000Z" },
  { tripId: SEOUL_TRIP_ID, type: "comment", title: "顾南评论了《雨里的北村》", body: "「那家小画廊还开着吗？」", actorId: VIEWER_USER_ID, entityId: demoEntries[11]!.id, readAt: "2026-11-15T09:00:00.000Z", createdAt: "2026-11-15T07:30:00.000Z" },
  { tripId: KYOTO_TRIP_ID, type: "export", title: "京都行程 PDF 已生成", body: "包含 4 篇日志、2 个行程与 5 笔支出。", actorId: null, entityId: KYOTO_TRIP_ID, readAt: "2026-11-14T12:00:00.000Z", createdAt: "2026-11-14T11:40:00.000Z" },
  { tripId: null, type: "weekly_digest", title: "本周旅行摘要", body: "新增 4 篇日志、3 条评论与 5 笔支出。首尔旅行正在进行。", actorId: null, entityId: null, readAt: null, createdAt: "2026-11-13T00:00:00.000Z" },
  { tripId: ICELAND_TRIP_ID, type: "comment", title: "Mira Chen 回复了你的评论", body: "「下次记得停车时把车门朝背风面。」", actorId: EDITOR_USER_ID, entityId: demoEntries[4]!.id, readAt: "2026-11-12T08:20:00.000Z", createdAt: "2026-11-12T08:00:00.000Z" },
];

export const demoNotifications: Notification[] = notificationSeeds.map((notification, index) =>
  NotificationSchema.parse({
    id: fixtureId(1000 + index),
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    entityType: notification.entityId
      ? notification.type === "mention" || notification.type === "comment"
        ? "journal_entry"
        : notification.type === "trip_reminder" || notification.type === "budget_alert" || notification.type === "export"
          ? "trip"
          : "workspace"
      : null,
    emailedAt: null,
    ...notification,
  }),
);

export const demoContent = {
  users: demoUsers,
  members: demoMembers,
  invitations: demoInvitations,
  entries: demoEntries,
  media: demoMedia,
  itinerary: demoItineraryItems,
  stops: demoStops,
  expenses: demoExpenses,
  packing: demoPackingItems,
  comments: demoComments,
  activities: demoActivities,
  notifications: demoNotifications,
};

