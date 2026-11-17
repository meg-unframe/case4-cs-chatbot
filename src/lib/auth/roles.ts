import type { User } from "@supabase/supabase-js";

/**
 * オペレーター判定（サーバー・ブラウザ共通）。
 * 管理者のみが設定できる app_metadata.role を使い、顧客が変更できる user_metadata は使わない。
 * 匿名ユーザーは対象外。DB 側の public.is_operator() と同じ条件。
 * ブラウザ側の判定は表示の切り替え用で、権限そのものは RLS とサーバー側のガードで守る。
 */
export function isOperator(user: User | null | undefined): boolean {
  if (!user || user.is_anonymous) return false;
  return user.app_metadata?.role === "operator";
}
