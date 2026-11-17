// 顧客ウィジェットの純粋ロジック（React・Supabase に依存しない。単体テスト対象）

import type { ChatErrorCode, ChatErrorResponse } from "@/types/chat-api";
import type { Message } from "@/types/database";

/** 会話IDを保存する localStorage のキー */
export const CONVERSATION_STORAGE_KEY = "botanica-widget-conversation";

/** iframe の親ページ（widget-embed.js）へ送るメッセージ種別 */
export const EMBED_CLOSE_MESSAGE = "botanica-widget:close";

/**
 * メッセージを id で重複排除して created_at 順に並べる。
 * API レスポンスと Realtime の両方から同じメッセージが届くため、必ずこれを通して state を更新する。
 * created_at が同じ場合は先に届いた順（既存 → 追加分の順）を保つ（Array.prototype.sort は安定ソート）。
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  if (incoming.length === 0) return current as Message[];
  const byId = new Map<string, Message>();
  for (const m of current) byId.set(m.id, m);
  let changed = false;
  for (const m of incoming) {
    if (!byId.has(m.id)) changed = true;
    byId.set(m.id, m);
  }
  if (!changed && incoming.every((m) => current.some((c) => c.id === m.id && c === m))) {
    return current as Message[];
  }
  return [...byId.values()].sort((a, b) => toTime(a.created_at) - toTime(b.created_at));
}

function toTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Enter キーで送信すべきか。
 * - Shift+Enter は改行
 * - 日本語IMEの変換確定の Enter（isComposing、Safari では keyCode 229）では送信しない
 */
export function shouldSubmitOnKeyDown(e: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}

/** API のエラーレスポンスか判定する */
export function isChatErrorResponse(value: unknown): value is ChatErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** HTTP ステータスから推定するエラーコード（本文が JSON でない場合の保険） */
export function errorCodeFromStatus(status: number): ChatErrorCode {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 404:
      return "not_found";
    case 409:
      return "invalid_state";
    case 429:
      return "rate_limited";
    case 503:
      return "ai_unavailable";
    default:
      return "internal";
  }
}

/** エラーコードごとの顧客向け案内文 */
export function errorMessageFor(code: ChatErrorCode | "network"): string {
  switch (code) {
    case "unauthorized":
      return "接続の有効期限が切れました。お手数ですが、もう一度お試しください。";
    case "invalid_request":
      return "メッセージを送信できませんでした。入力内容をご確認ください。";
    case "not_found":
      return "会話が見つかりませんでした。新しい会話として、もう一度送信してください。";
    case "conversation_closed":
      return "この会話は完了しています。新しい会話を始めてください。";
    case "invalid_state":
      return "現在の対応状況ではこの操作はできません。画面を最新の状態に更新しました。";
    case "rate_limited":
      return "送信が集中しています。少し時間をおいてから、もう一度お試しください。";
    case "ai_unavailable":
      return "AIが一時的に応答できません。メッセージは届いています。";
    case "network":
      return "通信に失敗しました。インターネット接続をご確認のうえ、もう一度お試しください。";
    case "internal":
    default:
      return "エラーが発生しました。時間をおいて、もう一度お試しください。";
  }
}

/** localStorage は iframe・プライベートモードで例外になることがあるため必ず try/catch で包む */
export function readStoredConversationId(): string | null {
  try {
    return window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredConversationId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    else window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // 保存できなくても会話は続けられる（再訪時の復元ができないだけ）
  }
}
