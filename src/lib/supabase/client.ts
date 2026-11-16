"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | undefined;

/** ブラウザ用クライアント（anon key + ユーザーのセッション。RLSが適用される） */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    // NEXT_PUBLIC_* はビルド時に文字列置換されるため、直接参照する
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です");
    }
    browserClient = createBrowserClient<Database>(url, anonKey);
  }
  return browserClient;
}

/**
 * 顧客ウィジェット用：セッションがなければ匿名サインインする。
 * 会話の所有者は auth.uid() で判定されるため、独自IDをブラウザで発行しない。
 */
export async function ensureAnonymousSession(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) return data.user.id;

  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.user) {
    throw new Error(`匿名サインインに失敗しました: ${error?.message ?? "unknown"}`);
  }
  return signIn.user.id;
}
