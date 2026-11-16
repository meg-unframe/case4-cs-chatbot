# data/

教材から提供される以下のデータを後で配置する（**内容は創作しない**）。

| 予定ファイル | 内容 | 状態 |
|---|---|---|
| `faqs.json`（形式は教材に合わせる） | BOTANICA FAQ 18件（category / question / answer） | 未配置 |
| `test-cases.json` | 応答テスト 8件 | 未配置 |

FAQは `public.faqs` に投入し、`embedding`（1536次元）を生成して保存する。
埋め込み生成に使うプロバイダーは未決定（Claude API は埋め込みを提供しないため別途選定が必要）。
