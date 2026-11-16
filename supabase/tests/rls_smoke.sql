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
