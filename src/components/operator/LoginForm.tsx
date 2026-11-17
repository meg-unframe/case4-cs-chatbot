"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isOperatorUser } from "./conversation-utils";
import styles from "./LoginForm.module.css";

/** オペレーターのログイン（メール＋パスワード） */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError || !data.user) {
        setError("メールアドレスまたはパスワードが正しくありません。");
        setSubmitting(false);
        return;
      }
      if (!isOperatorUser(data.user)) {
        // オペレーター以外はセッションを残さない
        await supabase.auth.signOut();
        setPassword("");
        setError("オペレーター権限がありません。");
        setSubmitting(false);
        return;
      }
      setPassword("");
      router.replace("/operator");
      router.refresh();
    } catch {
      setError("ログインできませんでした。通信状況を確認して再度お試しください。");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label className={styles.field}>
        <span>メールアドレス</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          required
        />
      </label>
      <label className={styles.field}>
        <span>パスワード</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          required
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
