import { describe, expect, it } from "vitest";
import type { Message } from "@/types/database";
import {
  errorCodeFromStatus,
  isChatErrorResponse,
  mergeMessages,
  shouldSubmitOnKeyDown,
} from "./chat-logic";

const msg = (id: string, createdAt: string, content = id): Message => ({
  id,
  conversation_id: "c1",
  sender_type: "customer",
  sender_id: "u1",
  content,
  created_at: createdAt,
});

describe("mergeMessages", () => {
  it("id で重複排除し created_at 順に並べる", () => {
    const a = msg("a", "2026-11-17T01:00:00Z");
    const b = msg("b", "2026-11-17T01:00:02Z");
    const c = msg("c", "2026-11-17T01:00:01Z");
    const merged = mergeMessages([a, b], [c, b]);
    expect(merged.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("同じメッセージが API と Realtime の両方から届いても1件だけ", () => {
    const a = msg("a", "2026-11-17T01:00:00Z");
    const afterApi = mergeMessages([], [a]);
    const afterRealtime = mergeMessages(afterApi, [{ ...a }]);
    expect(afterRealtime).toHaveLength(1);
  });

  it("created_at が同じなら先に届いた順を保つ", () => {
    const t = "2026-11-17T01:00:00Z";
    const merged = mergeMessages([msg("x", t)], [msg("y", t), msg("w", t)]);
    expect(merged.map((m) => m.id)).toEqual(["x", "y", "w"]);
  });

  it("追加がなければ同じ配列を返す", () => {
    const current = [msg("a", "2026-11-17T01:00:00Z")];
    expect(mergeMessages(current, [])).toBe(current);
    expect(mergeMessages(current, [current[0]])).toBe(current);
  });
});

describe("shouldSubmitOnKeyDown", () => {
  it("Enter で送信、Shift+Enter は改行", () => {
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitOnKeyDown({ key: "a", shiftKey: false })).toBe(false);
  });

  it("IME変換中の Enter では送信しない", () => {
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  });
});

describe("エラーレスポンス", () => {
  it("ChatErrorResponse を判定する", () => {
    expect(isChatErrorResponse({ error: { code: "rate_limited", message: "x" } })).toBe(true);
    expect(isChatErrorResponse({ error: "x" })).toBe(false);
    expect(isChatErrorResponse(null)).toBe(false);
  });

  it("ステータスからコードを推定する", () => {
    expect(errorCodeFromStatus(401)).toBe("unauthorized");
    expect(errorCodeFromStatus(429)).toBe("rate_limited");
    expect(errorCodeFromStatus(503)).toBe("ai_unavailable");
    expect(errorCodeFromStatus(502)).toBe("internal");
  });
});
