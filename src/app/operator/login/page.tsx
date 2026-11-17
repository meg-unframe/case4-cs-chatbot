import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/operator/LoginForm";
import styles from "@/components/operator/LoginForm.module.css";
import { getOperatorUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ログイン | BOTANICA オペレーター画面",
  robots: { index: false, follow: false },
};

// ログインページ自体はガードしない（ログイン済みのオペレーターだけ一覧へ送る）
export default async function OperatorLoginPage() {
  if (await getOperatorUser()) redirect("/operator");

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>オペレーターログイン</h1>
        <p className={styles.subtitle}>BOTANICA カスタマーサポート 管理画面</p>
        <LoginForm />
      </div>
    </main>
  );
}
