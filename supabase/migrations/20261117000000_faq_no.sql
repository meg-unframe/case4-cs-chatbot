-- =====================================================================
-- faqs に FAQ番号（教材CSVの「番号」列）を追加
--   テストの期待値（「FAQ No.9を根拠に」など）と、AIが根拠にしたFAQを照合するため。
--   前提: faqs は空の状態で適用する（NOT NULL を付けるため）。
-- =====================================================================

alter table public.faqs
  add column faq_no integer not null;

alter table public.faqs
  add constraint faqs_faq_no_positive check (faq_no > 0),
  add constraint faqs_faq_no_key unique (faq_no);

-- 列の追加はテーブル単位の GRANT に含まれるため、権限の再設定は不要
-- （authenticated: select のみ / service_role: 読み書き）

-- match_faqs の戻り値に faq_no を追加（戻り値の型が変わるため作り直す）
drop function public.match_faqs(extensions.vector, int, float);

create function public.match_faqs(
  query_embedding extensions.vector(1536),
  match_count     int   default 5,
  min_similarity  float default 0.0
)
returns table (
  id         uuid,
  faq_no     integer,
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
  select f.id, f.faq_no, f.category, f.question, f.answer,
         1 - (f.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.faqs f
   where f.embedding is not null
     and 1 - (f.embedding operator(extensions.<=>) query_embedding) >= min_similarity
   order by f.embedding operator(extensions.<=>) query_embedding
   limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_faqs(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.match_faqs(extensions.vector, int, float) to service_role;
