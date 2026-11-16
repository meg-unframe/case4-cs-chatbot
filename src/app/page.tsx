import { getBusinessHoursStatus } from "@/lib/business-hours";

export const dynamic = "force-dynamic";

// 基盤確認用のプレースホルダー。チャットウィジェットは src/components/widget/ で別途実装する。
export default function Home() {
  const hours = getBusinessHoursStatus();

  return (
    <main style={{ maxWidth: 640, margin: "48px auto", padding: "0 16px", lineHeight: 1.7 }}>
      <h1>BOTANICA カスタマーサポート</h1>
      <p>基盤セットアップ済み（チャットウィジェット・管理画面は未実装）。</p>
      <p>
        営業時間 10:00〜18:00（日本時間）／現在:{" "}
        {hours.isOpen ? "営業時間内" : `営業時間外（次回対応: ${hours.nextOpenLabel}）`}
      </p>
    </main>
  );
}
