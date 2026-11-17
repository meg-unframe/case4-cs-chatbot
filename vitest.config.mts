import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// 単体テスト: `npm test`（外部APIを呼ばない）
// 評価: `npm run eval`（eval/ 配下。Claude・OpenAI・Supabase を実際に呼ぶ）
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only は Next.js 外で import すると例外になるため、テストでは空モジュールに置き換える
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    // .env.local を読み込む（値は表示しない）
    env: loadEnv(mode, process.cwd(), ""),
    include: mode === "eval" ? ["eval/**/*.eval.ts"] : ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: mode === "eval" ? 120_000 : 10_000,
  },
}));
