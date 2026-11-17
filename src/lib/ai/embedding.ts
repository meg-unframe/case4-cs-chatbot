import "server-only";

import { EMBEDDING, getEmbeddingEnv } from "@/lib/env";

// OpenAI Embeddings（text-embedding-3-small, 1536次元）で質問文を埋め込む。
// FAQ 側は scripts/embed-faqs.mjs で「カテゴリ: …\n質問: …\n回答: …」として埋め込み済み。
// 質問は質問文のまま埋め込む。

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const TIMEOUT_MS = 15_000;

/**
 * 埋め込み失敗。OpenAI のエラー本文にはキーの一部が含まれることがあるため、
 * message は使わず status / type / code だけを保持する。
 */
export class EmbeddingError extends Error {
  readonly status: number | null;
  readonly type: string | null;
  readonly code: string | null;

  constructor(params: { status?: number | null; type?: string | null; code?: string | null; reason: string }) {
    super(`埋め込みの取得に失敗しました（${params.reason}）`);
    this.name = "EmbeddingError";
    this.status = params.status ?? null;
    this.type = params.type ?? null;
    this.code = params.code ?? null;
  }
}

/** 1536次元・有限値の配列かを検証する */
export function validateEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new EmbeddingError({ reason: "応答に埋め込みがありません" });
  }
  if (value.length !== EMBEDDING.dimension) {
    throw new EmbeddingError({ reason: `次元が不正です: ${value.length}` });
  }
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new EmbeddingError({ reason: "数値でない要素があります" });
  }
  return value as number[];
}

function pickString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function embedText(text: string, fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const input = text.trim();
  if (!input) throw new EmbeddingError({ reason: "入力が空です" });

  const { openaiApiKey } = getEmbeddingEnv();

  let res: Response;
  try {
    res = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING.model, input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // ネットワークエラー・タイムアウト。例外の詳細は出さない
    const name = e instanceof Error ? e.name : "unknown";
    throw new EmbeddingError({ reason: `通信エラー: ${name}` });
  }

  if (!res.ok) {
    let type: string | null = null;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { error?: { type?: unknown; code?: unknown } };
      type = pickString(body.error?.type);
      code = pickString(body.error?.code);
    } catch {
      // 本文が JSON でなくても無視する
    }
    throw new EmbeddingError({ status: res.status, type, code, reason: `HTTP ${res.status}` });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new EmbeddingError({ status: res.status, reason: "応答が JSON ではありません" });
  }
  const data = (json as { data?: { embedding?: unknown }[] }).data;
  return validateEmbedding(Array.isArray(data) ? data[0]?.embedding : undefined);
}
