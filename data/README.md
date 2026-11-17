# data/

教材から提供されたデータ（BOTANICA は架空ブランド）。**内容は創作・改変しない。**

| ファイル | 内容 | 件数 | 列 |
|---|---|---|---|
| `case4-faq.csv` | FAQ | 18件（在庫3・配送4・返品3・商品質問4・その他4） | 番号, カテゴリ, 質問, 回答 |
| `case4-test-conversations.csv` | 応答テスト | 8件 | 番号, シナリオ, 顧客メッセージ, 期待されるAIの挙動, 検証する機能 |

- 文字コードは UTF-8（BOMなし）、改行は LF。2026-11-17 に `~/Downloads` からコピーした。
- FAQ の「番号」は `public.faqs.faq_no` に入れる（`supabase/migrations/20261117000000_faq_no.sql`）。テストの期待値「FAQ No.X を根拠に」と照合するため。

## DBへの投入

- ✅ 2026-11-17: 案件4の Supabase の `public.faqs` に18件を投入した。`faq_no` が一意なので、同じ番号の行は入らない（再実行しても重複しないことを確認済み）。
- 番号・カテゴリ・質問・回答が CSV と完全に一致することを照合済み（不一致0件、CSVにない行0件）。
- `faqs` には、`faq_no`・`category`・`question`・`answer` に CSV の値をそのまま入れる。
- `embedding`（1536次元）は**未設定**（18件すべて NULL）。別途生成する。埋め込みを作るサービスは未決定（Claude API は埋め込みを提供しない）。
- 投入は service_role で行う（authenticated には insert 権限がない）。
