"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// 顧客ウィジェット専用のクライアント。
// - ECサイトに iframe で埋め込むため、セッションは Cookie ではなく localStorage に保存する
// - オペレーター画面（Cookie セッション）とは保存先を分け、同じブラウザでも混ざらないようにする

let widgetClient: SupabaseClient<Database> | undefined;

export function getWidgetSupabaseClient(): SupabaseClient<Database> {
  if (!widgetClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です");
    }
    widgetClient = createClient<Database>(url, anonKey, {
      auth: {
        storageKey: "botanica-widget-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return widgetClient;
}

/**
 * セッションがなければ匿名サインインし、アクセストークンを返す。
 * 会話の所有者は auth.uid() で判定されるため、独自の顧客IDをブラウザで発行しない。
 */
export async function ensureWidgetSession(): Promise<{ userId: string; accessToken: string }> {
  const supabase = getWidgetSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    return { userId: data.session.user.id, accessToken: data.session.access_token };
  }
  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.session) {
    throw new Error(`匿名サインインに失敗しました: ${error?.message ?? "unknown"}`);
  }
  return { userId: signIn.session.user.id, accessToken: signIn.session.access_token };
}
