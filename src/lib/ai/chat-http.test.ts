import { describe, expect, it } from "vitest";
import {
  countChars,
  describeError,
  errorResponse,
  isUuid,
  parseHandoffRequest,
  parseSendRequest,
  toBusinessHoursInfo,
} from "@/lib/ai/chat-http";
import { CUSTOMER_MESSAGE_MAX_LENGTH } from "@/types/chat-api";

const ID = "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("parseSendRequest", () => {
  it("新規会話（conversationId 省略 / null）", () => {
    expect(parseSendRequest({ message: " 送料は？ " })).toEqual({
      ok: true,
      value: { conversationId: null, message: "送料は？" },
    });
    expect(parseSendRequest({ conversationId: null, message: "a" }).ok).toBe(true);
  });

  it("既存会話", () => {
    const r = parseSendRequest({ conversationId: ID.toUpperCase(), message: "a" });
    expect(r).toEqual({ ok: true, value: { conversationId: ID, message: "a" } });
  });

  it("不正な入力は拒否する", () => {
    expect(parseSendRequest(undefined).ok).toBe(false);
    expect(parseSendRequest([]).ok).toBe(false);
    expect(parseSendRequest({}).ok).toBe(false);
    expect(parseSendRequest({ message: "   " }).ok).toBe(false);
    expect(parseSendRequest({ message: 123 }).ok).toBe(false);
    expect(parseSendRequest({ conversationId: "abc", message: "a" }).ok).toBe(false);
    expect(parseSendRequest({ conversationId: 1, message: "a" }).ok).toBe(false);
  });

  it(`${CUSTOMER_MESSAGE_MAX_LENGTH} 文字まで（絵文字は1文字）`, () => {
    expect(parseSendRequest({ message: "あ".repeat(CUSTOMER_MESSAGE_MAX_LENGTH) }).ok).toBe(true);
    expect(parseSendRequest({ message: "あ".repeat(CUSTOMER_MESSAGE_MAX_LENGTH + 1) }).ok).toBe(false);
    expect(parseSendRequest({ message: "😀".repeat(CUSTOMER_MESSAGE_MAX_LENGTH) }).ok).toBe(true);
    expect(countChars("😀a")).toBe(2);
  });
});

describe("parseHandoffRequest / isUuid", () => {
  it("UUID のみ受け付ける", () => {
    expect(parseHandoffRequest({ conversationId: ID })).toEqual({ ok: true, value: { conversationId: ID } });
    expect(parseHandoffRequest({ conversationId: "x" }).ok).toBe(false);
    expect(parseHandoffRequest(null).ok).toBe(false);
    expect(isUuid(`${ID}'; drop table x;--`)).toBe(false);
  });
});

describe("レスポンス", () => {
  it("エラーは仕様の形式とステータス", async () => {
    const res = errorResponse("rate_limited");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("rate_limited");
    expect(typeof body.error.message).toBe("string");
    expect(errorResponse("ai_unavailable").status).toBe(503);
    expect(errorResponse("conversation_closed").status).toBe(409);
  });

  it("営業時間情報", () => {
    expect(toBusinessHoursInfo(new Date("2026-11-17T22:00:00+09:00"))).toEqual({
      isOpen: false,
      nextOpenAt: "2026-11-18T01:00:00.000Z",
      nextOpenLabel: "11月18日(水) 10:00",
    });
  });

  it("ログ用のエラー要約に message を含めない", () => {
    const e = Object.assign(new Error("dummy-secret-value"), { status: 401, code: "invalid_api_key" });
    expect(describeError(e)).toBe("Error status=401 code=invalid_api_key");
    expect(describeError({ code: "42501", message: "secret" })).toBe("code=42501");
  });
});
