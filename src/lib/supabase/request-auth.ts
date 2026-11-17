import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

// Route Handler 用: `Authorization: Bearer <access_token>` からユーザーを確認し、
// そのユーザー権限（RLS適用）の Supabase クライアントを作る。

export type RequestAuth = {
  user: User;
  /** ユーザー権限のクライアント。RLS が適用される */
  supabase: SupabaseClient<Database>;
};

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** トークンを Supabase Auth で検証する。無効なら null。 */
export async function authenticateRequest(request: Request): Promise<RequestAuth | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, supabase };
}
