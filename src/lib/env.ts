// 環境変数の取得。値そのものはログに出さない。

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`環境変数 ${name} が未設定です（.env.local を確認してください）`);
  }
  return value;
}

/** ブラウザでも使ってよい公開値（NEXT_PUBLIC_*）。Next.js がビルド時に埋め込むため直接参照する。 */
export function getPublicEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/** サーバー専用の秘密値。クライアントコンポーネントから import しないこと。 */
export function getServerEnv() {
  return {
    supabaseServiceRoleKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    anthropicApiKey: required("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY),
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  };
}
