import "server-only";

import { EMBEDDING } from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// FAQ の埋め込み検索。match_faqs は service_role のみ実行可能。
// 類似度の下限は設けない（実測で 0.35〜0.71 程度。根拠になるかの最終判断は Claude に任せる）。

export type RetrievedFaq = {
  faqNo: number;
  category: string;
  question: string;
  answer: string;
  similarity: number;
};

export class RetrievalError extends Error {
  readonly code: string | null;
  constructor(code: string | null) {
    super(`FAQ検索に失敗しました（code=${code ?? "unknown"}）`);
    this.name = "RetrievalError";
    this.code = code;
  }
}

export async function searchFaqs(embedding: number[]): Promise<RetrievedFaq[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("match_faqs", {
    query_embedding: JSON.stringify(embedding),
    match_count: EMBEDDING.matchCount,
  });
  if (error) throw new RetrievalError(error.code ?? null);

  return (data ?? []).slice(0, EMBEDDING.matchCount).map((r) => ({
    faqNo: r.faq_no,
    category: r.category,
    question: r.question,
    answer: r.answer,
    similarity: r.similarity,
  }));
}
