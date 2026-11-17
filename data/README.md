# data/

教材から提供されたデータ（BOTANICA は架空ブランド）。**内容は創作・改変しない。**

| ファイル | 内容 | 件数 | 列 |
|---|---|---|---|
| `case4-faq.csv` | FAQ | 18件（在庫3・配送4・返品3・商品質問4・その他4） | 番号, カテゴリ, 質問, 回答 |
| `case4-test-conversations.csv` | 応答テスト | 8件 | 番号, シナリオ, 顧客メッセージ, 期待されるAIの挙動, 検証する機能 |

- 文字コードは UTF-8（BOMなし）、改行は LF。2026-11-17 に `~/Downloads` からコピーした。
- FAQ の「番号」は `public.faqs.faq_no` に入れる（`supabase/migrations/20261117000000_faq_no.sql`）。テストの期待値「FAQ No.X を根拠に」と照合するため。

## DBへの投入（未実施）

- `faqs` には、`faq_no`・`category`・`question`・`answer` に CSV の値をそのまま入れる。
- `embedding`（1536次元）は別途生成する。埋め込みを作るサービスは未決定（Claude API は埋め込みを提供しない）。
- 投入は service_role で行う（authenticated には insert 権限がない）。
