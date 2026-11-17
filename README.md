# BOTANICA CSチャットボット（案件4）

AIエンジニア講座「案件4：フルスタックCSチャットボット」の開発用リポジトリ。
**BOTANICA は教材の架空ブランド**です。実在店舗・他案件のデータ、DB、顧客情報は使用しません。

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
10. **Vercelへデプロイする。** リポジトリを連携し、7 と同じ環境変数を Production / Preview に設定する。

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

## ECサイトへの埋め込み

```html
<script src="https://<デプロイ先のホスト>/widget-embed.js" defer></script>
```

右下にチャットボタンが表示され、クリックで `/widget` を iframe で開く。本番では `next.config.ts` の `/widget` の `frame-ancestors *` を ECサイトのドメインに限定する。

## 検証で分かったこと

- **Realtime の時間差:** 購読開始（`SUBSCRIBED`）の通知後、サーバー側で配信が始まるまでに少し時間差がある。購読直後の変更を取りこぼさないよう、顧客UI・管理画面とも購読開始の直後と `REALTIME_REFILL_DELAY_MS`（2.5秒）後にデータを取り直す。
- **類似度:** FAQ 検索の上位の類似度は 0.20〜0.77。下限は設けず、根拠の有無の判断は Claude に任せている。

### 未実施

- Vercel へのデプロイ（環境変数の設定、`frame-ancestors` の本番ドメインへの限定）
- 実ブラウザでの画面操作の確認（日本語IMEでの Enter、スマホ表示、埋め込みの開閉）。API・DB・Realtime はスクリプトで確認済み
- 本番用オペレーターアカウントの作成（接続設定手順 6）
- 営業時間外の判定を実際の時刻で通すE2E（評価では時刻を指定して確認済み）

### 暫定の前提（要確認）

- **営業日は未確定。** 現在の「月〜金・祝日なし」は動作確認用の**仮設定**です。確定したら `src/lib/business-hours.ts` の `BUSINESS_DAYS`（曜日）と `HOLIDAYS`（休業日）を更新します。
- 営業時間 10:00〜18:00（日本時間）は確定です。
