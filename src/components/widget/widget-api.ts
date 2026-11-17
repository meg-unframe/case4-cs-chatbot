"use client";

// 顧客ウィジェットの通信処理（チャットAPI・Supabase の参照）。
// 書き込みはすべてチャットAPI経由。Supabase へは RLS の範囲で select のみ行う。

import { ensureWidgetSession, getWidgetSupabaseClient } from "@/lib/supabase/widget-client";
import { getBusinessHoursStatus } from "@/lib/business-hours";
import {
  CHAT_API,
  type BusinessHoursInfo,
  type BusinessHoursResponse,
  type ChatErrorCode,
} from "@/types/chat-api";
import type { Conversation, Message } from "@/types/database";
import { errorCodeFromStatus, isChatErrorResponse } from "./chat-logic";

export type ApiFailureCode = ChatErrorCode | "network";

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ApiFailureCode;
      /** 401 の回復で匿名ユーザーが作り直された（以前の会話は参照できない） */
      sessionReset?: boolean;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 送信直前に最新のアクセストークンを取得する（期限切れなら supabase-js が更新する） */
async function getAccessToken(): Promise<string> {
  const supabase = getWidgetSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const { accessToken } = await ensureWidgetSession();
  return accessToken;
}

/**
 * 401 からの回復。まずトークン更新を試し、だめなら匿名サインインし直す。
 * サインインし直した場合は別ユーザーになるため、以前の会話は RLS で見えなくなる。
 */
async function recoverSession(): Promise<"refreshed" | "reset" | "failed"> {
  const supabase = getWidgetSupabaseClient();
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) return "refreshed";
  } catch {
    // 下で作り直す
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
    await ensureWidgetSession();
    return "reset";
  } catch {
    return "failed";
  }
}

/** チャットAPIへ Bearer トークン付きで POST する。401 は1回だけ回復を試みる */
export async function postChatApi<T>(path: string, body: unknown, retried = false): Promise<ApiResult<T>> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return { ok: false, code: "unauthorized" };
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "network" };
  }

  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    if (json === null) return { ok: false, code: "internal" };
    return { ok: true, data: json as T };
  }

  const code = isChatErrorResponse(json) ? json.error.code : errorCodeFromStatus(res.status);
  if (code === "unauthorized" && !retried) {
    const recovered = await recoverSession();
    if (recovered === "refreshed") return postChatApi<T>(path, body, true);
    return { ok: false, code, sessionReset: recovered === "reset" };
  }
  return { ok: false, code };
}

/** 営業時間（認証不要）。API が使えないときは同じロジックで端末側で計算する */
export async function fetchBusinessHours(): Promise<BusinessHoursInfo> {
  try {
    const res = await fetch(CHAT_API.businessHours, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as BusinessHoursResponse;
      if (typeof data?.isOpen === "boolean" && typeof data.nextOpenLabel === "string") return data;
    }
  } catch {
    // フォールバックへ
  }
  const local = getBusinessHoursStatus();
  return { isOpen: local.isOpen, nextOpenAt: local.nextOpenAt.toISOString(), nextOpenLabel: local.nextOpenLabel };
}

/** 会話を取得する（RLS により自分の会話のみ）。見つからなければ null */
export async function fetchConversation(id: string): Promise<Conversation | null> {
  if (!isUuid(id)) return null;
  const supabase = getWidgetSupabaseClient();
  const { data, error } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return data;
}

/** 最新の未完了の会話（AI 503 などで新規会話の ID を受け取れなかったときの回復用） */
export async function fetchLatestOpenConversation(): Promise<Conversation | null> {
  const supabase = getWidgetSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

/** 会話のメッセージを古い順に取得する。失敗時は null */
export async function fetchMessages(conversationId: string): Promise<Message[] | null> {
  const supabase = getWidgetSupabaseClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return null;
  return data;
}
