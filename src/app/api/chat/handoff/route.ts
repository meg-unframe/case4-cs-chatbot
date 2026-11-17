import {
  describeError,
  errorResponse,
  jsonResponse,
  parseHandoffRequest,
  readJson,
  toBusinessHoursInfo,
} from "@/lib/ai/chat-http";
import { buildHandoffRequestMessage } from "@/lib/ai/responder";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authenticateRequest } from "@/lib/supabase/request-auth";
import type { ChatHandoffResponse } from "@/types/chat-api";

// POST /api/chat/handoff — 顧客からの有人対応リクエスト。
// 状態遷移（ai_handling → waiting_operator）と所有者確認は DB 関数 request_operator_handoff が保証する。
// 成功後、営業時間内外で文面を変えた案内の AI メッセージを service_role で保存する。

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOG_TAG = "[api/chat/handoff]";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse("unauthorized");
  const { supabase } = auth;

  const parsed = parseHandoffRequest(await readJson(request));
  if (!parsed.ok) return errorResponse("invalid_request", parsed.message);
  const { conversationId } = parsed.value;

  try {
    const { data: conversation, error } = await supabase.rpc("request_operator_handoff", {
      p_conversation_id: conversationId,
    });

    if (error || !conversation) {
      // 失敗理由（存在しない／他人の会話／状態が ai_handling 以外）を、RLS 適用の参照で切り分ける
      const { data: visible, error: selectError } = await supabase
        .from("conversations")
        .select("status")
        .eq("id", conversationId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (!visible) return errorResponse("not_found");
      if (visible.status === "closed") return errorResponse("conversation_closed");
      if (error && error.code !== "P0002") throw error;
      return errorResponse("invalid_state", "既にオペレーターへの切り替えを受け付けています。");
    }

    const now = new Date();
    const { data: aiMessage, error: insertError } = await getSupabaseAdminClient()
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        sender_type: "ai",
        sender_id: null,
        content: buildHandoffRequestMessage(now),
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    return jsonResponse<ChatHandoffResponse>({
      conversation,
      messages: [aiMessage],
      handoff: { requested: true, reason: "customer_request" },
      businessHours: toBusinessHoursInfo(now),
    });
  } catch (e) {
    console.error(`${LOG_TAG} 処理に失敗: ${describeError(e)}`);
    return errorResponse("internal");
  }
}
