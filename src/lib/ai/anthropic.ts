import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/lib/env";

let client: Anthropic | undefined;

/** Claude API クライアント（サーバー専用。APIキーはブラウザに渡さない） */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const { anthropicApiKey } = getServerEnv();
    client = new Anthropic({ apiKey: anthropicApiKey });
  }
  return client;
}

/** 使用モデル。ANTHROPIC_MODEL で上書き可能（既定: claude-opus-5-5） */
export function getAnthropicModel(): string {
  return getServerEnv().anthropicModel;
}
