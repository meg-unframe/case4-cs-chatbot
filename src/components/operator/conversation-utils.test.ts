import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Conversation, Message } from "@/types/database";
import {
  applyConversationChange,
  applyMessageInsert,
  assigneeLabel,
  countChars,
  describeDbError,
  formatDateTime,
  isOperatorUser,
  limitList,
  makeExcerpt,
  mergeMessages,
  shortCustomerId,
  shouldTakeOverOnReply,
  sortConversations,
  validateReply,
  type ConversationListItem,
} from "./conversation-utils";

const conv = (over: Partial<ConversationListItem> & { id: string }): ConversationListItem => ({
  customer_session_id: "11111111-2222-3333-4444-555555555555",
  status: "ai_handling",
  assigned_operator_id: null,
  category: null,
  created_at: "2026-11-17T01:00:00Z",
  latestMessage: null,
  ...over,
});

const msg = (over: Partial<Message> & { id: string }): Message => ({
  conversation_id: "c1",
  sender_type: "customer",
  sender_id: "u1",
  content: "こんにちは",
  created_at: "2026-11-17T01:00:00Z",
  ...over,
});

describe("sortConversations", () => {
  it("オペレーター待ちを先頭に、その中は最終更新が新しい順", () => {
    const items = [
      conv({ id: "a", status: "ai_handling", created_at: "2026-11-17T05:00:00Z" }),
      conv({ id: "b", status: "waiting_operator", created_at: "2026-11-17T01:00:00Z" }),
      conv({
        id: "c",
        status: "waiting_operator",
        created_at: "2026-11-17T00:00:00Z",
        latestMessage: { content: "x", sender_type: "customer", created_at: "2026-11-17T03:00:00Z" },
      }),
      conv({ id: "d", status: "closed", created_at: "2026-11-17T06:00:00Z" }),
    ];
    expect(sortConversations(items).map((i) => i.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("元の配列を変更しない", () => {
    const items = [conv({ id: "a" }), conv({ id: "b", status: "waiting_operator" })];
    sortConversations(items);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("limitList は並び替えて件数を制限する", () => {
    const items = Array.from({ length: 5 }, (_, n) =>
      conv({ id: `x${n}`, created_at: `2026-11-17T0${n}:00:00Z` }),
    );
    expect(limitList(items, 2).map((i) => i.id)).toEqual(["x4", "x3"]);
  });
});

describe("makeExcerpt", () => {
  it("改行・連続空白をまとめる", () => {
    expect(makeExcerpt("  注文の\n\n確認   をしたい ")).toBe("注文の 確認 をしたい");
  });
  it("上限を超えたら「…」で切る（絵文字を壊さない）", () => {
    expect(makeExcerpt("あいうえおかきくけこ", 5)).toBe("あいうえお…");
    expect(makeExcerpt("🌿🌿🌿", 2)).toBe("🌿🌿…");
    expect(makeExcerpt("あいう", 3)).toBe("あいう");
  });
});

describe("表示用の関数", () => {
  it("顧客IDは先頭8桁", () => {
    expect(shortCustomerId("abcdef12-3456-7890-abcd-ef1234567890")).toBe("abcdef12");
  });
  it("担当者：自分・未割当・他のオペレーター", () => {
    expect(assigneeLabel("me", "me")).toBe("自分");
    expect(assigneeLabel(null, "me")).toBe("未割当");
    expect(assigneeLabel("0123456789abcdef", "me")).toBe("他のオペレーター（01234567）");
  });
  it("日時は日本時間。当日は時刻のみ、同年は月日つき", () => {
    const now = new Date("2026-11-17T12:00:00+09:00");
    expect(formatDateTime("2026-11-17T00:30:00Z", now)).toBe("09:30");
    expect(formatDateTime("2026-11-16T15:05:00Z", now)).toBe("00:05"); // JST では 11/17
    expect(formatDateTime("2026-11-16T14:59:00Z", now)).toBe("11/16 23:59");
    expect(formatDateTime("2025-01-02T03:04:00Z", now)).toBe("2025/1/2 12:04");
  });
});

describe("Realtime の反映", () => {
  it("会話の UPDATE：フィルタに合えば更新、合わなければ外す。最新メッセージは保つ", () => {
    const latest = { content: "x", sender_type: "customer" as const, created_at: "2026-11-17T02:00:00Z" };
    const items = [conv({ id: "a", status: "waiting_operator", latestMessage: latest })];
    const row: Conversation = { ...items[0], status: "operator_handling", assigned_operator_id: "me" };
    delete (row as Partial<ConversationListItem>).latestMessage;

    const all = applyConversationChange(items, row, "all");
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("operator_handling");
    expect(all[0].latestMessage).toEqual(latest);

    expect(applyConversationChange(items, row, "waiting_operator")).toEqual([]);
  });

  it("会話の INSERT：一覧に追加される", () => {
    const row = conv({ id: "new" });
    const result = applyConversationChange([conv({ id: "a" })], row, "ai_handling");
    expect(result.map((i) => i.id).sort()).toEqual(["a", "new"]);
  });

  it("メッセージの INSERT：抜粋を更新。一覧にない会話は null。古いメッセージでは上書きしない", () => {
    const items = [conv({ id: "c1" })];
    const m = msg({ id: "m1", content: "新着", created_at: "2026-11-17T03:00:00Z" });
    const next = applyMessageInsert(items, m)!;
    expect(next[0].latestMessage?.content).toBe("新着");

    expect(applyMessageInsert(items, msg({ id: "m2", conversation_id: "other" }))).toBeNull();

    const older = msg({ id: "m0", content: "古い", created_at: "2026-11-17T02:00:00Z" });
    expect(applyMessageInsert(next, older)![0].latestMessage?.content).toBe("新着");
  });

  it("mergeMessages は id で重複排除し、日時の昇順に並べる", () => {
    const a = msg({ id: "a", created_at: "2026-11-17T01:00:00Z" });
    const b = msg({ id: "b", created_at: "2026-11-17T02:00:00Z" });
    const c = msg({ id: "c", created_at: "2026-11-17T00:30:00Z" });
    const merged = mergeMessages([a, b], [b, c, a]);
    expect(merged.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });
});

describe("返信", () => {
  it("空文字・空白のみは不可", () => {
    expect(validateReply("")).not.toBeNull();
    expect(validateReply(" \n　")).not.toBeNull();
    expect(validateReply("承知しました")).toBeNull();
  });
  it("4000字まで可、4001字は不可（絵文字は1字）", () => {
    expect(validateReply("あ".repeat(4000))).toBeNull();
    expect(validateReply("あ".repeat(4001))).toContain("4000字以内");
    expect(countChars("🌿".repeat(4000))).toBe(4000);
    expect(validateReply("🌿".repeat(4000))).toBeNull();
  });
  it("AI対応中・オペレーター待ちなら返信時に担当を自分にする", () => {
    expect(shouldTakeOverOnReply("ai_handling")).toBe(true);
    expect(shouldTakeOverOnReply("waiting_operator")).toBe(true);
    expect(shouldTakeOverOnReply("operator_handling")).toBe(false);
    expect(shouldTakeOverOnReply("closed")).toBe(false);
  });
});

describe("isOperatorUser", () => {
  const user = (over: Partial<User>): User =>
    ({ id: "u", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "", ...over }) as User;

  it("app_metadata.role = operator のみ", () => {
    expect(isOperatorUser(user({ app_metadata: { role: "operator" } }))).toBe(true);
    expect(isOperatorUser(user({ user_metadata: { role: "operator" } }))).toBe(false);
    expect(isOperatorUser(user({ app_metadata: { role: "operator" }, is_anonymous: true }))).toBe(false);
    expect(isOperatorUser(null)).toBe(false);
  });
});

describe("describeDbError", () => {
  it("担当者必須の制約違反を日本語で説明する", () => {
    const text = describeDbError(
      { code: "23514", message: 'violates check constraint "conversations_operator_assigned_check"' },
      "担当を設定",
    );
    expect(text).toContain("担当者の設定が必要");
  });
  it("権限エラー・通信エラー・不明なエラー", () => {
    expect(describeDbError({ code: "42501", message: "" }, "返信を送信")).toContain("権限");
    expect(describeDbError({ message: "TypeError: Failed to fetch" }, "返信を送信")).toContain("通信エラー");
    expect(describeDbError(null, "返信を送信")).toBe("返信を送信できませんでした。時間をおいて再度お試しください。");
  });
});
