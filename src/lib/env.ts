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

/** 埋め込み（FAQ検索）専用の秘密値。回答生成は Claude、埋め込みは OpenAI を使う。 */
export function getEmbeddingEnv() {
  return {
    openaiApiKey: required("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
  };
}

/** 埋め込みの設定。supabase/migrations の vector(1536) と必ず一致させる */
export const EMBEDDING = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimension: 1536,
  /** 回答に使う FAQ の件数（上位3件） */
  matchCount: 3,
} as const;
