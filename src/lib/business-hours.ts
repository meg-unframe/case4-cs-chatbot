// 営業時間判定（日本時間 10:00〜18:00）。
// 営業時間 10:00〜18:00 は確定。
// 営業日は未確定のため、BUSINESS_DAYS（月〜金）と HOLIDAYS（空）は仮設定。確定後に更新する。

export const BUSINESS_TIMEZONE = "Asia/Tokyo";
export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 18;
/** 0=日 … 6=土 */
export const BUSINESS_DAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
/** 休業日（YYYY-MM-DD, 日本時間）。必要に応じて追加 */
export const HOLIDAYS: ReadonlySet<string> = new Set<string>();

const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // 日本は夏時間なし

type JstParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

function toJst(date: Date): JstParts {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: j.getUTCFullYear(),
    month: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    weekday: j.getUTCDay(),
    hour: j.getUTCHours(),
    minute: j.getUTCMinutes(),
  };
}

function dateKey(p: Pick<JstParts, "year" | "month" | "day">): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isBusinessDay(p: JstParts): boolean {
  return BUSINESS_DAYS.has(p.weekday) && !HOLIDAYS.has(dateKey(p));
}

/** 日本時間の y/m/d h:00 を表す Date */
function jstDate(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour) - JST_OFFSET_MS);
}

export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const p = toJst(now);
  return isBusinessDay(p) && p.hour >= OPEN_HOUR && p.hour < CLOSE_HOUR;
}

/** 次に営業を開始する日時（営業時間内なら当日の開始時刻ではなく now を返す） */
export function getNextOpenAt(now: Date = new Date()): Date {
  if (isWithinBusinessHours(now)) return now;
  const today = toJst(now);
  // 当日の開店前なら当日、それ以外は翌日以降を探す
  const startOffset = isBusinessDay(today) && today.hour < OPEN_HOUR ? 0 : 1;
  for (let i = startOffset; i <= 31; i++) {
    const candidate = jstDate(today.year, today.month, today.day + i, OPEN_HOUR);
    if (isBusinessDay(toJst(candidate))) return candidate;
  }
  throw new Error("31日以内に営業日が見つかりません（BUSINESS_DAYS / HOLIDAYS を確認）");
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function formatJst(date: Date): string {
  const p = toJst(date);
  return `${p.month}月${p.day}日(${WEEKDAY_JA[p.weekday]}) ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export type BusinessHoursStatus = {
  isOpen: boolean;
  nextOpenAt: Date;
  nextOpenLabel: string;
};

export function getBusinessHoursStatus(now: Date = new Date()): BusinessHoursStatus {
  const isOpen = isWithinBusinessHours(now);
  const nextOpenAt = getNextOpenAt(now);
  return { isOpen, nextOpenAt, nextOpenLabel: formatJst(nextOpenAt) };
}
