import { seedAssetFiles } from "./assets.js";
import { userIds, workspaceId } from "./core.js";
import {
  tripId,
  trips,
} from "./trips.js";
import type {
  SeedEntry,
  SeedEntryMedia,
  SeedMedia,
  SeedRevision,
} from "./types.js";
import {
  deterministicId,
  timestamp,
  tiptapHtml,
  tiptapParagraphs,
} from "./util.js";

interface EntryDefinition {
  key: string;
  trip: string;
  title: string;
  date: string;
  location: string;
  lat: number;
  lng: number;
  mood: SeedEntry["mood"];
  weather: SeedEntry["weather"];
  paragraphs: string[];
  excerpt: string;
  tags: string[];
  favorite: boolean;
  author: string;
}

const definitions: EntryDefinition[] = [
  {
    key: "kyoto-arrival",
    trip: "kyoto",
    title: "抵达京都，先听见水声",
    date: "2026-11-21",
    location: "京都 · 东山",
    lat: 35.0116,
    lng: 135.7681,
    mood: "calm",
    weather: "cloudy",
    paragraphs: [
      "从关西机场到京都时天已经暗了。拖着箱子拐进小巷，最先听见的不是人声，是旁边水渠的流水。",
      "住处只有六间房，前台把钥匙和一包焙茶一起递过来。今晚不安排任何地方，去便利店买饭团，回来把窗户开一条缝。",
    ],
    excerpt: "拖着箱子拐进小巷，最先听见的不是人声，是旁边水渠的流水。",
    tags: ["抵达", "东山", "慢下来"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "kyoto-nanzenji",
    trip: "kyoto",
    title: "南禅寺的早晨比闹钟更早",
    date: "2026-11-23",
    location: "京都 · 南禅寺",
    lat: 35.011,
    lng: 135.7944,
    mood: "awe",
    weather: "sunny",
    paragraphs: [
      "六点半出门，路上只有送报纸的车。红叶还没有到最满，阳光从檐下斜过来，把石阶照得很薄。",
      "在水路阁旁边站了很久。没有拍照的冲动，只想记住水声和鞋底踩过碎石的声音。回程绕去一家开到中午的小店，吃了一碗热汤面。",
    ],
    excerpt: "阳光从檐下斜过来，把石阶照得很薄。",
    tags: ["南禅寺", "红叶", "清晨"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "kyoto-market",
    trip: "kyoto",
    title: "在锦市场吃到一碗热汤",
    date: "2026-11-25",
    location: "京都 · 锦市场",
    lat: 35.005,
    lng: 135.7649,
    mood: "happy",
    weather: "rain",
    paragraphs: [
      "下午开始下雨，伞沿不停地滴水。锦市场比想象中拥挤，我们没有硬挤，拐进旁边一条更窄的街。",
      "小店只有吧台六个座位，老板娘把汤碗推过来时说了句小心烫。萝卜炖得很软，雨声落在塑料棚上，忽然觉得这趟旅行真正开始了。",
    ],
    excerpt: "萝卜炖得很软，雨声落在塑料棚上，忽然觉得这趟旅行真正开始了。",
    tags: ["锦市场", "雨天", "食物"],
    favorite: false,
    author: userIds.editor,
  },
  {
    key: "seoul-coffee",
    trip: "seoul",
    title: "首尔的第一杯手冲",
    date: "2026-11-15",
    location: "首尔 · 西村",
    lat: 37.5796,
    lng: 126.9707,
    mood: "calm",
    weather: "sunny",
    paragraphs: [
      "会议临时改到线上，于是把上午挪到一家有院子的咖啡馆。店主在烘豆，整条巷子都是焦糖味。",
      "点了一杯水洗耶加，酸得干净。写完待办之后没有立刻走，晒了十分钟太阳。旅行和工作混在一起时，这种没有安排的缝隙最珍贵。",
    ],
    excerpt: "写完待办之后没有立刻走，晒了十分钟太阳。",
    tags: ["首尔", "咖啡馆", "工作旅行"],
    favorite: false,
    author: userIds.editor,
  },
  {
    key: "seoul-han-river",
    trip: "seoul",
    title: "汉江边的临时野餐",
    date: "2026-11-18",
    location: "首尔 · 汉江公园",
    lat: 37.5285,
    lng: 126.9342,
    mood: "happy",
    weather: "wind",
    paragraphs: [
      "便利店买了紫菜包饭、橘子和两罐啤酒。风把一次性桌布吹起来三次，最后用背包压住四个角。",
      "天黑得很快，对岸的灯一盏一盏亮起来。有人在不远处弹吉他，跑调也没关系。我们聊到下一次旅行，结论是先不订返程。",
    ],
    excerpt: "天黑得很快，对岸的灯一盏一盏亮起来。",
    tags: ["汉江", "野餐", "夜"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "iceland-wind",
    trip: "iceland",
    title: "风把车门的计划吹走了",
    date: "2026-08-03",
    location: "冰岛 · 雷克雅未克",
    lat: 64.1466,
    lng: -21.9426,
    mood: "tired",
    weather: "wind",
    paragraphs: [
      "取车比预计多花了一个小时。开出停车场时风已经很大，第一站的金环路线被我们临时取消。",
      "在超市买了面包、酸奶和一大袋咖啡，回旅馆重新排路线。旅行里总要有一次承认：今天不适合赶路。",
    ],
    excerpt: "旅行里总要有一次承认：今天不适合赶路。",
    tags: ["冰岛", "公路旅行", "计划变化"],
    favorite: false,
    author: userIds.owner,
  },
  {
    key: "iceland-black-sand",
    trip: "iceland",
    title: "黑沙滩没有黑色",
    date: "2026-08-06",
    location: "冰岛 · 维克",
    lat: 63.4187,
    lng: -19.006,
    mood: "awe",
    weather: "cloudy",
    paragraphs: [
      "走近海边才发现沙子不是纯黑，是很多层灰、褐和细小的反光。浪比观景牌上写的更靠里，我们没敢走到最前面。",
      "回车里时手套全湿了。暖气开了很久，挡风玻璃上的雾一层层退下去，远处的玄武岩像被海水削出来的墙。",
    ],
    excerpt: "沙子不是纯黑，是很多层灰、褐和细小的反光。",
    tags: ["黑沙滩", "维克", "海浪"],
    favorite: true,
    author: userIds.editor,
  },
  {
    key: "lisbon-tram",
    trip: "lisbon",
    title: "28 路电车经过窗口",
    date: "2026-05-11",
    location: "里斯本 · 阿尔法玛",
    lat: 38.7118,
    lng: -9.1306,
    mood: "calm",
    weather: "sunny",
    paragraphs: [
      "住处没有电梯，提着行李上四楼时后悔了三分钟。但窗户一推开，电车正从坡下上来，黄色车身挤满游客。",
      "下午没有坐车，沿着轨道往下走。每一间店都小得刚好，买了一块蛋挞站在路边吃完，糖粉落在鞋面上。",
    ],
    excerpt: "窗户一推开，电车正从坡下上来，黄色车身挤满游客。",
    tags: ["里斯本", "电车", "阿尔法玛"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "lisbon-sintra",
    trip: "lisbon",
    title: "辛特拉的雾从山脚升起来",
    date: "2026-05-14",
    location: "辛特拉",
    lat: 38.8029,
    lng: -9.3817,
    mood: "reflective",
    weather: "fog",
    paragraphs: [
      "到辛特拉时还看得见山脊，排队坐车上去之后，雾已经把宫殿的塔尖收走了一半。",
      "我们在花园里走了很久，衣服和头发都湿了。回程的巴士上没人说话，窗外的树像慢慢退后的影子。",
    ],
    excerpt: "雾已经把宫殿的塔尖收走了一半。",
    tags: ["辛特拉", "雾", "花园"],
    favorite: false,
    author: userIds.editor,
  },
  {
    key: "santorini-morning",
    trip: "santorini",
    title: "伊亚的清晨不属于游客",
    date: "2025-09-15",
    location: "圣托里尼 · 伊亚",
    lat: 36.4618,
    lng: 25.3753,
    mood: "calm",
    weather: "sunny",
    paragraphs: [
      "七点前出门，巷子里只有收垃圾的车和几只猫。蓝顶还没有被旅行团围住，光从海面反上来，白墙有点晃眼。",
      "买了一杯很浓的希腊咖啡，坐在台阶上等店铺开门。今天的计划只有一件事：不赶日落。",
    ],
    excerpt: "今天的计划只有一件事：不赶日落。",
    tags: ["伊亚", "清晨", "爱琴海"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "santorini-sunset",
    trip: "santorini",
    title: "在费拉看一场没有滤镜的日落",
    date: "2025-09-18",
    location: "圣托里尼 · 费拉",
    lat: 36.4161,
    lng: 25.431,
    mood: "awe",
    weather: "cloudy",
    paragraphs: [
      "云层很厚，本来以为看不到。太阳从云缝里落下去时，整条悬崖步道都安静了几秒。",
      "没有排队拍同款照片，我们靠着矮墙分了一罐啤酒。风把头发吹乱，回旅馆时才发现相机没电了。",
    ],
    excerpt: "太阳从云缝里落下去时，整条悬崖步道都安静了几秒。",
    tags: ["日落", "费拉", "留白"],
    favorite: false,
    author: userIds.editor,
  },
  {
    key: "tokyo-layover",
    trip: "tokyo",
    title: "四十八小时的东京",
    date: "2025-03-03",
    location: "东京 · 新宿",
    lat: 35.6938,
    lng: 139.7034,
    mood: "reflective",
    weather: "rain",
    paragraphs: [
      "因为转机延误，意外多出两天。把大行李寄存，只背一个包去找早场电影。",
      "散场时雨下得很大，沿着神田川走到御茶之水，鞋里全是水。便利店的伞太小，但我们都没有想快一点回去。",
    ],
    excerpt: "散场时雨下得很大，沿着神田川走到御茶之水，鞋里全是水。",
    tags: ["转机", "电影", "东京"],
    favorite: false,
    author: userIds.owner,
  },
  {
    key: "marrakech-medina",
    trip: "marrakech",
    title: "麦地那的颜色会把人绕晕",
    date: "2024-10-07",
    location: "马拉喀什 · 麦地那",
    lat: 31.6295,
    lng: -7.9811,
    mood: "excited",
    weather: "sunny",
    paragraphs: [
      "第一次进麦地那，导航在巷子里彻底失效。一个卖香料的孩子带我们走了十分钟，最后只要了一颗糖。",
      "riad 的门很小，推门之后却是一个有橘子树的院子。屋顶看出去全是土红色的墙，傍晚的祷告声从四面八方叠起来。",
    ],
    excerpt: "riad 的门很小，推门之后却是一个有橘子树的院子。",
    tags: ["马拉喀什", "麦地那", "riad"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "patagonia-blank",
    trip: "patagonia",
    title: "为巴塔哥尼亚留白",
    date: "2027-02-12",
    location: "埃尔卡拉法特",
    lat: -50.3379,
    lng: -72.2648,
    mood: "excited",
    weather: "wind",
    paragraphs: [
      "出发前一年先把这趟旅行写下来，是为了提醒自己不要排得太满。",
      "我们只定下三件事：看冰川、走一段百内、给坏天气留两天。剩下的等到了当地再问旅馆老板。",
    ],
    excerpt: "我们只定下三件事：看冰川、走一段百内、给坏天气留两天。",
    tags: ["计划", "巴塔哥尼亚", "徒步"],
    favorite: true,
    author: userIds.owner,
  },
  {
    key: "amalfi-sorrento",
    trip: "amalfi",
    title: "索伦托的第一晚",
    date: "2027-05-19",
    location: "索伦托",
    lat: 40.6263,
    lng: 14.3758,
    mood: "calm",
    weather: "cloudy",
    paragraphs: [
      "火车到那不勒斯已经很晚，转私铁到索伦托时正好赶上最后一班渡轮进港。",
      "旅馆在悬崖边，房间有个很小的阳台。我们买了柠檬和面包，坐在那里听楼下餐厅收桌子的声音。",
    ],
    excerpt: "我们买了柠檬和面包，坐在那里听楼下餐厅收桌子的声音。",
    tags: ["索伦托", "抵达", "柠檬"],
    favorite: false,
    author: userIds.owner,
  },
  {
    key: "amalfi-path",
    trip: "amalfi",
    title: "众神之路上的柠檬树",
    date: "2027-05-22",
    location: "波西塔诺",
    lat: 40.6281,
    lng: 14.4849,
    mood: "happy",
    weather: "sunny",
    paragraphs: [
      "从博梅拉诺开始走众神之路，前半段一直在云里。转过山脊之后，海岸线突然全部打开。",
      "路边有野生的柠檬树，香气热得像另一种阳光。下到波西塔诺时腿已经发抖，但那杯冰水是我今年喝过最好喝的。",
    ],
    excerpt: "下到波西塔诺时腿已经发抖，但那杯冰水是我今年喝过最好喝的。",
    tags: ["众神之路", "波西塔诺", "徒步"],
    favorite: true,
    author: userIds.editor,
  },
];

export const entryIds = Object.fromEntries(
  definitions.map((definition) => [
    definition.key,
    deterministicId("journal-entry", definition.key),
  ]),
) as Record<string, string>;

export function entryId(key: string): string {
  const id = entryIds[key];
  if (!id) {
    throw new Error(`Unknown entry fixture key: ${key}`);
  }
  return id;
}

export const entries: SeedEntry[] = definitions.map((definition) => ({
  id: entryId(definition.key),
  tripId: tripId(definition.trip),
  workspaceId,
  title: definition.title,
  date: definition.date,
  location: definition.location,
  lat: definition.lat,
  lng: definition.lng,
  mood: definition.mood,
  weather: definition.weather,
  contentJson: tiptapParagraphs(definition.paragraphs),
  contentHtml: tiptapHtml(definition.paragraphs),
  excerpt: definition.excerpt,
  tags: definition.tags,
  favorite: definition.favorite,
  version: 2,
  createdById: definition.author,
  updatedById: definition.author,
  createdAt: timestamp(definition.date, "12:30:00"),
  updatedAt: timestamp(definition.date, "20:10:00"),
  deletedAt: null,
}));

export const revisions: SeedRevision[] = definitions.map((definition) => ({
  id: deterministicId("entry-revision", `${definition.key}:v1`),
  entryId: entryId(definition.key),
  workspaceId,
  version: 1,
  title: definition.title,
  contentJson: tiptapParagraphs(definition.paragraphs.slice(0, 1)),
  contentHtml: tiptapHtml(definition.paragraphs.slice(0, 1)),
  editedById: definition.author,
  createdAt: timestamp(definition.date, "12:35:00"),
}));

const mediaCount = 24;

export const media: SeedMedia[] = Array.from(
  { length: mediaCount },
  (_, index) => {
    const asset = seedAssetFiles[index % seedAssetFiles.length];
    const trip = trips[Math.floor((index * trips.length) / mediaCount)];
    if (!asset || !trip) {
      throw new Error("Seed media fixture generation left a gap");
    }
    const assetBase = asset.fileName.replace(/\.jpg$/u, "");
    const key = `seed/${assetBase}-${String(index + 1).padStart(2, "0")}.jpg`;
    return {
      id: deterministicId("media", `seed-photo-${index + 1}`),
      workspaceId,
      tripId: trip.id,
      uploaderId: trip.createdById,
      bucket: "roamlog-local",
      key,
      mimeType: "image/jpeg",
      size: 180_000 + index * 2_400,
      width: 1200,
      height: 800,
      blurhash: "L9B|v}00~q~qM{ofRjRj00ofRjRj",
      variants: {
        original: {
          key,
          width: 1200,
          height: 800,
        },
      },
      status: "ready",
      error: null,
      caption: `${trip.title} · ${asset.label}`,
      date: trip.startDate,
      location: trip.destinations[0] ?? null,
      assetIndex: index % seedAssetFiles.length,
      assetFileName: asset.fileName,
      createdAt: timestamp(trip.startDate, "06:00:00"),
      updatedAt: timestamp(trip.startDate, "06:05:00"),
      deletedAt: null,
    };
  },
);

const entriesByTrip = new Map<string, SeedEntry[]>();
for (const entry of entries) {
  const existing = entriesByTrip.get(entry.tripId) ?? [];
  existing.push(entry);
  entriesByTrip.set(entry.tripId, existing);
}

const entryMediaOffsets = new Map<string, number>();

export const entryMedia: SeedEntryMedia[] = media.map((item) => {
  const candidates = entriesByTrip.get(item.tripId) ?? [];
  if (candidates.length === 0) {
    throw new Error(`No entry fixture for media trip ${item.tripId}`);
  }
  const offset = entryMediaOffsets.get(item.tripId) ?? 0;
  const entry = candidates[offset % candidates.length];
  if (!entry) {
    throw new Error("Seed entry media fixture generation left a gap");
  }
  entryMediaOffsets.set(item.tripId, offset + 1);
  return {
    workspaceId,
    entryId: entry.id,
    mediaId: item.id,
    order: offset,
  };
});
