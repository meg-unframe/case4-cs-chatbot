# BOTANICA CSチャットボット（案件4）

AIエンジニア講座「案件4：フルスタックCSチャットボット」の開発用リポジトリ。
**BOTANICA は教材の架空ブランド**です。実在店舗・他案件のデータ、DB、顧客情報は使用しません。

## 本番環境

| 画面 | URL |
|---|---|
| 顧客画面（埋め込みデモ） | https://case4-cs-chatbot-eight.vercel.app |
| チャットウィジェット単体 | https://case4-cs-chatbot-eight.vercel.app/widget |
| 管理画面（オペレーター） | https://case4-cs-chatbot-eight.vercel.app/operator/login |
| 埋め込みスクリプト | https://case4-cs-chatbot-eight.vercel.app/widget-embed.js |

ホスティングは Vercel で、GitHub の `main` と連携しています。

## MVPの範囲

| 機能 | 内容 |
|---|---|
| 顧客ウィジェット | ECサイトに埋め込む React 製チャット |
| AI自動応答 | 質問を OpenAI `text-embedding-3-small`（1536次元）で埋め込み、pgvector で検索した上位3件の FAQ を根拠に Claude API で回答 |
| 有人引き継ぎ | 回答不能・クレーム時に `waiting_operator` へ |
| オペレーター画面 | 会話一覧・詳細・返信 |
| Supabase | 会話保存、認証、Realtime、RLSによる権限分離 |
| 営業時間 | 10:00〜18:00（日本時間）。時間外は AI 対応のみで、翌営業日に対応（営業日は未確定。現在は仮設定で月〜金・祝日なし） |
| 公開 | Vercel |

**Phase2（今回は対象外）:** Shopify在庫・配送API連携、分析ダッシュボード、感情分析

## 技術スタック

Next.js 15（App Router・TypeScript）／React 19／Supabase（Postgres・Auth・Realtime・pgvector）／Claude API（回答生成）／OpenAI Embeddings（`text-embedding-3-small`、1536次元、FAQ検索のみ）／Vercel

## ディレクトリ構成

```
supabase/
  migrations/20261116000000_init.sql  テーブル・制約・インデックス・RLS・RPC・Realtime
  tests/rls_smoke.sql                 RLSスモークテスト（ROLLBACKするので副作用なし）
data/README.md                        FAQ18件・テスト8件の配置予定（未配置）
src/
  types/domain.ts                     会話状態・送信者の定数とリテラル型
  types/database.ts                   Supabase の Database 型（マイグレーションと一致）
  lib/env.ts                          環境変数の取得（公開値／サーバー専用値を分離）
  lib/supabase/client.ts              ブラウザ用クライアント＋匿名サインイン
  lib/supabase/server.ts              サーバー用クライアント＋オペレーター判定
  lib/supabase/admin.ts               service_role クライアント（サーバー専用）
  lib/ai/anthropic.ts                 Claude API クライアント（サーバー専用）
  lib/business-hours.ts               営業時間判定・次回営業開始日時
  middleware.ts                       Supabase セッションCookie更新
  app/                                画面（現状はプレースホルダー）
```

## DB設計

### テーブル

- **conversations**: `id` / `customer_session_id` / `status` / `assigned_operator_id` / `category` / `created_at`
- **messages**: `id` / `conversation_id` / `sender_type` / `sender_id` / `content` / `created_at`
- **faqs**: `id` / `category` / `question` / `answer` / `embedding VECTOR(1536)` / `created_at`

会話状態は `ai_handling` / `waiting_operator` / `operator_handling` / `closed`、送信者は `customer` / `ai` / `operator` です。どちらも CHECK 制約で固定しています。

### 指定カラム定義に追加した制約

- `conversations.status`、`messages.conversation_id`、各 `created_at` に `NOT NULL` を付与
- `customer_session_id` の既定値を `auth.uid()::text` に設定
- `operator_handling` のときは `assigned_operator_id` を必須にする
- `sender_type = 'ai'` なら `sender_id` は NULL、`customer` / `operator` なら必須
- `content` は空文字を禁止し、4000字以内に制限
- `faqs` の各テキスト列で空文字を禁止
- インデックスを作成：会話（所有者・状態・担当者）、メッセージ（会話×日時）、FAQ（カテゴリ、埋め込みの HNSW コサイン）

### 権限設計（RLS）

| 操作 | 顧客（匿名認証） | オペレーター | サーバー（service_role） |
|---|---|---|---|
| 会話 参照 | `customer_session_id = auth.uid()` の行のみ | 全件 | 全件 |
| 会話 作成 | 自分名義・`ai_handling`・担当者なしのみ | － | ○ |
| 会話 更新 | ✕（引き継ぎ要求は RPC `request_operator_handoff` のみ） | ○（ID・所有者・作成日時はトリガーで変更不可） | ○ |
| メッセージ 参照 | 自分の会話のみ | 全件 | 全件 |
| メッセージ 投稿 | `sender_type='customer'`・`sender_id=auth.uid()`・未クローズの自分の会話のみ | `sender_type='operator'`・`sender_id=auth.uid()` のみ | AI応答を保存 |
| メッセージ 更新・削除 | ✕ | ✕ | ○ |
| FAQ | ✕ | 参照のみ | 検索（`match_faqs`）・投入 |

- 匿名ユーザーも `authenticated` ロールになるため、`auth.role()` だけでは許可しません。すべて行の所有者かオペレーターかで判定します。
- オペレーターは `public.is_operator()` で判定します。条件は、JWT の `app_metadata.role = 'operator'` で、かつ匿名ユーザーでないことです。顧客が変更できる `user_metadata` は使いません。
- `anon`（未ログイン）からは全テーブルの権限を剥奪しています。
- Realtime（`postgres_changes`）も RLS に従って配信されます。

### 要件の解釈

- 顧客が `sender_type`・`status`・担当者を偽装できないようにしています。顧客には UPDATE 権限を与えません。メッセージの投稿は、自分名義の `customer` に限定しています。
- AI判定による引き継ぎ（回答不能・クレーム）は、サーバーが service_role で状態を更新する前提です。その前に、リクエストユーザーが会話の所有者であることを必ずサーバー側で確認します。

## 接続設定手順

> 秘密値は `.env.local` と Vercel の環境変数にだけ置きます。コミット・共有・画面表示はしません。

1. **Supabase プロジェクトを作成する**（案件4専用。他案件のプロジェクトは流用しない）。✅ 作成済み（Data API オン／新規テーブルの自動公開オフ／自動RLS オン）
   - 自動公開がオフなので、テーブルと関数の権限はマイグレーション内の `GRANT` で明示的に付与している。`anon` には付与しない。
2. **Authentication → Sign In / Providers** で **Anonymous sign-ins** を有効にする。✅ 有効化済み。不正利用対策として CAPTCHA（Turnstile 等）も検討する。
3. **マイグレーションを適用する。** SQL Editor に `supabase/migrations/20261116000000_init.sql` を貼り付けて実行する。CLI を使う場合は `npx supabase link` → `npx supabase db push`。✅ 2026-11-17 適用済み（SQL Editor）
4. **RLSを確認する。** SQL Editor で `supabase/tests/rls_smoke.sql` を実行し、`all checks passed` が出ることを確認する。✅ 2026-11-17 合格
5. **Realtime を確認する。** Database → Publications の `supabase_realtime` に `conversations` と `messages` が含まれていることを確認する。✅ RLSテスト内で確認済み
6. **オペレーターを作成する。** Authentication → Users でメール＋パスワードのユーザーを作り、SQL Editor で権限を付与する。
   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"role":"operator"}'
    where email = '<オペレーターのメール>';
   ```
   付与後、オペレーターは再ログインしてJWTを更新する。
7. **環境変数を設定する。** `cp .env.example .env.local` を実行し、エディタで値を入力する（チャットやターミナルに貼らない）。✅ 設定済み・接続確認済み（Supabase／Claude API／OpenAI Embeddings）
   - Supabase の値は Project Settings → Data API（URL）と API Keys にある。新形式のキー（`sb_publishable_...` / `sb_secret_...`）も従来形式（anon / service_role）も、同じ変数名に入れてよい。
8. **起動する。** `npm install` → `npm run dev` で http://localhost:3000 を開く。
9. **FAQを投入する。** 教材の FAQ 18件を `data/` に配置し、`faqs` に登録してから `npm run embed:faqs -- --yes` で埋め込みを生成する。✅ 2026-11-17 投入・埋め込み生成済み
10. **Vercelへデプロイする。** リポジトリを連携し、7 と同じ環境変数を Production / Preview に設定する。 ✅ デプロイ済み（GitHub の `main` と連携）

### 環境変数

| 変数 | 公開範囲 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ブラウザ可 | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ブラウザ可 | publishable key または anon key（RLS前提） |
| `SUPABASE_SERVICE_ROLE_KEY` | **サーバー専用** | secret key または service_role key（AI応答の保存・FAQ検索） |
| `ANTHROPIC_API_KEY` | **サーバー専用** | Claude API |
| `ANTHROPIC_MODEL` | サーバー | 省略時 `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | **サーバー専用** | 埋め込み（`text-embedding-3-small`）。回答生成には使わない |

## 開発コマンド

```bash
npm run dev        # 開発サーバー
npm run typecheck  # 型チェック
npm run lint       # ESLint
npm run build      # 本番ビルド
npm test           # 単体テスト（外部APIを呼ばない）
npm run eval       # 教材のテスト会話8件の評価（Claude・OpenAI・Supabase を実際に呼ぶ）
npm run embed:faqs                 # embedding 未設定の FAQ 件数を確認（書き込まない）
npm run embed:faqs -- --yes        # 未設定の FAQ の埋め込みを生成・保存（--all で全件作り直し）
npm run search:faqs -- "質問文"     # 埋め込み検索の上位3件を表示（DB は変更しない）
```

## 運用マニュアル

現在の実装に合わせた運用手順。秘密値（パスワード・APIキー・環境変数の値）は、この README・チャット・チケットなどに書かない。

### 役割

| 役割 | 主な作業 | 必要な権限 |
|---|---|---|
| オペレーター | 管理画面で問い合わせに対応する | `app_metadata.role = "operator"` のアカウント |
| 管理者 | オペレーターの管理、FAQ の更新、デプロイ、障害対応 | Supabase・Vercel・GitHub・Anthropic・OpenAI の管理画面、`.env.local` |

### オペレーターの日常業務

1. https://case4-cs-chatbot-eight.vercel.app/operator/login にログインする。
2. 一覧上部の「待ち ○件」と「オペレーター待ち」タブで、対応待ちの会話を確認する。一覧は「オペレーター待ちが先頭、その中は更新が新しい順」で、最新100件を表示する。新着は Realtime で反映される。
3. 会話を開き、AI の回答と顧客の発言を確認する。
4. 「担当する」を押す。返信を送った場合も、自動で「対応中・担当＝自分」になる。**対応中になると AI は応答しない。**
5. 返信する（Enter で送信、Shift+Enter で改行）。
6. 解決したら「完了にする」を押す。完了した会話には返信できず、顧客は新しい会話を始める（完了した会話を再び開く機能はない）。

| 会話の状態 | 意味 | オペレーターの対応 |
|---|---|---|
| AI対応中 | AI が FAQ をもとに回答中 | 原則不要。必要なら返信すれば対応中に切り替わる |
| オペレーター待ち | 回答不能・クレーム・個別の手続き、または顧客が担当者を希望 | 優先して対応する |
| オペレーター対応中 | 担当者が対応中 | 担当者が最後まで対応する。他人が担当中の会話を引き継ぐときは確認が出る |
| 完了 | 対応終了 | なし |

### 営業時間と時間外

- 営業時間は 10:00〜18:00（日本時間）。営業日は**仮設定**（月〜金・祝日なし）。
- 時間外も AI は FAQ をもとに回答する。有人対応が必要な場合は「オペレーター待ち」になり、顧客には「翌営業日（○月○日 10:00）以降に対応します」と表示される。
- 翌営業日の始業時に「オペレーター待ち」を上から順に対応する。
- 営業日・休業日・時間を変えるときは、`src/lib/business-hours.ts` の `OPEN_HOUR`・`CLOSE_HOUR`・`BUSINESS_DAYS`・`HOLIDAYS` を変更し、テストを通してから `main` に push する（Vercel が自動デプロイ）。

### オペレーターアカウントの管理（管理者）

- **追加:** 接続設定手順 6 のとおり、Supabase の Authentication → Users でユーザーを作成し、SQL で `app_metadata.role = "operator"` を付与する。付与後、本人に再ログインしてもらう。`user_metadata` は本人が変更できるため、権限には使わない。
- **権限の削除:** SQL で `raw_app_meta_data` から `role` を外す（`raw_app_meta_data - 'role'`）。またはユーザー自体を削除する。担当していた会話の担当者欄は空になる。
- **パスワードの再設定:** アプリには「パスワードを忘れた」機能がない。また、受信できないメールアドレスには再設定メールが届かない。そのため管理者が、信頼できる端末から Secret key を使う Supabase の管理用 API（`auth.admin.updateUserById`）で再設定する。ユーザー ID・権限・会話はそのまま残る。新しいパスワードは安全な乱数で生成し、画面・ログ・ファイルに出さずに本人へ渡す。
- テスト用のオペレーターは、運用開始・提出前に削除する。

### デプロイと設定変更

- `main` に push すると Vercel が自動でデプロイする。デプロイの前に `npm run typecheck && npm run lint && npm test && npm run build` を通す。
- 環境変数は「環境変数」の表のとおり。Vercel で値を変えたら再デプロイが必要。`NEXT_PUBLIC_` で始まる値はビルド時に埋め込まれる。
- キーを再発行（ローテーション）するときの手順:
  1. 各サービスで新しいキーを発行する。
  2. Vercel の環境変数と手元の `.env.local` を更新する。
  3. 再デプロイし、動作を確認する。
  4. 古いキーを無効化する。
- DB の変更は既存のマイグレーションを書き換えず、`supabase/migrations/` に新しいファイルを追加し、SQL Editor で適用する。適用後に `supabase/tests/rls_smoke.sql` を実行して `all checks passed` を確認する。

### 定期確認

| 頻度 | 確認すること | 方法 |
|---|---|---|
| 毎営業日 | 対応待ちの会話が残っていないか | 管理画面の「待ち ○件」 |
| 毎週 | 本番が応答しているか | `/api/business-hours` が 200、認証なしの `POST /api/chat` が 401 |
| 毎週 | デプロイが成功しているか | Vercel のダッシュボード、または GitHub の最新コミットに付く Vercel の状態表示 |
| 毎月 | 利用量と費用 | Anthropic・OpenAI・Supabase・Vercel の各ダッシュボード。利用額の上限と通知を設定しておく |

### トラブル対応

| 症状 | 主な原因 | 対応 |
|---|---|---|
| 顧客画面に「AIが一時的に応答できません」（503） | Claude または OpenAI の障害・キーの失効・利用上限 | 顧客のメッセージは保存されている。各サービスの状態とキー・上限を確認する。急ぎの会話はオペレーターが返信する |
| 顧客画面に「送信が集中しています。少し時間をおいてから…」（429） | 同じ顧客が60秒間に10件以上送信した | 時間をおけば解消する。上限は `src/lib/ai/chat-http.ts` の `RATE_LIMIT_*` |
| 管理画面に「オペレーター権限がありません」 | `app_metadata.role` が未設定、または付与後に再ログインしていない | 権限を確認し、再ログインしてもらう |
| 新着が画面に出ない | Realtime の接続切れ | 画面を再読み込みする（読み込み時に最新の状態を取り直す） |
| ECサイトにチャットボタンが出ない | スクリプトの URL の誤り、または埋め込み先が許可されていない | `widget-embed.js` の URL と、`next.config.ts` の `frame-ancestors` を確認する |
| AI の回答が不正確・FAQ と合わない | FAQ の不足・古い埋め込み | 「FAQメンテナンスガイド」に沿って FAQ を見直す |

### データの扱い

- 会話には顧客の入力内容が保存される。削除する場合は、SQL Editor で `conversations` を削除する（メッセージは連動して削除される）。
- 匿名ユーザーと完了済みの会話は自動では削除されない。保存期間と削除の手順は未整備。

## FAQメンテナンスガイド

FAQ は `public.faqs` に保存する。AI は質問文の埋め込みで FAQ を検索し、**上位3件**だけを根拠に回答する。FAQ にない事実は回答しない。

### 前提

- 教材の原本 `data/case4-faq.csv` は改変しない。運用で FAQ を変えるときは DB を更新し、変更内容（日付・番号・理由）を記録する。
- 各列の決まり:
  - `faq_no`: 1以上の一意の整数。テストの期待値（「FAQ No.X を根拠に」）が番号を参照するため、**削除した番号は再利用しない**。新規は現在の最大番号＋1にする。
  - `category`: `在庫`・`配送`・`返品`・`商品質問`・`その他` のいずれか。AI が会話に付けるカテゴリもこの5種類に固定されている（`src/lib/ai/responder.ts` の `FAQ_CATEGORIES`）。新しいカテゴリを増やす場合は、コードの変更が必要。
  - `question`・`answer`: 空にしない。回答は FAQ の文面がそのまま根拠になるため、事実だけを簡潔に書く。
- 埋め込み（`embedding`）は「カテゴリ・質問・回答」をつなげた文から作る（`scripts/embed-faqs.mjs`）。**文面を変えたら、埋め込みも作り直す。**
- 書き込みは Supabase の SQL Editor（管理者）か Secret key で行う。ログイン済みユーザーやオペレーターには FAQ の書き込み権限がない。

### FAQ を追加する

1. SQL Editor で追加する。
   ```sql
   insert into public.faqs (faq_no, category, question, answer)
   values (19, '配送', '<質問>', '<回答>');
   ```
2. 手元で、埋め込みが未設定の件数を確認する（書き込まない）。
   ```bash
   npm run embed:faqs
   ```
3. 埋め込みを生成して保存する（未設定の FAQ だけが対象）。
   ```bash
   npm run embed:faqs -- --yes
   ```
4. 「確認」の手順で検索結果を確かめる。

### FAQ を編集する

1. SQL Editor で更新し、同時に埋め込みを空にする。
   ```sql
   update public.faqs
      set answer = '<新しい回答>', embedding = null
    where faq_no = 4;
   ```
2. `npm run embed:faqs -- --yes` で、空にした FAQ の埋め込みを作り直す。
   - 複数の FAQ をまとめて直した場合や、埋め込みの作り方を変えた場合は、`npm run embed:faqs -- --yes --all` で全件を作り直す。
3. 「確認」の手順で検索結果を確かめる。

### FAQ を削除する

```sql
delete from public.faqs where faq_no = 18;
```

埋め込みは行と一緒に消える。番号は欠番のままにする。テスト会話（`data/case4-test-conversations.csv`）が参照している番号を削除する場合は、評価の期待値も見直す。

### 確認

1. 想定される質問で、上位3件に目的の FAQ が入ることを確認する（DB は変更しない）。
   ```bash
   npm run search:faqs -- "送料はいくらですか？"
   ```
2. 埋め込みの未設定が0件であることを確認する（`npm run embed:faqs` で「対象: 0 件」）。埋め込みが未設定の FAQ は検索に出てこない。
3. 回答に影響する変更をした場合は、教材のテスト会話8件の評価を実行する。Claude・OpenAI を実際に呼ぶため、少額の費用がかかる。
   ```bash
   npm run eval
   ```
4. 本番の顧客画面で、実際に質問して回答を確かめる。

### 注意

- `embed:faqs`・`search:faqs`・`eval` は手元の `.env.local` の接続先（本番と同じ Supabase）に対して動く。実行前に接続先を確認する。
- 類似度の下限は設けていない。似た FAQ が多いと上位3件から目的の FAQ が外れることがあるため、質問文は顧客の言い回しに近づけ、FAQ どうしの内容の重複を避ける。

## 並行開発の担当範囲（Git Worktree ＋ Subagents）

`main` を統合ブランチとし、3領域をそれぞれ別の worktree・ブランチで開発します。DB と共通型は特定の領域に属さない**共有基盤**として `main` で管理します。

```bash
git worktree add ../case4-customer-ui -b feat/customer-ui
git worktree add ../case4-operator-ui -b feat/operator-ui
git worktree add ../case4-ai-backend  -b feat/ai-backend
```

| 領域 | ブランチ | 担当ファイル | 主な作業 |
|---|---|---|---|
| 顧客UI | `feat/customer-ui` | `src/components/widget/**`、`src/app/widget/**`、`public/widget-embed.js`、`src/app/page.tsx`（埋め込みデモ） | ECサイト埋め込みウィジェット、匿名サインイン、会話作成、メッセージ送受信と Realtime 表示、引き継ぎ要求ボタン、営業時間外の表示 |
| 管理画面 | `feat/operator-ui` | `src/app/operator/**`、`src/components/operator/**`、`src/app/api/operator/**` | オペレーターログイン、会話一覧（状態フィルタ）、詳細、返信、担当割当・状態変更、Realtime 更新 |
| AIバックエンド | `feat/ai-backend` | `src/app/api/chat/**`、`src/app/api/business-hours/**`、`src/lib/ai/**`、`eval/**`、`scripts/**`、`data/**` | チャットAPI、FAQ検索と Claude 応答、引き継ぎ判定（回答不能・クレーム）、営業時間外の応答文、FAQ 18件の投入と埋め込み生成、テスト 8件の実行 |

**共有基盤**（どの領域の worktree でも直接変更しない）:

| 対象 | ファイル |
|---|---|
| DB | `supabase/migrations/**`、`supabase/tests/**` |
| 共通型・API仕様 | `src/types/**`（チャットAPIの仕様は `src/types/chat-api.ts`） |
| 共通ライブラリ | `src/lib/supabase/**`、`src/lib/env.ts`、`src/lib/business-hours.ts` |
| 設定 | `package.json`、`package-lock.json`、`.env.example`、`next.config.ts`、`src/middleware.ts`、`vitest.config.mts`、`test/**` |

ルール:

- 共有基盤の変更が必要になったら、統合担当（メインセッション）が `main` で小さくコミットする。各 worktree は `git rebase main` でそれを取り込む。
- 顧客UIと AIバックエンドの間のチャットAPIの入出力は、AIバックエンドが先に型として `src/types/` に追加する（共有基盤なので `main` 経由）。
- スキーマの変更は既存マイグレーションを書き換えず、`supabase/migrations/` に新しいファイルを追加する。
- 各ブランチは `npm run typecheck && npm run lint && npm run build` を通してから `main` に統合する。
- 秘密情報（`.env.local`）は各 worktree に手動でコピーし、コミットしない。

## 現在の状態

### 実施済み

- Next.js 雛形、依存関係（Supabase・Anthropic SDK）
- マイグレーション SQL、RLS テスト SQL、共通型、接続処理、営業時間ロジック
- `typecheck` / `lint` / `build` が成功
- Supabase（案件4専用プロジェクト）への接続確認、マイグレーション適用（2026-11-17）
- 未ログインのユーザーが拒否されることを API 経由で確認
- 実環境での RLS テスト `rls_smoke.sql` に合格（2026-11-17）
- Claude API の接続確認（`claude-sonnet-4-6` で短い呼び出しが成功、2026-11-17）
- OpenAI Embeddings の接続確認（`text-embedding-3-small` で1回呼び出し、1536次元を確認、2026-11-17）
- FAQ 18件の埋め込みの生成と保存（`npm run embed:faqs -- --yes`、1536次元×18件、2026-11-17）。テスト No.2・3・8 の質問で、期待どおりの FAQ が検索の上位に入ることを確認
- `faq_no` 列を追加するマイグレーションの適用と、FAQ 18件の投入（CSV と完全一致を照合済み、2026-11-17）。テスト 8件は `data/` に配置済み

- 3領域の実装（Worktree＋Subagents で並行開発し main に統合、2026-11-17）
  - 顧客UI: `/widget`（iframe用チャット）、`public/widget-embed.js`（ECサイト埋め込み）、`/`（埋め込みデモ）
  - AIバックエンド: `POST /api/chat`、`POST /api/chat/handoff`、`GET /api/business-hours`、FAQ上位3件＋Claude 応答、有人切替判定、営業時間外の案内
  - 管理画面: `/operator/login`、`/operator`（会話一覧）、`/operator/conversations/[id]`（詳細・返信・担当・完了）
- 教材のテスト会話 8件の評価 `npm run eval` が **8/8 合格**（結果は `eval/results/latest.md`。No.7 は火曜22時として評価）
- 実環境の結合テスト（ローカルの本番ビルド＋案件4の Supabase）が **31/31 合格**。認証・顧客間の権限分離（RLS／API 404）・送信者や状態の偽装防止・有人切替（クレーム／顧客リクエスト）・待機中は AI が応答しない・オペレーターの担当／返信／完了・Realtime 配信（本人には届き、他の顧客には届かない）・入力検証。作成した匿名ユーザー・一時オペレーター・会話は削除済み
- GitHub（Private リポジトリ）への公開と、Vercel への本番デプロイ。本番環境で主要機能の動作を確認（下記「動作テストの結果」）

## 動作テストの結果

確認した環境ごとに分けて記載する。✅ は確認済み、⬜ は未確認。

### 本番環境で確認済み（https://case4-cs-chatbot-eight.vercel.app ）

本番公開後、顧客画面と管理画面を別々のブラウザセッションで開いて確認した。

| 機能 | 結果 | 確認した内容 |
|---|---|---|
| AI 自動応答 | ✅ | FAQ に基づく回答が顧客画面に表示された |
| 営業時間外の対応 | ✅ | 営業時間外は AI が対応し、翌営業日 10:00 以降にオペレーターが対応する旨の案内が表示された |
| オペレーターへの引き継ぎ | ✅ | 会話が「オペレーター待ち」になり、管理画面の一覧に表示された |
| オペレーターの手動返信 | ✅ | 管理画面からの返信が顧客画面に表示された |
| 会話の完了 | ✅ | 管理画面で完了にすると顧客画面に反映された |
| 新しい会話の開始 | ✅ | 完了後、顧客画面から新しい会話を始められた |

あわせて、本番 URL の応答を読み取りで確認した。

- `/`・`/widget`・`/widget-embed.js`・`/operator/login`・`/api/business-hours` は 200
- 未ログインで `/operator` を開くとログイン画面へ転送（307）
- 認証なしの `/api/chat` は 401
- GitHub の `main` の最新コミットで、Vercel のビルドが成功

### 本番と同じ Supabase、ローカルのアプリで確認済み（本番 URL では未再実施）

| テスト | 結果 | 内容 |
|---|---|---|
| RLS テスト `supabase/tests/rls_smoke.sql` | ✅ 合格 | RLS の有効化、ポリシーの数、Realtime の設定、顧客間の分離、`user_metadata` による権限の偽装の拒否、匿名ユーザーをオペレーター扱いしないこと |
| 教材のテスト会話 8件 `npm run eval` | ✅ 8/8 合格 | FAQ 上位3件を根拠にした回答、有人切替（複雑な問い合わせ・クレーム）、捏造の抑制、営業時間外（No.7 は火曜22時として評価）、複数 FAQ の参照。結果は `eval/results/latest.md` |
| 結合テスト（ローカルの本番ビルド） | ✅ 31/31 合格 | 認証、顧客間の権限分離（RLS・API 404・Realtime）、送信者や状態の偽装防止、有人切替（クレーム・顧客の依頼）、待機中は AI が応答しない、オペレーターの担当・返信・完了、Realtime 配信、入力検証。テストで作ったユーザーと会話は削除済み。スクリプトはリポジトリに含まれない |
| 実ブラウザ（ローカル開発サーバー、2026-11-17〜18） | ✅ | 営業時間外の有人切替、双方向メッセージ、会話の完了、新しい会話の開始、「返品したい」での返品条件と翌営業日の案内 |
| 単体テスト `npm test` | ✅ 62件合格 | 営業時間、AI 出力の検証、画面側のロジックなど |

### 未確認

| 項目 | 内容 |
|---|---|
| ⬜ エスカレーションのリアルタイム通知 | 顧客がエスカレーションした瞬間に、開いている管理画面へ再読み込みなしで反映され、「待ち ○件」が増えること（実装はあるが、観察した記録がない） |
| ⬜ 本番 URL での結合テスト | 31項目を本番 URL に対して再実行していない |
| ⬜ 別ドメインへの埋め込み | ECサイトなど別ドメインのページからウィジェットを開いて会話が続くこと（iframe 内の localStorage、Safari の制限） |
| ⬜ 日本語IMEでの Enter | 変換を確定する Enter で送信されないこと |
| ⬜ スマホ表示 | スマホ幅でのウィジェットと管理画面の表示 |
| ⬜ 営業時間内の有人切替の案内 | 営業時間内の「おつなぎします」の案内を実ブラウザで見ていない（評価・単体テストでは確認済み） |
| ⬜ 複数オペレーターの同時操作 | 担当の取り合いなど |
| ⬜ 本番での応答時間 | AI 応答までの時間を計測していない |

## ECサイトへの埋め込み

```html
<script src="https://case4-cs-chatbot-eight.vercel.app/widget-embed.js" defer></script>
```

右下にチャットボタンが表示され、クリックで `/widget` を iframe で開く。現在の `next.config.ts` では `/widget` が `frame-ancestors *`（どのサイトからでも埋め込める）になっている。運用時は、埋め込む ECサイトのドメインに限定する。

## 検証で分かったこと

- **Realtime の時間差:** 購読開始（`SUBSCRIBED`）の通知後、サーバー側で配信が始まるまでに少し時間差がある。購読直後の変更を取りこぼさないよう、顧客UI・管理画面とも購読開始の直後と `REALTIME_REFILL_DELAY_MS`（2.5秒）後にデータを取り直す。
- **類似度:** FAQ 検索の上位の類似度は 0.20〜0.77。下限は設けず、根拠の有無の判断は Claude に任せている。

### 教材の要件に対する状況

| 要件 | 状況 | 本番で確認済み | 未確認 |
|---|---|---|---|
| ECサイトに埋め込む React 製ウィジェット | 完了（埋め込み範囲は未限定） | 埋め込みデモからの会話 | 別ドメインへの埋め込み、スマホ表示、IME |
| FAQ に基づく Claude の自動応答 | 完了 | AI 自動応答 | 応答時間の計測 |
| 回答不能・クレームの有人引き継ぎ | 完了 | オペレーターへの引き継ぎ | 管理画面へのリアルタイム通知の観察、営業時間内の案内 |
| 管理画面（一覧・詳細・返信） | 完了 | 手動返信、会話の完了 | 複数オペレーターの同時操作 |
| Supabase（保存・認証・Realtime・RLS） | 完了 | 返信・完了の顧客画面への反映 | 本番 URL での結合テスト（RLS テストは本番と同じ Supabase で合格済み） |
| 営業時間 10〜18 時、時間外は AI 対応と翌営業日の案内 | 完了（営業日は仮設定） | 営業時間外の対応 | 営業日・休業日の確定 |
| Vercel へのデプロイ | **完了** | 本番 URL で全画面が応答、ビルド成功 | － |

### 残りの作業（優先順）

1. **未確認項目の確認:** 上の「未確認」の表。特に、エスカレーションのリアルタイム通知と、本番 URL での結合テスト。
2. **埋め込みの本番設定:** `next.config.ts` の `/widget` の `frame-ancestors *` を、埋め込むECサイトのドメインに限定する。
3. **営業日の確定:** 教材・依頼者に確認し、`src/lib/business-hours.ts` の `BUSINESS_DAYS` と `HOLIDAYS` を更新する。
4. **運用と安全:**
   - 本番用のオペレーターアカウントを作成し、テスト用オペレーターは提出・運用開始前に削除する。
   - 匿名サインインの乱用対策として CAPTCHA を検討する。
   - メールでの新規登録を止めるか検討する。オペレーターは管理者が作成するため。
   - Anthropic と OpenAI に利用額の上限を設定する。
5. **後片付け:**
   - 動作確認で作った会話とユーザーを、残すか削除するか決める。
   - 作業用の worktree 3つ（`.env.local` のコピーを含む）と、統合済みの作業ブランチを削除する。

### Phase2（対象外）

Shopify 在庫・配送 API 連携、分析ダッシュボード、感情分析

### 暫定の前提（要確認）

- **営業日は未確定。** 現在の「月〜金・祝日なし」は動作確認用の**仮設定**です。確定したら `src/lib/business-hours.ts` の `BUSINESS_DAYS`（曜日）と `HOLIDAYS`（休業日）を更新します。
- 営業時間 10:00〜18:00（日本時間）は確定です。
