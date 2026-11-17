// 管理画面の純粋関数（ブラウザ・サーバー・テストのどこからでも使える。外部APIは呼ばない）

import type { User } from "@supabase/supabase-js";
import type { Conversation, Message } from "@/types/database";
import { MESSAGE_MAX_LENGTH, type ConversationStatus, type SenderType } from "@/types/domain";

// ---- 型 -----------------------------------------------------------------

/** 一覧の抜粋に使う最新メッセージ */
export type LatestMessage = Pick<Message, "content" | "sender_type" | "created_at">;

/** 一覧の1行 */
export type ConversationListItem = Conversation & { latestMessage: LatestMessage | null };

/** 一覧の状態フィルタ（"all" はすべて） */
export type StatusFilter = "all" | ConversationStatus;

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "waiting_operator", label: "オペレーター待ち" },
  { value: "operator_handling", label: "対応中" },
  { value: "ai_handling", label: "AI対応中" },
  { value: "closed", label: "完了" },
];

/** 一覧に表示する最大件数 */
export const LIST_LIMIT = 100;

export const SENDER_LABELS: Record<SenderType, string> = {
  customer: "顧客",
  ai: "AI",
  operator: "オペレーター",
};

// ---- 権限 ---------------------------------------------------------------

/**
 * オペレーター判定（ブラウザ用）。
 * src/lib/supabase/server.ts の isOperator と同じ条件（app_metadata.role、匿名は不可）。
 * server.ts は "server-only" のためクライアントから import できず、ここで同じ判定を持つ。
 * 最終的な権限判定はサーバー側のガードと RLS が行う。
 */
export function isOperatorUser(user: User | null | undefined): boolean {
  if (!user || user.is_anonymous) return false;
  return user.app_metadata?.role === "operator";
}

// ---- 表示 ---------------------------------------------------------------

/** 顧客ID（匿名UUID）の先頭8桁 */
export function shortCustomerId(customerSessionId: string): string {
  return customerSessionId.replace(/-/g, "").slice(0, 8);
}

/** 抜粋：改行・連続空白を1つにまとめ、max 文字を超えたら「…」で切る */
export function makeExcerpt(content: string, max = 60): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat); // サロゲートペア（絵文字等）を途中で切らない
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : flat;
}

const JST = "Asia/Tokyo";

function jstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** 日時（日本時間）。当日なら「HH:mm」、同年なら「M/D HH:mm」、それ以外は「YYYY/M/D HH:mm」 */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = jstParts(d);
  const n = jstParts(now);
  const time = `${p.hour}:${p.minute}`;
  if (p.year === n.year && p.month === n.month && p.day === n.day) return time;
  if (p.year === n.year) return `${p.month}/${p.day} ${time}`;
  return `${p.year}/${p.month}/${p.day} ${time}`;
}

/** 日時（日本時間）の完全表記「YYYY/M/D HH:mm」 */
export function formatFullDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = jstParts(d);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 担当者の表示（自分なら「自分」） */
export function assigneeLabel(assignedOperatorId: string | null, myId: string): string {
  if (!assignedOperatorId) return "未割当";
  if (assignedOperatorId === myId) return "自分";
  return `他のオペレーター（${assignedOperatorId.slice(0, 8)}）`;
}

// ---- 一覧 ---------------------------------------------------------------

/** 最終更新時刻（最新メッセージ、なければ会話の作成日時）のミリ秒 */
export function lastActivityMs(item: ConversationListItem): number {
  const iso = item.latestMessage?.created_at ?? item.created_at;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** 並び替え：オペレーター待ちを先頭、その中は最終更新が新しい順 */
export function sortConversations(items: readonly ConversationListItem[]): ConversationListItem[] {
  return [...items].sort((a, b) => {
    const aw = a.status === "waiting_operator" ? 0 : 1;
    const bw = b.status === "waiting_operator" ? 0 : 1;
    if (aw !== bw) return aw - bw;
    const diff = lastActivityMs(b) - lastActivityMs(a);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function matchesFilter(status: ConversationStatus, filter: StatusFilter): boolean {
  return filter === "all" || status === filter;
}

/**
 * Realtime の会話 INSERT/UPDATE を一覧に反映する。
 * フィルタに合わなくなった行は外す。最新メッセージは既存の値を保つ。
 */
export function applyConversationChange(
  items: readonly ConversationListItem[],
  row: Conversation,
  filter: StatusFilter,
): ConversationListItem[] {
  const existing = items.find((i) => i.id === row.id);
  const rest = items.filter((i) => i.id !== row.id);
  if (!matchesFilter(row.status, filter)) return rest;
  return [...rest, { ...row, latestMessage: existing?.latestMessage ?? null }];
}

/**
 * Realtime のメッセージ INSERT を一覧の抜粋に反映する。
 * 一覧にない会話なら null（呼び出し側で会話を取得する）。古いメッセージでは上書きしない。
 */
export function applyMessageInsert(
  items: readonly ConversationListItem[],
  message: Message,
): ConversationListItem[] | null {
  const target = items.find((i) => i.id === message.conversation_id);
  if (!target) return null;
  const current = target.latestMessage;
  if (current && new Date(current.created_at).getTime() > new Date(message.created_at).getTime()) {
    return [...items];
  }
  const latestMessage: LatestMessage = {
    content: message.content,
    sender_type: message.sender_type,
    created_at: message.created_at,
  };
  return items.map((i) => (i.id === message.conversation_id ? { ...i, latestMessage } : i));
}

/** 一覧を表示件数に収める（並び替え後に先頭から） */
export function limitList(items: readonly ConversationListItem[], limit = LIST_LIMIT): ConversationListItem[] {
  return sortConversations(items).slice(0, limit);
}

// ---- 詳細 ---------------------------------------------------------------

/** メッセージを id で重複排除し、作成日時の昇順に並べる */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 返信の入力チェック。問題なければ null、あれば日本語のエラー文 */
export function validateReply(content: string): string | null {
  if (content.trim().length === 0) return "メッセージを入力してください。";
  const length = Array.from(content).length;
  if (length > MESSAGE_MAX_LENGTH) {
    return `メッセージは${MESSAGE_MAX_LENGTH}字以内で入力してください（現在${length}字）。`;
  }
  return null;
}

/** 文字数（サロゲートペアを1字として数える。DB の char_length と同じ） */
export function countChars(content: string): number {
  return Array.from(content).length;
}

/** 返信と同時に「対応中＋担当=自分」へ切り替える状態か */
export function shouldTakeOverOnReply(status: ConversationStatus): boolean {
  return status === "waiting_operator" || status === "ai_handling";
}

// ---- エラー -------------------------------------------------------------

type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/** Supabase / PostgREST のエラーを日本語の説明にする（内部の詳細は出さない） */
export function describeDbError(error: DbErrorLike, action: string): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "23514") {
    if (message.includes("conversations_operator_assigned_check")) {
      return `${action}できませんでした。「オペレーター対応中」には担当者の設定が必要です。`;
    }
    if (message.includes("messages_content_length_check")) {
      return `${action}できませんでした。メッセージは1〜${MESSAGE_MAX_LENGTH}字で入力してください。`;
    }
    return `${action}できませんでした。入力内容が制約に違反しています。`;
  }
  if (code === "42501" || code === "PGRST301" || code === "PGRST303") {
    return `${action}できませんでした。権限がないか、ログインの有効期限が切れています。再ログインしてください。`;
  }
  if (code === "PGRST116") {
    return `${action}できませんでした。会話が見つからないか、状態が変わっています。`;
  }
  if (code === "23503") {
    return `${action}できませんでした。会話が見つかりません。`;
  }
  if (/fetch|network/i.test(message)) {
    return `${action}できませんでした。通信エラーです。ネットワークを確認してください。`;
  }
  return `${action}できませんでした。時間をおいて再度お試しください。`;
}
