"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | undefined;

/** ブラウザ用クライアント（Cookie セッション。オペレーター画面用。RLSが適用される） */
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

// 顧客ウィジェットは ./widget-client.ts（localStorage セッション）を使う。
