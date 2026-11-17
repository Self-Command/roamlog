import type { Trip } from "@roamlog/contracts";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const statusPriority: Record<Trip["status"], number> = {
  active: 0,
  upcoming: 1,
  planning: 2,
  wishlist: 3,
  completed: 4,
};

const statusLabels: Record<Trip["status"], string> = {
  wishlist: "愿望",
  planning: "计划中",
  upcoming: "即将出发",
  active: "在途中",
  completed: "已归来",
};

export function getNextTrip(trips: Trip[]): Trip | undefined {
  return [...trips].sort((left, right) => {
    const statusDifference = statusPriority[left.status] - statusPriority[right.status];
    if (statusDifference !== 0) return statusDifference;
    return left.startDate.localeCompare(right.startDate);
  })[0];
}

export function getTripStatusLabel(status: Trip["status"]): string {
  return statusLabels[status];
}

export function getTripStatusTone(
  status: Trip["status"],
): "neutral" | "orange" | "blue" | "green" | "yellow" | "slate" {
  switch (status) {
    case "active":
      return "green";
    case "upcoming":
      return "orange";
    case "planning":
      return "blue";
    case "wishlist":
      return "yellow";
    case "completed":
      return "slate";
  }
}

export function toCalendarDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = toCalendarDate(startDate);
  const end = toCalendarDate(endDate);
  const startLabel = dateFormatter.format(start);
  const endLabel = dateFormatter.format(end);

  if (start.getFullYear() !== end.getFullYear()) {
    return `${fullDateFormatter.format(start)} – ${fullDateFormatter.format(end)}`;
  }
  return `${startLabel} – ${endLabel}`;
}

export function formatLongDate(date: string): string {
  return fullDateFormatter.format(toCalendarDate(date));
}

export function tripDurationDays(startDate: string, endDate: string): number {
  const start = toCalendarDate(startDate).getTime();
  const end = toCalendarDate(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function daysUntil(date: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = toCalendarDate(date);
  const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.ceil((targetUtc - todayUtc) / 86_400_000);
}

export function formatBudget(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || currency === null) return "未设置";

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function coverClassForTrip(index: number): string {
  return `trip-cover--${["amber", "moss", "ice", "coast", "rose"][index % 5]}`;
}
