"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { REALTIME_REFILL_DELAY_MS } from "@/types/chat-api";
import type { Conversation, Message } from "@/types/database";
import {
  LIST_LIMIT,
  SENDER_LABELS,
  STATUS_FILTERS,
  applyConversationChange,
  applyMessageInsert,
  assigneeLabel,
  describeDbError,
  formatDateTime,
  limitList,
  makeExcerpt,
  matchesFilter,
  shortCustomerId,
  type ConversationListItem,
  type StatusFilter,
} from "./conversation-utils";
import { fetchConversationItem, fetchConversationList, fetchWaitingCount } from "./operator-data";
import { useOperator } from "./OperatorContext";
import { StatusBadge } from "./StatusBadge";
import styles from "./ConversationList.module.css";

type RealtimeState = "connecting" | "live" | "error";

const REALTIME_CLASS: Record<RealtimeState, string | undefined> = {
  connecting: styles.liveConnecting,
  live: styles.liveOn,
  error: styles.liveOff,
};

/** 会話一覧（状態フィルタ・待ち件数・Realtime 更新） */
export function ConversationList() {
  const operator = useOperator();
  const pathname = usePathname();
  const selectedId = pathname?.match(/^\/operator\/conversations\/([^/]+)/)?.[1] ?? null;

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");
  // 時刻表示（「今日」判定）を1分ごとに更新する
  const [now, setNow] = useState(() => new Date());

  const filterRef = useRef(filter);
  const itemsRef = useRef(items);
  const loadSeq = useRef(0);
  const countTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    const supabase = getSupabaseBrowserClient();
    const currentFilter = filterRef.current;
    const [{ items: list, error: listError }, count] = await Promise.all([
      fetchConversationList(supabase, currentFilter),
      fetchWaitingCount(supabase),
    ]);
    if (seq !== loadSeq.current) return; // 新しい読み込みが始まっていれば捨てる
    if (listError) {
      setError(describeDbError(listError, "会話一覧を取得"));
    } else {
      setError(null);
      setItems(list);
    }
    if (count !== null) setWaitingCount(count);
    setLoading(false);
  }, []);

  const refreshWaitingCount = useCallback(() => {
    if (countTimer.current !== null) window.clearTimeout(countTimer.current);
    countTimer.current = window.setTimeout(async () => {
      countTimer.current = null;
      const count = await fetchWaitingCount(getSupabaseBrowserClient());
      if (count !== null) setWaitingCount(count);
    }, 300);
  }, []);

  // フィルタ変更時に再取得
  useEffect(() => {
    filterRef.current = filter;
    setLoading(true);
    void reload();
  }, [filter, reload]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Realtime: 会話の INSERT/UPDATE、メッセージの INSERT（RLS によりオペレーターには全件届く）
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let subscribedOnce = false;
    let refillTimer: number | undefined;

    const onConversation = (row: Conversation) => {
      setItems((prev) => limitList(applyConversationChange(prev, row, filterRef.current)));
      refreshWaitingCount();
    };

    const onMessage = (message: Message) => {
      if (itemsRef.current.some((i) => i.id === message.conversation_id)) {
        setItems((prev) => limitList(applyMessageInsert(prev, message) ?? prev));
        return;
      }
      // 一覧にない会話（古い会話など）への新着：会話を取得し、フィルタに合えば追加する
      void fetchConversationItem(supabase, message.conversation_id).then((item) => {
        if (!item || !matchesFilter(item.status, filterRef.current)) return;
        setItems((prev) => limitList(applyMessageInsert(prev, message) ?? [...prev, item]));
      });
    };

    const channel = supabase
      .channel("operator-conversation-list")
      .on<Conversation>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => onConversation(payload.new),
      )
      .on<Conversation>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => onConversation(payload.new),
      )
      .on<Message>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => onMessage(payload.new),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtime("live");
          // 再接続時は切断中の変化を取りこぼさないよう取り直す
          if (subscribedOnce) void reload();
          subscribedOnce = true;
          // SUBSCRIBED 後、サーバー側で配信が始まるまでの時間差を埋めるため、少し後にも取り直す
          if (refillTimer !== undefined) window.clearTimeout(refillTimer);
          refillTimer = window.setTimeout(() => void reload(), REALTIME_REFILL_DELAY_MS);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtime("error");
        }
      });

    return () => {
      if (refillTimer !== undefined) window.clearTimeout(refillTimer);
      void supabase.removeChannel(channel);
      if (countTimer.current !== null) window.clearTimeout(countTimer.current);
    };
  }, [reload, refreshWaitingCount]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>会話一覧</h2>
          <span
            className={`${styles.waiting} ${waitingCount ? styles.waitingActive : ""}`}
            aria-label={`オペレーター待ち ${waitingCount ?? "-"} 件`}
          >
            待ち <strong>{waitingCount ?? "-"}</strong> 件
          </span>
          <span className={`${styles.live} ${REALTIME_CLASS[realtime]}`} title="Realtime 接続状態">
            {realtime === "live" ? "自動更新中" : realtime === "connecting" ? "接続中…" : "自動更新停止"}
          </span>
        </div>
        <div className={styles.filters} role="tablist" aria-label="状態で絞り込み">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={`${styles.filter} ${filter === f.value ? styles.filterActive : ""}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value === "waiting_operator" && waitingCount ? (
                <span className={styles.filterCount}>{waitingCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        {realtime === "error" && (
          <div className={styles.notice}>
            自動更新が停止しています。
            <button type="button" className={styles.linkButton} onClick={() => void reload()}>
              再読み込み
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button type="button" className={styles.linkButton} onClick={() => void reload()}>
            再試行
          </button>
        </div>
      )}

      <ul className={styles.list}>
        {loading && items.length === 0 ? (
          <li className={styles.placeholder}>読み込み中…</li>
        ) : items.length === 0 ? (
          <li className={styles.placeholder}>該当する会話はありません。</li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/operator/conversations/${item.id}`}
                className={`${styles.item} ${item.id === selectedId ? styles.selected : ""} ${
                  item.status === "waiting_operator" ? styles.itemWaiting : ""
                }`}
                aria-current={item.id === selectedId ? "page" : undefined}
              >
                <div className={styles.row}>
                  <StatusBadge status={item.status} />
                  {item.category && <span className={styles.category}>{item.category}</span>}
                  <span className={styles.time}>
                    {formatDateTime(item.latestMessage?.created_at ?? item.created_at, now)}
                  </span>
                </div>
                <p className={styles.excerpt}>
                  {item.latestMessage ? (
                    <>
                      <span className={styles.sender}>{SENDER_LABELS[item.latestMessage.sender_type]}：</span>
                      {makeExcerpt(item.latestMessage.content)}
                    </>
                  ) : (
                    <span className={styles.noMessage}>（メッセージなし）</span>
                  )}
                </p>
                <div className={styles.meta}>
                  <span>顧客 {shortCustomerId(item.customer_session_id)}</span>
                  <span
                    className={item.assigned_operator_id === operator.id ? styles.mine : undefined}
                  >
                    担当 {assigneeLabel(item.assigned_operator_id, operator.id)}
                  </span>
                  <span>作成 {formatDateTime(item.created_at, now)}</span>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>
      {items.length >= LIST_LIMIT && (
        <p className={styles.footer}>最新 {LIST_LIMIT} 件まで表示しています。</p>
      )}
    </div>
  );
}
