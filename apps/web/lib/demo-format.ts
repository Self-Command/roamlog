import type { JournalEntry, Mood, Weather } from "@roamlog/contracts";

export const moodLabels: Record<Mood, string> = {
  calm: "平静",
  happy: "开心",
  awe: "敬畏",
  tired: "疲惫",
  reflective: "沉思",
  excited: "兴奋",
};

export const weatherLabels: Record<Weather, string> = {
  sunny: "晴",
  cloudy: "多云",
  rain: "雨",
  snow: "雪",
  wind: "风",
  fog: "雾",
};

export const moodColors: Record<Mood, string> = {
  calm: "bg-accent-blue",
  happy: "bg-accent-yellow",
  awe: "bg-accent-orange",
  tired: "bg-stone",
  reflective: "bg-accent-green",
  excited: "bg-accent-red",
};

export function formatMinor(amountMinor: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

export function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year} / ${month}`;
}

export function entryBody(entry: JournalEntry) {
  const content = entry.contentJson as {
    content?: Array<{ content?: Array<{ text?: string }> }>;
  };
  return (
    content.content
      ?.flatMap((node) => node.content ?? [])
      .map((node) => node.text ?? "")
      .join(" ") || entry.excerpt
  );
}

export function gradientFor(id: string) {
  const palettes = [
    "from-[#25160d] via-[#11100d] to-[#070708]",
    "from-[#0c1822] via-[#0b1117] to-[#070708]",
    "from-[#122019] via-[#0b1210] to-[#070708]",
    "from-[#211015] via-[#121012] to-[#070708]",
    "from-[#1a1710] via-[#12100c] to-[#070708]",
  ];
  const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return palettes[seed % palettes.length]!;
}
