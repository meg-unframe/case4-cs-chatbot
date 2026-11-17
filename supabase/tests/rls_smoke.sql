-- =====================================================================
-- RLS スモークテスト（未実行）
-- Supabase の SQL Editor か `supabase db` 接続の psql で、マイグレーション適用後に実行する。
-- 全体を1トランザクションで実行し、最後に ROLLBACK するのでデータは残らない。
-- 期待どおりでない場合は RAISE EXCEPTION で停止する。
-- =====================================================================
begin;

-- テスト用ユーザー（auth.users へ直接作成。ロールバックで消える）
insert into auth.users (id, aud, role, email, raw_app_meta_data, is_anonymous)
values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', null, '{}', true),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, '{}', true),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'op@example.test',
   '{"role":"operator"}', false);

-- 顧客A として振る舞う
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true,"app_metadata":{}}', true);

insert into public.conversations (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.messages (conversation_id, sender_type, sender_id, content)
values ('11111111-1111-1111-1111-111111111111', 'customer', '00000000-0000-0000-0000-00000000000a', 'テスト');

-- 顧客A が AI を名乗る投稿 → 拒否されるべき
do $$ begin
  begin
    insert into public.messages (conversation_id, sender_type, content)
    values ('11111111-1111-1111-1111-111111111111', 'ai', 'なりすまし');
    raise exception 'NG: 顧客がaiメッセージを投稿できた';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

-- 顧客A が status を直接変更 → 0行（UPDATEポリシーなし）
do $$ declare n int; begin
  update public.conversations set status = 'closed' where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'NG: 顧客がstatusを変更できた'; end if;
end $$;

-- 顧客B として振る舞う：A の会話は見えない
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true,"app_metadata":{}}', true);
do $$ begin
  if exists (select 1 from public.conversations) then raise exception 'NG: 他人の会話が見える'; end if;
  if exists (select 1 from public.messages)      then raise exception 'NG: 他人のメッセージが見える'; end if;
end $$;

-- 顧客B が user_metadata で operator を名乗っても見えない
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true,"app_metadata":{},"user_metadata":{"role":"operator"}}', true);
do $$ begin
  if exists (select 1 from public.conversations) then raise exception 'NG: user_metadataでオペレーター権限を得た'; end if;
end $$;

-- 匿名顧客は、JWT の app_metadata に role=operator が入っていてもオペレーター扱いしない
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true,"app_metadata":{"role":"operator"}}', true);
do $$ begin
  if public.is_operator() then raise exception 'NG: 匿名ユーザーがオペレーター判定された'; end if;
  if exists (select 1 from public.conversations) then raise exception 'NG: 匿名ユーザーが他人の会話を見られる'; end if;
end $$;

-- 顧客A：所有者列は列権限で更新不可
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true,"app_metadata":{}}', true);
do $$ begin
  begin
    update public.conversations set customer_session_id = 'x' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'NG: customer_session_id を更新できた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 未ログイン(anon)：テーブル権限なし
reset role;
do $$ begin
  if has_table_privilege('anon', 'public.conversations', 'select')
     or has_table_privilege('anon', 'public.messages', 'select')
     or has_table_privilege('anon', 'public.faqs', 'select') then
    raise exception 'NG: anon にテーブル権限がある';
  end if;
  if has_table_privilege('authenticated', 'public.messages', 'update')
     or has_table_privilege('authenticated', 'public.messages', 'delete')
     or has_table_privilege('authenticated', 'public.conversations', 'delete') then
    raise exception 'NG: authenticated に不要な更新・削除権限がある';
  end if;
end $$;
set local role authenticated;

-- オペレーター：全会話が見え、返信できる
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","is_anonymous":false,"app_metadata":{"role":"operator"}}', true);
do $$ begin
  if not exists (select 1 from public.conversations) then raise exception 'NG: オペレーターが会話を見られない'; end if;
end $$;
insert into public.messages (conversation_id, sender_type, sender_id, content)
values ('11111111-1111-1111-1111-111111111111', 'operator', '00000000-0000-0000-0000-0000000000c1', '担当します');

select 'RLS smoke test: all checks passed' as result;
rollback;
