-- =====================================================================
-- BOTANICA CSチャットボット 初期スキーマ
--   - conversations / messages / faqs
--   - pgvector (FAQ埋め込み検索)
--   - RLS: 顧客(匿名認証)は自分の会話のみ / オペレーターは app_metadata.role で判定
--   - Realtime: messages / conversations
-- 注意: 本ファイルはローカルで作成したもの。クラウドDBへは未適用。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 拡張
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;  -- gen_random_uuid (PG13+は標準でも可)
create extension if not exists vector   with schema extensions;  -- pgvector

-- ---------------------------------------------------------------------
-- 権限判定ヘルパー
--   オペレーター判定は管理者のみが変更できる app_metadata.role を使う。
--   顧客が自由に書き換えられる user_metadata は使わない。
--   匿名ユーザーは app_metadata を持っていてもオペレーター扱いしない。
-- ---------------------------------------------------------------------
create or replace function public.is_operator()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'operator'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false,
    false
  );
$$;

comment on function public.is_operator() is
  'JWTのapp_metadata.role = operator かつ非匿名ユーザーなら true。user_metadataは参照しない。';

-- ---------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------
create table public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  -- 匿名認証ユーザーの auth.uid() を文字列で保持。既定値もサーバー側で auth.uid() を使う。
  customer_session_id  text not null default (auth.uid())::text,
  status               text not null default 'ai_handling',
  assigned_operator_id uuid references auth.users (id) on delete set null,
  category             text,
  created_at           timestamptz not null default now(),

  constraint conversations_status_check
    check (status in ('ai_handling', 'waiting_operator', 'operator_handling', 'closed')),
  constraint conversations_customer_session_id_not_blank
    check (length(btrim(customer_session_id)) > 0),
  -- operator_handling のときは担当者必須
  constraint conversations_operator_assigned_check
    check (status <> 'operator_handling' or assigned_operator_id is not null)
);

create index conversations_customer_session_idx
  on public.conversations (customer_session_id, created_at desc);
create index conversations_status_created_idx
  on public.conversations (status, created_at desc);
create index conversations_assigned_operator_idx
  on public.conversations (assigned_operator_id)
  where assigned_operator_id is not null;

-- ---------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_type     text not null,
  sender_id       uuid,
  content         text not null,
  created_at      timestamptz not null default now(),

  constraint messages_sender_type_check
    check (sender_type in ('customer', 'ai', 'operator')),
  -- AIは sender_id なし、顧客・オペレーターは必須
  constraint messages_sender_id_check
    check (
      (sender_type = 'ai' and sender_id is null)
      or (sender_type in ('customer', 'operator') and sender_id is not null)
    ),
  constraint messages_content_length_check
    check (length(btrim(content)) > 0 and char_length(content) <= 4000)
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- faqs
-- ---------------------------------------------------------------------
create table public.faqs (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,
  question   text not null,
  answer     text not null,
  embedding  extensions.vector(1536),
  created_at timestamptz not null default now(),

  constraint faqs_not_blank_check
    check (length(btrim(category)) > 0 and length(btrim(question)) > 0 and length(btrim(answer)) > 0)
);

create index faqs_category_idx on public.faqs (category);
create index faqs_embedding_hnsw_idx
  on public.faqs using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------
-- 偽装防止トリガー
--   RLSはどの行に触れるかを制御するが、UPDATEでどの列を変えるかは制御しない。
--   不変であるべき列の変更をDB側で拒否する。
-- ---------------------------------------------------------------------
create or replace function public.guard_conversation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.customer_session_id <> old.customer_session_id
     or new.created_at <> old.created_at then
    raise exception 'conversations: id / customer_session_id / created_at は変更できません'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger conversations_guard_update
  before update on public.conversations
  for each row execute function public.guard_conversation_update();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.faqs          enable row level security;

-- 未ログイン(anon)には一切許可しない。匿名認証済みユーザーは authenticated ロール。
revoke all on public.conversations from anon;
revoke all on public.messages      from anon;
revoke all on public.faqs          from anon;

-- 顧客は行の削除・メッセージの編集をしない。オペレーターも履歴を改変しない。
revoke delete on public.conversations from authenticated;
revoke update, delete on public.messages from authenticated;
revoke insert, update, delete on public.faqs from authenticated;

-- ---- conversations ----
-- 顧客: 自分の会話のみ参照（auth.uid() と照合。ブラウザが送るIDは信用しない）
create policy "conversations_select_own"
  on public.conversations for select
  to authenticated
  using (customer_session_id = (select auth.uid())::text);

-- 顧客: 自分名義・AI対応中・担当者なし の会話のみ作成可
create policy "conversations_insert_own"
  on public.conversations for insert
  to authenticated
  with check (
    customer_session_id = (select auth.uid())::text
    and status = 'ai_handling'
    and assigned_operator_id is null
  );

-- 顧客には UPDATE ポリシーを与えない（status の偽装防止）。
-- 有人引き継ぎ要求は request_operator_handoff() 経由、AI判定による引き継ぎはサーバー(service_role)で行う。

-- オペレーター: 全会話の参照・更新
create policy "conversations_select_operator"
  on public.conversations for select
  to authenticated
  using ((select public.is_operator()));

create policy "conversations_update_operator"
  on public.conversations for update
  to authenticated
  using ((select public.is_operator()))
  with check ((select public.is_operator()));

-- ---- messages ----
-- 顧客: 自分の会話のメッセージのみ参照
create policy "messages_select_own"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.customer_session_id = (select auth.uid())::text
    )
  );

-- 顧客: 自分の未クローズ会話に、sender_type=customer・sender_id=自分 でのみ投稿可
--   （ai / operator を名乗る偽装を防ぐ）
create policy "messages_insert_own"
  on public.messages for insert
  to authenticated
  with check (
    sender_type = 'customer'
    and sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.customer_session_id = (select auth.uid())::text
        and c.status <> 'closed'
    )
  );

-- オペレーター: 全メッセージ参照、自分名義の operator メッセージのみ投稿可
create policy "messages_select_operator"
  on public.messages for select
  to authenticated
  using ((select public.is_operator()));

create policy "messages_insert_operator"
  on public.messages for insert
  to authenticated
  with check (
    (select public.is_operator())
    and sender_type = 'operator'
    and sender_id = (select auth.uid())
  );

-- ---- faqs ----
-- 顧客には直接公開しない（AI応答APIが service_role で検索）。オペレーターは参照のみ。
create policy "faqs_select_operator"
  on public.faqs for select
  to authenticated
  using ((select public.is_operator()));

-- ---------------------------------------------------------------------
-- RPC: 顧客からの有人引き継ぎ要求
--   顧客に UPDATE 権限を与えず、ai_handling -> waiting_operator の遷移だけを許す。
-- ---------------------------------------------------------------------
create or replace function public.request_operator_handoff(p_conversation_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.conversations;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.conversations
     set status = 'waiting_operator'
   where id = p_conversation_id
     and customer_session_id = auth.uid()::text
     and status = 'ai_handling'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'conversation not found or not in ai_handling' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.request_operator_handoff(uuid) from public, anon;
grant execute on function public.request_operator_handoff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: FAQ類似検索（サーバー専用）
-- ---------------------------------------------------------------------
create or replace function public.match_faqs(
  query_embedding extensions.vector(1536),
  match_count     int   default 5,
  min_similarity  float default 0.0
)
returns table (
  id         uuid,
  category   text,
  question   text,
  answer     text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, f.category, f.question, f.answer,
         1 - (f.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.faqs f
   where f.embedding is not null
     and 1 - (f.embedding operator(extensions.<=>) query_embedding) >= min_similarity
   order by f.embedding operator(extensions.<=>) query_embedding
   limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_faqs(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.match_faqs(extensions.vector, int, float) to service_role;

-- ---------------------------------------------------------------------
-- Realtime（postgres_changes は RLS に従って配信される）
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations, public.messages;
  end if;
end;
$$;
