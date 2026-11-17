import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingError, embedText, validateEmbedding } from "@/lib/ai/embedding";

// fetch を差し替えて検証する（OpenAI は呼ばない）

const FAKE_KEY = "test-key-not-real";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const okFetch = (embedding: unknown) =>
  vi.fn(async () => Response.json({ data: [{ embedding }], usage: { total_tokens: 5 } })) as unknown as typeof fetch;

describe("embedText", () => {
  it("1536次元の埋め込みを返し、モデルと入力を送る", async () => {
    const fetchMock = okFetch(new Array(1536).fill(0.1));
    const v = await embedText("  送料は？ ", fetchMock);
    expect(v).toHaveLength(1536);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(JSON.parse(init.body)).toEqual({ model: "text-embedding-3-small", input: "送料は？" });
  });

  it("次元違い・非有限値は拒否する", async () => {
    await expect(embedText("q", okFetch(new Array(3).fill(0.1)))).rejects.toThrow(EmbeddingError);
    const bad = new Array(1536).fill(0.1);
    bad[10] = null;
    expect(() => validateEmbedding(bad)).toThrow(EmbeddingError);
    expect(() => validateEmbedding([...new Array(1535).fill(0), Infinity])).toThrow(EmbeddingError);
  });

  it("HTTP エラーは status/type/code だけを持ち、本文の message（キーを含みうる）は出さない", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: `Incorrect API key provided: ${FAKE_KEY}`, type: "invalid_request_error", code: "invalid_api_key" } },
        { status: 401 },
      ),
    ) as unknown as typeof fetch;
    const err = await embedText("q", fetchMock).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.status).toBe(401);
    expect(err.type).toBe("invalid_request_error");
    expect(err.code).toBe("invalid_api_key");
    expect(err.message).not.toContain(FAKE_KEY);
    expect(JSON.stringify(err)).not.toContain(FAKE_KEY);
  });

  it("通信エラーも EmbeddingError にする", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed ${FAKE_KEY}`);
    }) as unknown as typeof fetch;
    const err = await embedText("q", fetchMock).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("空の入力は呼び出さずに拒否する", async () => {
    const fetchMock = okFetch([]);
    await expect(embedText("  ", fetchMock)).rejects.toThrow(EmbeddingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
