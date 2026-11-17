// 管理画面のデータ取得（オペレーター自身のセッション＝RLS適用。service_role は使わない）

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, Database, Message } from "@/types/database";
import {
  LIST_LIMIT,
  limitList,
  type ConversationListItem,
  type LatestMessage,
  type StatusFilter,
} from "./conversation-utils";

type Client = SupabaseClient<Database>;

/** 会話＋最新メッセージ1件（PostgREST の埋め込み） */
const LIST_SELECT =
  "id, customer_session_id, status, assigned_operator_id, category, created_at, messages(content, sender_type, created_at)";

type RowWithMessages = Conversation & { messages: LatestMessage[] | null };

function toItem(row: RowWithMessages): ConversationListItem {
  const { messages, ...conversation } = row;
  return { ...conversation, latestMessage: messages?.[0] ?? null };
}

function listQuery(supabase: Client) {
  return supabase
    .from("conversations")
    .select(LIST_SELECT)
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
}

/**
 * 一覧を取得する（最大 LIST_LIMIT 件）。
 * 「すべて」のときは、作成日時が古いオペレーター待ちも漏れないよう待ちを別に取得して合わせる。
 */
export async function fetchConversationList(
  supabase: Client,
  filter: StatusFilter,
): Promise<{ items: ConversationListItem[]; error: { code?: string; message?: string } | null }> {
  const main =
    filter === "all"
      ? listQuery(supabase).order("created_at", { ascending: false }).limit(LIST_LIMIT)
      : listQuery(supabase).eq("status", filter).order("created_at", { ascending: false }).limit(LIST_LIMIT);

  const waiting =
    filter === "all"
      ? listQuery(supabase)
          .eq("status", "waiting_operator")
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT)
      : null;

  const [mainRes, waitingRes] = await Promise.all([main, waiting]);
  const error = mainRes.error ?? waitingRes?.error ?? null;
  if (error) return { items: [], error };

  const byId = new Map<string, ConversationListItem>();
  for (const row of [...((waitingRes?.data ?? []) as RowWithMessages[]), ...((mainRes.data ?? []) as RowWithMessages[])]) {
    byId.set(row.id, toItem(row));
  }
  return { items: limitList([...byId.values()]), error: null };
}

/** 1件の会話を一覧の行として取得する（Realtime で一覧外の会話に新着があったとき） */
export async function fetchConversationItem(supabase: Client, id: string): Promise<ConversationListItem | null> {
  const { data, error } = await listQuery(supabase).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toItem(data as RowWithMessages);
}

/** オペレーター待ちの件数 */
export async function fetchWaitingCount(supabase: Client): Promise<number | null> {
  const { count, error } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting_operator");
  return error ? null : (count ?? 0);
}

/** 詳細画面で読み込むメッセージの上限 */
export const DETAIL_MESSAGE_LIMIT = 1000;

export async function fetchConversation(supabase: Client, id: string) {
  return supabase.from("conversations").select("*").eq("id", id).maybeSingle();
}

export async function fetchMessages(supabase: Client, conversationId: string) {
  return supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(DETAIL_MESSAGE_LIMIT)
    .returns<Message[]>();
}
