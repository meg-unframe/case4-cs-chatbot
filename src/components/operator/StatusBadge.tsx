import { CONVERSATION_STATUS_LABELS, type ConversationStatus } from "@/types/domain";
import styles from "./StatusBadge.module.css";

export function StatusBadge({ status }: { status: ConversationStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{CONVERSATION_STATUS_LABELS[status]}</span>;
}
