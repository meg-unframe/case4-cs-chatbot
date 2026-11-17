// チャットAPI（Route Handler）共通の入力検証・レスポンス生成。
// 外部サービスに依存しない純粋な処理なので、単体テストから直接呼べる。

import { getBusinessHoursStatus } from "@/lib/business-hours";
import {
  CUSTOMER_MESSAGE_MAX_LENGTH,
  type BusinessHoursInfo,
  type ChatErrorCode,
  type ChatErrorResponse,
} from "@/types/chat-api";

/** 簡易レート制限: 直近 RATE_LIMIT_WINDOW_MS に RATE_LIMIT_MAX 件以上送っていたら 429 */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 文字数（サロゲートペアを1文字として数える。DB の char_length と同じ） */
export function countChars(text: string): number {
  return Array.from(text).length;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export type ParsedSendRequest = { conversationId: string | null; message: string };

export function parseSendRequest(body: unknown): Result<ParsedSendRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "リクエストの形式が正しくありません。" };
  }
  const b = body as Record<string, unknown>;

  let conversationId: string | null = null;
  if (b.conversationId !== undefined && b.conversationId !== null) {
    if (!isUuid(b.conversationId)) return { ok: false, message: "conversationId の形式が正しくありません。" };
    conversationId = b.conversationId.toLowerCase();
  }

  if (typeof b.message !== "string") return { ok: false, message: "メッセージを入力してください。" };
  const message = b.message.trim();
  if (message === "") return { ok: false, message: "メッセージを入力してください。" };
  if (countChars(message) > CUSTOMER_MESSAGE_MAX_LENGTH) {
    return { ok: false, message: `メッセージは${CUSTOMER_MESSAGE_MAX_LENGTH}文字以内で入力してください。` };
  }
  return { ok: true, value: { conversationId, message } };
}

export function parseHandoffRequest(body: unknown): Result<{ conversationId: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "リクエストの形式が正しくありません。" };
  }
  const id = (body as Record<string, unknown>).conversationId;
  if (!isUuid(id)) return { ok: false, message: "conversationId の形式が正しくありません。" };
  return { ok: true, value: { conversationId: id.toLowerCase() } };
}

export function toBusinessHoursInfo(now: Date = new Date()): BusinessHoursInfo {
  const s = getBusinessHoursStatus(now);
  return { isOpen: s.isOpen, nextOpenAt: s.nextOpenAt.toISOString(), nextOpenLabel: s.nextOpenLabel };
}

const STATUS_BY_CODE: Record<ChatErrorCode, number> = {
  unauthorized: 401,
  invalid_request: 400,
  not_found: 404,
  conversation_closed: 409,
  invalid_state: 409,
  rate_limited: 429,
  ai_unavailable: 503,
  internal: 500,
};

const DEFAULT_MESSAGE: Record<ChatErrorCode, string> = {
  unauthorized: "認証が必要です。ページを再読み込みしてください。",
  invalid_request: "リクエストが正しくありません。",
  not_found: "会話が見つかりません。",
  conversation_closed: "この会話は終了しています。新しい会話を始めてください。",
  invalid_state: "現在の状態ではこの操作はできません。",
  rate_limited: "送信が多すぎます。しばらく待ってから再度お試しください。",
  ai_unavailable: "ただいま自動応答が利用できません。メッセージは受け付けました。時間をおいて再度お試しいただくか、オペレーターへの切り替えをご利用ください。",
  internal: "エラーが発生しました。時間をおいて再度お試しください。",
};

export function errorResponse(code: ChatErrorCode, message?: string): Response {
  const body: ChatErrorResponse = { error: { code, message: message ?? DEFAULT_MESSAGE[code] } };
  return Response.json(body, { status: STATUS_BY_CODE[code], headers: { "Cache-Control": "no-store" } });
}

export function jsonResponse<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** ログ用: 例外から秘密情報・個人情報を含みうる message を除き、種類とコードだけを取り出す */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const extra = e as Error & { status?: unknown; code?: unknown; type?: unknown };
    const parts = [e.name];
    if (typeof extra.status === "number") parts.push(`status=${extra.status}`);
    if (typeof extra.code === "string") parts.push(`code=${extra.code}`);
    if (typeof extra.type === "string") parts.push(`type=${extra.type}`);
    return parts.join(" ");
  }
  // PostgrestError など Error を継承しないオブジェクトは code だけを出す
  if (typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string") {
    return `code=${(e as { code: string }).code}`;
  }
  return "unknown";
}

/** リクエスト本文を JSON として読む。失敗なら undefined */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
