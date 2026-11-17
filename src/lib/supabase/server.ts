import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isOperator } from "@/lib/auth/roles";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/** Server Component / Route Handler 用（リクエストユーザーの権限で動作し、RLSが適用される） */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの呼び出しでは set できない。middleware がセッションを更新する。
        }
      },
    },
  });
}

export { isOperator };

/** 認証済みオペレーターを返す。該当しなければ null。 */
export async function getOperatorUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  // getUser() は Auth サーバーでトークンを検証する（getSession() はサーバー側で信用しない）
  const { data } = await supabase.auth.getUser();
  return isOperator(data.user) ? data.user : null;
}
