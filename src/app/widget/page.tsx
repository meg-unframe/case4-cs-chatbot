import type { Metadata } from "next";
import ChatWidget from "@/components/widget/ChatWidget";

// ECサイトに iframe で埋め込むチャット画面（public/widget-embed.js から開く）。
// iframe 埋め込みの許可は next.config.ts の /widget ヘッダーで設定済み。
export const metadata: Metadata = {
  title: "BOTANICA サポートチャット",
  robots: { index: false, follow: false },
};

export default function WidgetPage() {
  return <ChatWidget />;
}
