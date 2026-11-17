import { jsonResponse, toBusinessHoursInfo } from "@/lib/ai/chat-http";
import type { BusinessHoursResponse } from "@/types/chat-api";

// GET /api/business-hours — 営業時間の状態（認証不要）。
// 毎回現在時刻で判定するため、キャッシュしない。

export const dynamic = "force-dynamic";

export function GET(): Response {
  return jsonResponse<BusinessHoursResponse>(toBusinessHoursInfo(new Date()));
}
