// 十进制，与 `apps/web/lib/api/media.ts` 的 COVER_MAX_BYTES 与 settings 的 media.maxUploadBytes 口径一致；改动需三处同步。
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Shanghai",
});

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "从未";
  }
  return dateTimeFormatter.format(new Date(value));
}

export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
}

/**
 * Formats byte counts with decimal units (`/1_000`, not `/1_024`) so the same
 * file reads the same here and in `apps/web/components/media`. Values are
 * grouped with the zh-CN separator; MB and above keep one decimal place while
 * the trailing `.0` is dropped, and KB stays integral like the web client. This
 * is display only — thresholds stay in bytes.
 */
export function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1_000 && unitIndex < units.length - 1) {
    size /= 1_000;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: unitIndex >= 2 ? 1 : 0,
  }).format(size)} ${units[unitIndex]}`;
}

export function formatRelativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}
