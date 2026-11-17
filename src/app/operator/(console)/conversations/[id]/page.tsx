import { notFound } from "next/navigation";
import { ConversationDetail } from "@/components/operator/ConversationDetail";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ガードは (console)/layout.tsx で実施済み
export default async function OperatorConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  // key で会話ごとに状態を作り直す
  return <ConversationDetail key={id} conversationId={id} />;
}
