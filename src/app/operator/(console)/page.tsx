import styles from "@/components/operator/OperatorShell.module.css";

export const dynamic = "force-dynamic";

/** /operator：一覧は左ペイン（レイアウト）に表示。右ペインは未選択の案内 */
export default function OperatorHomePage() {
  return (
    <div className={styles.empty}>
      <p>左の一覧から会話を選択してください。</p>
      <p className={styles.emptySub}>オペレーター待ちの会話が上に表示されます。</p>
    </div>
  );
}
