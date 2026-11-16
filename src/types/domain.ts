// ドメイン定数。DBのCHECK制約と必ず一致させること。

export const CONVERSATION_STATUSES = [
  "ai_handling",
  "waiting_operator",
  "operator_handling",
  "closed",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const SENDER_TYPES = ["customer", "ai", "operator"] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export const MESSAGE_MAX_LENGTH = 4000;

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  ai_handling: "AI対応中",
  waiting_operator: "オペレーター待ち",
  operator_handling: "オペレーター対応中",
  closed: "完了",
};

export function isConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === "string" && (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export function isSenderType(value: unknown): value is SenderType {
  return typeof value === "string" && (SENDER_TYPES as readonly string[]).includes(value);
}
