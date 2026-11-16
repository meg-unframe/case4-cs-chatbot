import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import type { Database } from "@/types/database";

let adminClient: SupabaseClient<Database> | undefined;

/**
 * service_role クライアント（RLSをバイパス）。サーバー専用。
 * 用途を限定する: AIメッセージの保存、AI判定による引き継ぎ、FAQ検索・投入。
 * 呼び出し前に、対象会話が auth.uid() の所有であることを必ずサーバー側で確認すること。
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (!adminClient) {
    const { supabaseUrl } = getPublicEnv();
    const { supabaseServiceRoleKey } = getServerEnv();
    adminClient = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
