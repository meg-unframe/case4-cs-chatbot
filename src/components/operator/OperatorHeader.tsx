"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CLOSE_HOUR, OPEN_HOUR, getBusinessHoursStatus } from "@/lib/business-hours";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOperator } from "./OperatorContext";
import styles from "./OperatorHeader.module.css";

type HoursView = { isOpen: boolean; nextOpenLabel: string };

function currentHours(): HoursView {
  const { isOpen, nextOpenLabel } = getBusinessHoursStatus();
  return { isOpen, nextOpenLabel };
}

/** ヘッダー：オペレーターのメール、営業時間と現在の営業状態、ログアウト */
export function OperatorHeader({ initialHours }: { initialHours: HoursView }) {
  const operator = useOperator();
  const router = useRouter();
  const [hours, setHours] = useState<HoursView>(initialHours);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 営業状態は30秒ごとに更新する
  useEffect(() => {
    setHours(currentHours());
    const timer = window.setInterval(() => setHours(currentHours()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    const { error: signOutError } = await getSupabaseBrowserClient().auth.signOut();
    if (signOutError) {
      setSigningOut(false);
      setError("ログアウトできませんでした。再度お試しください。");
      return;
    }
    router.replace("/operator/login");
    router.refresh();
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <header className={styles.header}>
      <Link href="/operator" className={styles.brand}>
        BOTANICA <span className={styles.brandSub}>オペレーター画面</span>
      </Link>
      <div className={styles.hours} aria-live="polite">
        <span className={styles.hoursLabel}>
          営業時間 {pad(OPEN_HOUR)}:00〜{pad(CLOSE_HOUR)}:00
        </span>
        {hours.isOpen ? (
          <span className={`${styles.hoursState} ${styles.open}`}>営業時間内</span>
        ) : (
          <span className={`${styles.hoursState} ${styles.closed}`}>
            営業時間外（次回 {hours.nextOpenLabel}）
          </span>
        )}
      </div>
      <div className={styles.account}>
        <span className={styles.email} title={operator.email ?? undefined}>
          {operator.email ?? "（メール未設定）"}
        </span>
        <button type="button" className={styles.signOut} onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? "ログアウト中…" : "ログアウト"}
        </button>
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
      </div>
    </header>
  );
}
