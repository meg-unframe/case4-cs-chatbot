// Supabase の Database 型。
// supabase/migrations/20261116000000_init.sql と手動で一致させている。
// クラウド接続後は `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
// で生成した型に置き換えてよい（その際も domain.ts のリテラル型は維持する）。

import type { ConversationStatus, SenderType } from "./domain";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ConversationRow = {
  id: string;
  customer_session_id: string;
  status: ConversationStatus;
  assigned_operator_id: string | null;
  category: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  content: string;
  created_at: string;
};

type FaqRow = {
  id: string;
  category: string;
  question: string;
  answer: string;
  /** pgvector は PostgREST 経由で文字列 "[0.1,0.2,...]" として返る */
  embedding: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          /** 省略時はDB側で auth.uid() が入る。RLSで auth.uid() と一致が必須 */
          customer_session_id?: string;
          status?: ConversationStatus;
          assigned_operator_id?: string | null;
          category?: string | null;
          created_at?: string;
        };
        Update: {
          status?: ConversationStatus;
          assigned_operator_id?: string | null;
          category?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: {
          id?: string;
          conversation_id: string;
          sender_type: SenderType;
          sender_id?: string | null;
          content: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      faqs: {
        Row: FaqRow;
        Insert: {
          id?: string;
          category: string;
          question: string;
          answer: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          category?: string;
          question?: string;
          answer?: string;
          embedding?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_operator: { Args: Record<string, never>; Returns: boolean };
      request_operator_handoff: {
        Args: { p_conversation_id: string };
        Returns: ConversationRow;
      };
      match_faqs: {
        Args: { query_embedding: string; match_count?: number; min_similarity?: number };
        Returns: {
          id: string;
          category: string;
          question: string;
          answer: string;
          similarity: number;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type Faq = Tables<"faqs">;
