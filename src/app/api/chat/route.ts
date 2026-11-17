import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  describeError,
  errorResponse,
  jsonResponse,
  parseSendRequest,
  readJson,
  toBusinessHoursInfo,
} from "@/lib/ai/chat-http";
import { HISTORY_LIMIT, generateAiReply, type AiReply, type HistoryItem } from "@/lib/ai/responder";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authenticateRequest } from "@/lib/supabase/request-auth";
import type { ChatSendResponse, HandoffInfo } from "@/types/chat-api";
import type { Conversation, Message } from "@/types/database";

// POST /api/chat — 顧客メッセージの送信（会話がなければ作成）→ 必要なら AI 応答。
// 仕様: src/types/chat-api.ts
//   - 会話の作成・参照・顧客メッセージの保存は、ユーザー権限クライアント（RLS適用）で行う
//   - AI メッセージの保存・状態/カテゴリ更新は、所有者確認済みの会話に対してのみ service_role で行う

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOG_TAG = "[api/chat]";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse("unauthorized");
  const { user, supabase } = auth;

  const parsed = parseSendRequest(await readJson(request));
  if (!parsed.ok) return errorResponse("invalid_request", parsed.message);
  const { conversationId, message } = parsed.value;

  try {
    // ---- 簡易レート制限（同一ユーザーの直近60秒の顧客メッセージ数） ----
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: countError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_type", "customer")
      .eq("sender_id", user.id)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= RATE_LIMIT_MAX) return errorResponse("rate_limited");

    // ---- 会話の取得または作成（RLS により他人の会話は見えない） ----
    let conversation: Conversation;
    let history: HistoryItem[] = [];
    if (conversationId) {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return errorResponse("not_found");
      if (data.status === "closed") return errorResponse("conversation_closed");
      conversation = data;

      if (conversation.status === "ai_handling") {
        const { data: rows, error: historyError } = await supabase
          .from("messages")
          .select("sender_type, content")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT);
        if (historyError) throw historyError;
        history = (rows ?? []).reverse().map((r) => ({ senderType: r.sender_type, content: r.content }));
      }
    } else {
      const { data, error } = await supabase
        .from("conversations")
        .insert({ status: "ai_handling" })
        .select("*")
        .single();
      if (error) throw error;
      conversation = data;
    }

    // ---- 顧客メッセージの保存（RLS: 自分名義・未クローズの自分の会話のみ） ----
    const { data: customerMessage, error: insertError } = await supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, sender_type: "customer", sender_id: user.id, content: message })
      .select("*")
      .single();
    if (insertError) {
      // 取得後にクローズされた場合などは RLS 違反（42501）になる
      if (insertError.code === "42501") return errorResponse("conversation_closed");
      throw insertError;
    }

    const now = new Date();
    const messages: Message[] = [customerMessage];
    const noHandoff: HandoffInfo = { requested: false, reason: null };

    // AI 対応中以外（オペレーター待ち・対応中）は AI は応答しない
    if (conversation.status !== "ai_handling") {
      return jsonResponse<ChatSendResponse>({
        conversation,
        messages,
        handoff: noHandoff,
        businessHours: toBusinessHoursInfo(now),
      });
    }

    // ---- AI 応答の生成（DB には書き込まない） ----
    let reply: AiReply;
    try {
      reply = await generateAiReply({ question: message, history, now });
    } catch (e) {
      console.error(`${LOG_TAG} AI応答の生成に失敗: ${describeError(e)}`);
      return errorResponse("ai_unavailable");
    }

    // ---- AI メッセージ保存・状態更新（service_role。所有者確認済みの会話のみ） ----
    const admin = getSupabaseAdminClient();
    const { data: aiMessage, error: aiInsertError } = await admin
      .from("messages")
      .insert({ conversation_id: conversation.id, sender_type: "ai", sender_id: null, content: reply.answer })
      .select("*")
      .single();
    if (aiInsertError) throw aiInsertError;
    messages.push(aiMessage);

    const update: { status?: "waiting_operator"; category?: string } = {};
    if (reply.handoff.needed) update.status = "waiting_operator";
    if (reply.category && !conversation.category) update.category = reply.category;

    let handoff = noHandoff;
    if (Object.keys(update).length > 0) {
      // 並行してオペレーターが状態を変えた場合に上書きしないよう、ai_handling の場合だけ更新する
      const { data: updated, error: updateError } = await admin
        .from("conversations")
        .update(update)
        .eq("id", conversation.id)
        .eq("status", "ai_handling")
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      if (updated) {
        conversation = updated;
        if (reply.handoff.needed) handoff = { requested: true, reason: reply.handoff.reason };
      } else {
        const { data: latest, error: latestError } = await admin
          .from("conversations")
          .select("*")
          .eq("id", conversation.id)
          .single();
        if (latestError) throw latestError;
        conversation = latest;
      }
    }

    return jsonResponse<ChatSendResponse>({
      conversation,
      messages,
      handoff,
      businessHours: toBusinessHoursInfo(now),
    });
  } catch (e) {
    console.error(`${LOG_TAG} 処理に失敗: ${describeError(e)}`);
    return errorResponse("internal");
  }
}
