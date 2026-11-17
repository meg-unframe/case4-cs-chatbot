// 質問文で FAQ を埋め込み検索し、上位3件を表示する（確認用。DB は変更しない）。
//   npm run search:faqs -- "送料はいくらですか？"
// OpenAI へ 1 回、Supabase の match_faqs を 1 回呼ぶ。キーの値は表示しない。

import { createClient } from "@supabase/supabase-js";

const MODEL = "text-embedding-3-small";
const DIMENSION = 1536;
const MATCH_COUNT = 3;

function env(name) {
  const v = process.env[name];
  if (!v || v.startsWith("your-")) {
    console.error(`環境変数 ${name} が未設定です（.env.local を確認してください）`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('使い方: npm run search:faqs -- "質問文"');
    process.exit(1);
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: question }),
  });
  if (!res.ok) throw new Error(`OpenAI Embeddings 失敗: HTTP ${res.status}`);
  const json = await res.json();
  const vector = json.data[0].embedding;
  if (vector.length !== DIMENSION) throw new Error(`次元が不正です: ${vector.length}`);

  const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("match_faqs", {
    query_embedding: JSON.stringify(vector),
    match_count: MATCH_COUNT,
  });
  if (error) throw new Error(`match_faqs 失敗: ${error.code} ${error.message}`);

  console.log(`質問: ${question}（tokens=${json.usage?.total_tokens}）`);
  for (const [i, r] of data.entries()) {
    console.log(`${i + 1}. No.${r.faq_no} [${r.category}] ${r.question}  similarity=${r.similarity.toFixed(3)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
