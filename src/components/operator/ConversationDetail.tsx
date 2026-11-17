"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { REALTIME_REFILL_DELAY_MS } from "@/types/chat-api";
import type { Conversation, Message } from "@/types/database";
import { MESSAGE_MAX_LENGTH } from "@/types/domain";
import {
  SENDER_LABELS,
  assigneeLabel,
  countChars,
  describeDbError,
  formatDateTime,
  formatFullDateTime,
  mergeMessages,
  shortCustomerId,
  shouldTakeOverOnReply,
  validateReply,
} from "./conversation-utils";
import { fetchConversation, fetchMessages } from "./operator-data";
import { useOperator } from "./OperatorContext";
import { StatusBadge } from "./StatusBadge";
import styles from "./ConversationDetail.module.css";

type Busy = null | "assign" | "reply" | "close";

const STALE_STATE_MESSAGE = "他のオペレーターの操作などで会話の状態が変わりました。最新の状態を確認してから操作してください。";

/** 会話詳細（タイムライン・担当・返信・完了。Realtime で新着と状態変化を反映） */
export function ConversationDetail({ conversationId }: { conversationId: string }) {
  const operator = useOperator();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => new Date());

  const timelineRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [convRes, msgRes] = await Promise.all([
      fetchConversation(supabase, conversationId),
      fetchMessages(supabase, conversationId),
    ]);
    if (convRes.error || msgRes.error) {
      setLoadError(describeDbError(convRes.error ?? msgRes.error, "会話を取得"));
    } else if (!convRes.data) {
      setNotFound(true);
    } else {
      setLoadError(null);
      setConversation(convRes.data);
      setMessages((prev) => mergeMessages(prev, msgRes.data ?? []));
    }
    setLoading(false);
  }, [conversationId]);

  const refreshConversation = useCallback(async () => {
    const { data } = await fetchConversation(getSupabaseBrowserClient(), conversationId);
    if (data) setConversation(data);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Realtime: この会話のメッセージ INSERT と会話の UPDATE
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let subscribedOnce = false;
    let refillTimer: number | undefined;
    const channel = supabase
      .channel(`operator-conversation-${conversationId}`)
      .on<Message>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => mergeMessages(prev, [payload.new])),
      )
      .on<Conversation>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => setConversation(payload.new),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // 再接続時は切断中の変化を取り直す（id で重複排除）
          if (subscribedOnce) void load();
          subscribedOnce = true;
          // SUBSCRIBED 後、サーバー側で配信が始まるまでの時間差を埋めるため、少し後にも取り直す
          if (refillTimer !== undefined) window.clearTimeout(refillTimer);
          refillTimer = window.setTimeout(() => void load(), REALTIME_REFILL_DELAY_MS);
        }
      });
    return () => {
      if (refillTimer !== undefined) window.clearTimeout(refillTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load]);

  // 新着時、末尾付近を見ていれば最下部へスクロール
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  function handleTimelineScroll() {
    const el = timelineRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  /**
   * 「オペレーター対応中＋担当=自分」に更新する。
   * 読み込んだときの状態・担当者のままの場合だけ更新し（楽観的排他）、変わっていれば null。
   */
  async function assignToMe(current: Conversation): Promise<Conversation | null | "error"> {
    const supabase = getSupabaseBrowserClient();
    let query = supabase
      .from("conversations")
      .update({ status: "operator_handling", assigned_operator_id: operator.id })
      .eq("id", current.id)
      .eq("status", current.status);
    query = current.assigned_operator_id
      ? query.eq("assigned_operator_id", current.assigned_operator_id)
      : query.is("assigned_operator_id", null);
    const { data, error } = await query.select().maybeSingle();
    if (error) {
      setActionError(describeDbError(error, "担当を設定"));
      return "error";
    }
    if (data) setConversation(data);
    return data;
  }

  async function handleAssign() {
    if (!conversation || busy) return;
    const takenByOther =
      conversation.status === "operator_handling" &&
      conversation.assigned_operator_id !== null &&
      conversation.assigned_operator_id !== operator.id;
    if (takenByOther && !window.confirm("他のオペレーターが担当中です。担当を引き継ぎますか？")) return;

    setBusy("assign");
    setActionError(null);
    const result = await assignToMe(conversation);
    if (result === null) {
      setActionError(STALE_STATE_MESSAGE);
      await refreshConversation();
    }
    setBusy(null);
  }

  async function handleClose() {
    if (!conversation || busy || conversation.status === "closed") return;
    if (!window.confirm("この会話を「完了」にしますか？\n完了にすると返信できなくなります。")) return;

    setBusy("close");
    setActionError(null);
    const { data, error } = await getSupabaseBrowserClient()
      .from("conversations")
      .update({ status: "closed" })
      .eq("id", conversation.id)
      .neq("status", "closed")
      .select()
      .maybeSingle();
    if (error) {
      setActionError(describeDbError(error, "完了に変更"));
    } else if (data) {
      setConversation(data);
    } else {
      await refreshConversation();
    }
    setBusy(null);
  }

  async function sendReply() {
    if (!conversation || busy) return;
    if (conversation.status === "closed") {
      setActionError("完了した会話には返信できません。");
      return;
    }
    const content = draft.trim();
    const invalid = validateReply(content);
    if (invalid) {
      setActionError(invalid);
      return;
    }

    setBusy("reply");
    setActionError(null);
    try {
      // AI対応中・オペレーター待ちなら、先に「対応中＋担当=自分」へ（以後 AI は応答しない）
      if (shouldTakeOverOnReply(conversation.status)) {
        const result = await assignToMe(conversation);
        if (result === "error") return;
        if (result === null) {
          setActionError(`${STALE_STATE_MESSAGE}（返信は送信していません）`);
          await refreshConversation();
          return;
        }
      }

      const { data, error } = await getSupabaseBrowserClient()
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_type: "operator",
          sender_id: operator.id,
          content,
        })
        .select()
        .single();
      if (error) {
        setActionError(describeDbError(error, "返信を送信"));
        return;
      }
      stickToBottom.current = true;
      setMessages((prev) => mergeMessages(prev, [data]));
      setDraft("");
    } finally {
      setBusy(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendReply();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // 日本語IMEの変換確定の Enter では送信しない（keyCode 229 は一部ブラウザ向け）
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void sendReply();
  }

  if (loading) {
    return <div className={styles.center}>読み込み中…</div>;
  }
  if (notFound) {
    return <div className={styles.center}>会話が見つかりません。</div>;
  }
  if (!conversation) {
    return (
      <div className={styles.center}>
        <p role="alert" className={styles.error}>
          {loadError ?? "会話を取得できませんでした。"}
        </p>
        <button type="button" className={styles.secondary} onClick={() => void load()}>
          再試行
        </button>
      </div>
    );
  }

  const isClosed = conversation.status === "closed";
  const isMine = conversation.status === "operator_handling" && conversation.assigned_operator_id === operator.id;
  const length = countChars(draft);
  const tooLong = length > MESSAGE_MAX_LENGTH;
  const canSend = !isClosed && busy === null && draft.trim().length > 0 && !tooLong;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.headerTitle}>
            <StatusBadge status={conversation.status} />
            <h2 className={styles.title}>顧客 {shortCustomerId(conversation.customer_session_id)}</h2>
            {conversation.category && <span className={styles.category}>{conversation.category}</span>}
          </div>
          <dl className={styles.meta}>
            <div>
              <dt>担当</dt>
              <dd className={conversation.assigned_operator_id === operator.id ? styles.mine : undefined}>
                {assigneeLabel(conversation.assigned_operator_id, operator.id)}
              </dd>
            </div>
            <div>
              <dt>作成</dt>
              <dd>{formatFullDateTime(conversation.created_at)}</dd>
            </div>
            <div>
              <dt>会話ID</dt>
              <dd className={styles.mono} title={conversation.id}>
                {conversation.id.slice(0, 8)}
              </dd>
            </div>
          </dl>
        </div>
        <div className={styles.actions}>
          {!isClosed && !isMine && (
            <button type="button" className={styles.primary} onClick={handleAssign} disabled={busy !== null}>
              {busy === "assign" ? "処理中…" : "担当する"}
            </button>
          )}
          {!isClosed && (
            <button type="button" className={styles.danger} onClick={handleClose} disabled={busy !== null}>
              {busy === "close" ? "処理中…" : "完了にする"}
            </button>
          )}
        </div>
      </div>

      {(actionError || loadError) && (
        <div role="alert" className={styles.errorBar}>
          {actionError ?? loadError}
          <button
            type="button"
            className={styles.dismiss}
            aria-label="閉じる"
            onClick={() => {
              setActionError(null);
              setLoadError(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className={styles.timeline} ref={timelineRef} onScroll={handleTimelineScroll} aria-live="polite">
        {messages.length === 0 ? (
          <p className={styles.noMessages}>メッセージはまだありません。</p>
        ) : (
          messages.map((m) => {
            const own = m.sender_type === "operator" && m.sender_id === operator.id;
            return (
              <div key={m.id} className={`${styles.message} ${styles[m.sender_type]}`}>
                <div className={styles.messageHead}>
                  <span className={styles.sender}>
                    {SENDER_LABELS[m.sender_type]}
                    {own ? "（自分）" : ""}
                  </span>
                  <time dateTime={m.created_at} title={formatFullDateTime(m.created_at)}>
                    {formatDateTime(m.created_at, now)}
                  </time>
                </div>
                <div className={styles.bubble}>{m.content}</div>
              </div>
            );
          })
        )}
      </div>

      {isClosed ? (
        <div className={styles.closedNotice}>この会話は完了しています。返信できません。</div>
      ) : (
        <form className={styles.composer} onSubmit={handleSubmit}>
          {shouldTakeOverOnReply(conversation.status) && (
            <p className={styles.hint}>送信すると、この会話は「オペレーター対応中（担当：自分）」になり、AIは応答しなくなります。</p>
          )}
          {conversation.status === "operator_handling" && !isMine && (
            <p className={styles.hint}>他のオペレーターが担当中の会話です。</p>
          )}
          <textarea
            className={styles.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="返信を入力（Enterで送信、Shift+Enterで改行）"
            rows={3}
            disabled={busy === "reply"}
            aria-label="返信"
          />
          <div className={styles.composerFoot}>
            <span className={`${styles.counter} ${tooLong ? styles.counterOver : ""}`}>
              {length} / {MESSAGE_MAX_LENGTH}
            </span>
            <button type="submit" className={styles.primary} disabled={!canSend}>
              {busy === "reply" ? "送信中…" : "送信"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
