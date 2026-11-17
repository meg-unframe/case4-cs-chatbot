// FAQ の埋め込みを生成して public.faqs.embedding に保存する。
//   npm run embed:faqs              … 対象件数の確認のみ（書き込まない）
//   npm run embed:faqs -- --yes     … embedding が未設定の FAQ だけ生成・保存
//   npm run embed:faqs -- --yes --all … 全件を作り直す（FAQ の文面を変更したとき）
// キーの値は表示しない。OpenAI へはまとめて 1 回だけリクエストする。

import { createClient } from "@supabase/supabase-js";

const MODEL = "text-embedding-3-small"; // src/lib/env.ts の EMBEDDING と一致させる
const DIMENSION = 1536; // supabase/migrations の vector(1536) と一致させる

const args = new Set(process.argv.slice(2));
const write = args.has("--yes");
const all = args.has("--all");

function env(name) {
  const v = process.env[name];
  if (!v || v.startsWith("your-")) {
    console.error(`環境変数 ${name} が未設定です（.env.local を確認してください）`);
    process.exit(1);
  }
  return v;
}

/** 埋め込みに使うテキスト。src/lib/ai 側で質問を埋め込むときと同じ方針にする */
export function faqEmbeddingText(faq) {
  return `カテゴリ: ${faq.category}\n質問: ${faq.question}\n回答: ${faq.answer}`;
}

async function embed(inputs, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) {
    let err = {};
    try {
      err = (await res.json()).error ?? {};
    } catch {}
    // エラーメッセージにはキーの一部が含まれることがあるため、種別だけ表示する
    throw new Error(`OpenAI Embeddings 失敗: HTTP ${res.status} type=${err.type} code=${err.code}`);
  }
  const json = await res.json();
  const vectors = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (vectors.length !== inputs.length) throw new Error("埋め込みの件数が入力と一致しません");
  for (const v of vectors) {
    if (v.length !== DIMENSION || !v.every((x) => Number.isFinite(x))) {
      throw new Error(`埋め込みの次元が不正です（期待 ${DIMENSION}）`);
    }
  }
  return { vectors, usage: json.usage, model: json.model };
}

async function main() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const supabase = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log("project ref:", new URL(url).hostname.split(".")[0]);

  let query = supabase.from("faqs").select("id, faq_no, category, question, answer").order("faq_no");
  if (!all) query = query.is("embedding", null);
  const { data: faqs, error } = await query;
  if (error) throw new Error(`FAQ の取得に失敗: ${error.code} ${error.message}`);

  console.log(`対象: ${faqs.length} 件${all ? "（全件作り直し）" : "（embedding 未設定のみ）"}`);
  if (faqs.length === 0) return;
  if (!write) {
    console.log("確認のみ。保存するには `npm run embed:faqs -- --yes` を実行してください。");
    return;
  }

  // すべての埋め込みが揃ってから書き込む（途中で失敗しても DB は変わらない）
  const { vectors, usage, model } = await embed(faqs.map(faqEmbeddingText), env("OPENAI_API_KEY"));
  console.log(`埋め込み生成: ${vectors.length} 件 / model=${model} / tokens=${usage?.total_tokens}`);

  let saved = 0;
  for (let i = 0; i < faqs.length; i++) {
    const { error: upErr } = await supabase
      .from("faqs")
      .update({ embedding: JSON.stringify(vectors[i]) })
      .eq("id", faqs[i].id);
    if (upErr) throw new Error(`FAQ No.${faqs[i].faq_no} の保存に失敗: ${upErr.code} ${upErr.message}`);
    saved++;
  }
  console.log(`保存: ${saved} 件`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
