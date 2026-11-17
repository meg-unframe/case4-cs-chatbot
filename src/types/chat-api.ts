// =====================================================================
// チャットAPI 共通仕様（顧客UI ⇔ AIバックエンド ⇔ 管理画面）
// 共有基盤。変更は main で行い、各 worktree は rebase で取り込む。
// =====================================================================
//
// 認証: 顧客ウィジェットは Supabase 匿名認証のアクセストークンを
//       `Authorization: Bearer <access_token>` で送る（Cookie は使わない。iframe 埋め込みのため）。
//       サーバーはトークンを Supabase Auth で検証し、auth.uid() を所有者として扱う。
//       ブラウザが送る customer_session_id などの識別子は受け付けない。
//
// 書き込みの分担:
//   - 顧客メッセージ … API がユーザー権限のクライアント（RLS適用）で保存
//   - AIメッセージ・状態遷移 … API が service_role で保存（所有者確認の後）
//   - オペレーターの返信・状態変更 … 管理画面がオペレーターのセッションで直接 Supabase へ（RLS適用）
//
// Realtime: 顧客・オペレーターとも Supabase の postgres_changes を購読する（RLSに従って配信）。
//   - messages: INSERT（filter: conversation_id=eq.<id>）
//   - conversations: UPDATE（status / assigned_operator_id の変化）
// =====================================================================

import type { Conversation, Message } from "./database";

// ---- エンドポイント ---------------------------------------------------

export const CHAT_API = {
  /** POST: 顧客メッセージ送信（会話がなければ作成）→ 必要なら AI 応答 */
  send: "/api/chat",
  /** POST: 顧客からの有人対応リクエスト */
  handoff: "/api/chat/handoff",
  /** GET: 営業時間の状態（認証不要） */
  businessHours: "/api/business-hours",
} as const;

/** 顧客メッセージの最大文字数（DB の上限 4000 字より小さく、API で制限する） */
export const CUSTOMER_MESSAGE_MAX_LENGTH = 1000;

// ---- 共通 -------------------------------------------------------------

export type BusinessHoursInfo = {
  isOpen: boolean;
  /** ISO 8601 */
  nextOpenAt: string;
  /** 例: "11月18日(水) 10:00" */
  nextOpenLabel: string;
};

/**
 * 有人対応に切り替えた理由。
 * - no_answer: FAQ に根拠がなく回答できない
 * - complaint: クレーム・強い不満
 * - complex: 個別の調査・手続きが必要（注文・請求の確認など）
 * - customer_request: 顧客が担当者を希望
 */
export type HandoffReason = "no_answer" | "complaint" | "complex" | "customer_request";

export type HandoffInfo = {
  /** この操作で waiting_operator へ切り替わったか */
  requested: boolean;
  reason: HandoffReason | null;
};

// ---- POST /api/chat ---------------------------------------------------

export type ChatSendRequest = {
  /** 既存会話の ID。省略または null なら新規作成 */
  conversationId?: string | null;
  /** 1〜CUSTOMER_MESSAGE_MAX_LENGTH 文字 */
  message: string;
};

export type ChatSendResponse = {
  conversation: Conversation;
  /** この操作で作成されたメッセージ（顧客メッセージ、続けて AI メッセージがあれば） */
  messages: Message[];
  handoff: HandoffInfo;
  businessHours: BusinessHoursInfo;
};

// 状態ごとの挙動:
//   ai_handling       → FAQ上位3件を根拠に AI が応答。回答不能・クレーム・個別対応は waiting_operator へ
//   waiting_operator  → AI は応答しない（顧客メッセージのみ保存）。オペレーターを待つ
//   operator_handling → AI は応答しない（オペレーターが対応）
//   closed            → 409 conversation_closed（顧客は新しい会話を始める）
// 営業時間外: AI は通常どおり応答する。有人対応へ切り替えるときは
//   「営業時間外のため、翌営業日（nextOpenLabel）以降にオペレーターが対応します」と案内する。

// ---- POST /api/chat/handoff -------------------------------------------

export type ChatHandoffRequest = { conversationId: string };

export type ChatHandoffResponse = {
  conversation: Conversation;
  /** 案内の AI メッセージ（営業時間内／外で文面が変わる） */
  messages: Message[];
  handoff: HandoffInfo;
  businessHours: BusinessHoursInfo;
};

// ---- GET /api/business-hours ------------------------------------------

export type BusinessHoursResponse = BusinessHoursInfo;

// ---- エラー（全エンドポイント共通） ------------------------------------

export type ChatErrorCode =
  | "unauthorized" // 401 トークンなし・無効
  | "invalid_request" // 400 入力不正
  | "not_found" // 404 会話がない／他人の会話
  | "conversation_closed" // 409 完了済みの会話
  | "invalid_state" // 409 状態遷移できない（例: 既に有人対応中）
  | "rate_limited" // 429 送信が多すぎる
  | "ai_unavailable" // 503 AI・埋め込みが一時的に使えない（顧客メッセージは保存済み）
  | "internal"; // 500

export type ChatErrorResponse = {
  error: { code: ChatErrorCode; message: string };
};
