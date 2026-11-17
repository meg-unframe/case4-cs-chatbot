import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ConversationList } from "@/components/operator/ConversationList";
import { OperatorProvider } from "@/components/operator/OperatorContext";
import { OperatorHeader } from "@/components/operator/OperatorHeader";
import styles from "@/components/operator/OperatorShell.module.css";
import { getBusinessHoursStatus } from "@/lib/business-hours";
import { getOperatorUser } from "@/lib/supabase/server";

// セッション（Cookie）ごとに判定するため常に動的レンダリング
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BOTANICA オペレーター画面",
  robots: { index: false, follow: false },
};

/**
 * /operator 配下（ログインページを除く）のガード。
 * Auth サーバーでトークンを検証し、app_metadata.role = "operator"（匿名不可）でなければログインへ。
 * データの読み書きは RLS が最終的に制限する。
 */
export default async function OperatorConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getOperatorUser();
  if (!user) redirect("/operator/login");

  const { isOpen, nextOpenLabel } = getBusinessHoursStatus();

  return (
    <OperatorProvider operator={{ id: user.id, email: user.email ?? null }}>
      <div className={styles.shell}>
        <OperatorHeader initialHours={{ isOpen, nextOpenLabel }} />
        <div className={styles.panes}>
          <aside className={styles.listPane} aria-label="会話一覧">
            <ConversationList />
          </aside>
          <main className={styles.detailPane}>{children}</main>
        </div>
      </div>
    </OperatorProvider>
  );
}
