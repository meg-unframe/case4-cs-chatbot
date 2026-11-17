"use client";

// 顧客向けチャットウィジェット本体。/widget で iframe 内に全高表示する。

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ensureWidgetSession, getWidgetSupabaseClient } from "@/lib/supabase/widget-client";
import {
  CHAT_API,
  CUSTOMER_MESSAGE_MAX_LENGTH,
  type BusinessHoursInfo,
  type ChatHandoffRequest,
  type ChatHandoffResponse,
  type ChatSendRequest,
  type ChatSendResponse,
} from "@/types/chat-api";
import type { Conversation, Message } from "@/types/database";
import { CONVERSATION_STATUS_LABELS } from "@/types/domain";
import {
  EMBED_CLOSE_MESSAGE,
  errorMessageFor,
  mergeMessages,
  readStoredConversationId,
  shouldSubmitOnKeyDown,
  writeStoredConversationId,
} from "./chat-logic";
import {
  fetchBusinessHours,
  fetchConversation,
  fetchLatestOpenConversation,
  fetchMessages,
  postChatApi,
  type ApiFailureCode,
} from "./widget-api";
import styles from "./ChatWidget.module.css";

/** 初回に表示する質問例（FAQ にある内容） */
const STARTER_QUESTIONS = ["送料はいくら？", "返品したい", "敏感肌でも使える？"] as const;

/** 営業状態の再取得間隔（10:00 / 18:00 をまたいでも表示が追従するように） */
const BUSINESS_HOURS_REFRESH_MS = 5 * 60 * 1000;

type Phase = "loading" | "ready" | "failed";
type Notice = { tone: "error" | "warning"; text: string };

const SENDER_LABELS = { customer: "あなた", ai: "AIアシスタント", operator: "オペレーター" } as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}

export default function ChatWidget() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [initAttempt, setInitAttempt] = useState(0);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [hours, setHours] = useState<BusinessHoursInfo | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationId = conversation?.id ?? null;
  const status = conversation?.status ?? null;
  const isClosed = status === "closed";

  // ---- 起動: 匿名サインイン → 会話の復元 ----------------------------------
  useEffect(() => {
    let cancelled = false;
    setEmbedded(window.parent !== window);

    (async () => {
      try {
        await ensureWidgetSession();
      } catch {
        if (!cancelled) setPhase("failed");
        return;
      }

      const storedId = readStoredConversationId();
      if (storedId) {
        const restored = await fetchConversation(storedId);
        if (restored && restored.status !== "closed") {
          const history = await fetchMessages(restored.id);
          if (cancelled) return;
          setConversation(restored);
          setMessages(history ?? []);
        } else {
          // 見つからない（他ユーザー・削除済み）／完了済みなら新しい会話として扱う
          writeStoredConversationId(null);
        }
      }
      if (!cancelled) setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [initAttempt]);

  // ---- 営業時間（起動時と定期的に取得） ----------------------------------
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchBusinessHours().then((info) => {
        if (!cancelled) setHours(info);
      });
    };
    load();
    const timer = window.setInterval(load, BUSINESS_HOURS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // ---- Realtime: 会話ごとに購読を張り替え、unmount で解除 -------------------
  useEffect(() => {
    if (!conversationId) return;
    const supabase = getWidgetSupabaseClient();
    let cancelled = false;

    const channel = supabase
      .channel(`widget-conversation-${conversationId}`)
      .on<Message>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          // API レスポンスと二重に届くため、id で重複排除する
          setMessages((prev) => mergeMessages(prev, [row]));
        },
      )
      .on<Conversation>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Conversation;
          setConversation((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : prev));
        },
      )
      .subscribe((state) => {
        if (state !== "SUBSCRIBED") return;
        // 購読開始までの取りこぼしを埋める（重複は mergeMessages で除外）
        void fetchMessages(conversationId).then((rows) => {
          if (!cancelled && rows) setMessages((prev) => mergeMessages(prev, rows));
        });
        void fetchConversation(conversationId).then((row) => {
          if (!cancelled && row) setConversation((prev) => (prev && prev.id === row.id ? row : prev));
        });
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // ---- 新着で最下部へスクロール（scrollIntoView は親ページまで動かすため使わない） ----
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending, status]);

  // ---- 状態更新のヘルパー -------------------------------------------------
  function applyConversation(next: Conversation) {
    setConversation(next);
    writeStoredConversationId(next.id);
  }

  function startNewConversation() {
    setConversation(null);
    setMessages([]);
    setNotice(null);
    writeStoredConversationId(null);
    textareaRef.current?.focus();
  }

  /** 会話とメッセージを DB から読み直す（エラー後の整合用） */
  async function reloadConversation(id: string) {
    const [row, rows] = await Promise.all([fetchConversation(id), fetchMessages(id)]);
    if (row) setConversation((prev) => (prev && prev.id === row.id ? row : prev));
    if (rows) setMessages((prev) => mergeMessages(prev, rows));
  }

  /** API の失敗を状態と案内に反映する */
  async function handleFailure(code: ApiFailureCode, sessionReset: boolean | undefined, currentId: string | null) {
    if (sessionReset) {
      // 匿名ユーザーが作り直されたので、以前の会話は参照できない
      setConversation(null);
      setMessages([]);
      writeStoredConversationId(null);
      setNotice({ tone: "warning", text: "接続をやり直しました。お手数ですが、もう一度送信してください。" });
      return;
    }

    switch (code) {
      case "ai_unavailable": {
        setNotice({ tone: "warning", text: errorMessageFor(code) });
        // 顧客メッセージは保存済み。新規会話だった場合は ID を受け取れていないので最新の会話を探す
        if (currentId) {
          await reloadConversation(currentId);
        } else {
          const latest = await fetchLatestOpenConversation();
          if (latest) {
            applyConversation(latest);
            const rows = await fetchMessages(latest.id);
            if (rows) setMessages((prev) => mergeMessages(prev, rows));
          }
        }
        return;
      }
      case "conversation_closed":
        setConversation((prev) => (prev ? { ...prev, status: "closed" } : prev));
        setNotice({ tone: "warning", text: errorMessageFor(code) });
        return;
      case "not_found":
        setConversation(null);
        setMessages([]);
        writeStoredConversationId(null);
        setNotice({ tone: "error", text: errorMessageFor(code) });
        return;
      case "invalid_state":
        setNotice({ tone: "warning", text: errorMessageFor(code) });
        if (currentId) await reloadConversation(currentId);
        return;
      default:
        setNotice({ tone: code === "rate_limited" ? "warning" : "error", text: errorMessageFor(code) });
    }
  }

  // ---- 送信 ---------------------------------------------------------------
  async function sendMessage(raw: string, fromInput: boolean) {
    const message = raw.trim();
    if (!message || sending || isClosed || phase !== "ready") return;
    if (message.length > CUSTOMER_MESSAGE_MAX_LENGTH) return;

    setSending(true);
    setNotice(null);
    const currentId = conversationId;
    const body: ChatSendRequest = { conversationId: currentId, message };
    const result = await postChatApi<ChatSendResponse>(CHAT_API.send, body);

    if (result.ok) {
      applyConversation(result.data.conversation);
      setMessages((prev) => mergeMessages(prev, result.data.messages));
      setHours(result.data.businessHours);
      if (fromInput) setInput("");
    } else {
      // 503 は顧客メッセージが保存済みなので入力欄を空にする（二重送信防止）
      if (fromInput && result.code === "ai_unavailable" && !result.sessionReset) setInput("");
      await handleFailure(result.code, result.sessionReset, currentId);
    }
    setSending(false);
  }

  // ---- 有人対応リクエスト ---------------------------------------------------
  async function requestHandoff() {
    if (!conversation || conversation.status !== "ai_handling" || handingOff) return;
    setHandingOff(true);
    setNotice(null);
    const body: ChatHandoffRequest = { conversationId: conversation.id };
    const result = await postChatApi<ChatHandoffResponse>(CHAT_API.handoff, body);
    if (result.ok) {
      applyConversation(result.data.conversation);
      setMessages((prev) => mergeMessages(prev, result.data.messages));
      setHours(result.data.businessHours);
    } else {
      await handleFailure(result.code, result.sessionReset, conversation.id);
    }
    setHandingOff(false);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void sendMessage(input, true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter で送信、Shift+Enter で改行。IME 変換中（isComposing / keyCode 229）の Enter は確定操作なので送信しない
    if (
      shouldSubmitOnKeyDown({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
      })
    ) {
      e.preventDefault();
      void sendMessage(input, true);
    }
  }

  function closeWidget() {
    // 親ページ（widget-embed.js）にパネルを閉じるよう依頼する。秘密情報は含めない
    window.parent.postMessage({ type: EMBED_CLOSE_MESSAGE }, "*");
  }

  // ---- 表示 ---------------------------------------------------------------
  const length = input.trim().length;
  const overLimit = input.length > CUSTOMER_MESSAGE_MAX_LENGTH;
  const canSend = phase === "ready" && !sending && !isClosed && length > 0 && !overLimit;
  const canHandoff = phase === "ready" && status === "ai_handling" && !handingOff && !sending;
  const aiWillReply = status === null || status === "ai_handling";

  let statusBanner: string | null = null;
  if (status === "waiting_operator") {
    statusBanner =
      hours && !hours.isOpen
        ? `営業時間外のため ${hours.nextOpenLabel} 以降に対応します`
        : "担当者をお待ちください";
  } else if (status === "operator_handling") {
    statusBanner = "オペレーターが対応しています";
  } else if (status === "closed") {
    statusBanner = "この会話は完了しました";
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 21c-.4 0-.8-.3-.8-.8v-4.1C6.6 15.6 4 12.4 4 8.5V4.8c0-.4.3-.8.8-.8 3.2 0 5.8 1.6 7.2 4 1.4-2.4 4-4 7.2-4 .4 0 .8.4.8.8v3.7c0 3.9-2.6 7.1-7.2 7.6v4.1c0 .5-.4.8-.8.8Z" />
            </svg>
          </span>
          <div className={styles.headerText}>
            <h1 className={styles.title}>BOTANICA サポート</h1>
            <p className={styles.hours}>
              営業時間 10:00〜18:00
              <span
                className={`${styles.hoursBadge} ${
                  hours === null ? "" : hours.isOpen ? styles.open : styles.closedHours
                }`}
              >
                {hours === null ? "確認中" : hours.isOpen ? "営業中" : "営業時間外"}
              </span>
            </p>
          </div>
          {embedded && (
            <button type="button" className={styles.closeButton} onClick={closeWidget} aria-label="チャットを閉じる">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className={styles.subBar}>
          <span className={styles.statusLabel}>
            {status ? CONVERSATION_STATUS_LABELS[status] : "AIアシスタントがお答えします"}
          </span>
          <button
            type="button"
            className={styles.handoffButton}
            onClick={() => void requestHandoff()}
            disabled={!canHandoff}
            aria-label="担当者（オペレーター）と話す"
            title={conversation ? undefined : "メッセージを送信すると利用できます"}
          >
            {handingOff ? "依頼中…" : "担当者と話す"}
          </button>
        </div>
      </header>

      {statusBanner && (
        <div className={`${styles.banner} ${isClosed ? styles.bannerClosed : ""}`} role="status">
          {statusBanner}
        </div>
      )}

      <div
        ref={listRef}
        className={styles.list}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="チャットのメッセージ"
      >
        {phase === "loading" && <p className={styles.centerNote}>読み込み中…</p>}

        {phase === "failed" && (
          <div className={styles.centerNote}>
            <p>チャットに接続できませんでした。</p>
            <button type="button" className={styles.retryButton} onClick={() => {
              setPhase("loading");
              setInitAttempt((n) => n + 1);
            }}>
              再接続する
            </button>
          </div>
        )}

        {phase === "ready" && messages.length === 0 && (
          <div className={styles.welcome}>
            <div className={`${styles.row} ${styles.rowLeft}`}>
              <span className={styles.senderLabel}>{SENDER_LABELS.ai}</span>
              <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                こんにちは。BOTANICA サポートです。商品・配送・返品などのご質問にAIがお答えします。
              </div>
            </div>
            <p className={styles.startersLabel}>よくあるご質問</p>
            <div className={styles.starters}>
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={styles.starterButton}
                  onClick={() => void sendMessage(q, false)}
                  disabled={sending}
                  aria-label={`「${q}」と質問する`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isCustomer = m.sender_type === "customer";
          const bubbleClass =
            m.sender_type === "customer"
              ? styles.bubbleCustomer
              : m.sender_type === "operator"
                ? styles.bubbleOperator
                : styles.bubbleAi;
          return (
            <div key={m.id} className={`${styles.row} ${isCustomer ? styles.rowRight : styles.rowLeft}`}>
              {!isCustomer && (
                <span
                  className={`${styles.senderLabel} ${m.sender_type === "operator" ? styles.senderOperator : ""}`}
                >
                  {SENDER_LABELS[m.sender_type]}
                </span>
              )}
              <div className={`${styles.bubble} ${bubbleClass}`}>
                {isCustomer && <span className={styles.srOnly}>あなた: </span>}
                {m.content}
              </div>
              <time className={styles.time} dateTime={m.created_at}>
                {formatTime(m.created_at)}
              </time>
            </div>
          );
        })}

        {sending && (
          <div className={`${styles.row} ${styles.rowLeft}`} role="status">
            <div className={`${styles.bubble} ${styles.bubbleAi} ${styles.typing}`}>
              <span className={styles.dots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {aiWillReply ? "AIが回答を作成中…" : "送信中…"}
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div
          className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeWarning}`}
          role="alert"
        >
          <span>{notice.text}</span>
          <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="お知らせを閉じる">
            ×
          </button>
        </div>
      )}

      {isClosed ? (
        <div className={styles.closedFooter}>
          <button type="button" className={styles.primaryButton} onClick={startNewConversation}>
            新しい会話を始める
          </button>
        </div>
      ) : (
        <form className={styles.composer} onSubmit={onSubmit}>
          <label htmlFor="botanica-chat-input" className={styles.srOnly}>
            メッセージを入力
          </label>
          <textarea
            id="botanica-chat-input"
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="メッセージを入力（Shift+Enterで改行）"
            rows={2}
            disabled={phase !== "ready"}
            aria-describedby="botanica-chat-counter"
            aria-invalid={overLimit}
          />
          <div className={styles.composerFooter}>
            <span
              id="botanica-chat-counter"
              className={`${styles.counter} ${overLimit ? styles.counterOver : ""}`}
            >
              {input.length}/{CUSTOMER_MESSAGE_MAX_LENGTH}
              {overLimit && "（文字数が上限を超えています）"}
            </span>
            <button type="submit" className={styles.sendButton} disabled={!canSend} aria-label="メッセージを送信">
              {sending ? "送信中…" : "送信"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
