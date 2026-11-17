import Script from "next/script";
import { getBusinessHoursStatus } from "@/lib/business-hours";
import styles from "@/components/widget/EmbedDemo.module.css";

// 現在の営業状態をリクエストごとに表示するため動的レンダリング
export const dynamic = "force-dynamic";

// 埋め込みデモ: 架空ブランド BOTANICA の商品ページ風の画面に widget-embed.js を読み込む。
// 掲載内容は FAQ に記載のある事実のみ（価格など FAQ にない情報は載せない）。
export default function Home() {
  const hours = getBusinessHoursStatus();

  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <span className={styles.brand}>BOTANICA</span>
        <span className={styles.demoTag}>埋め込みデモ（架空ブランド）</span>
      </header>

      <main className={styles.main}>
        <section className={styles.product} aria-labelledby="product-name">
          <div className={styles.visual} aria-hidden="true">
            <svg viewBox="0 0 120 160" width="120" height="160">
              <rect x="38" y="8" width="44" height="20" rx="4" fill="#2f6b4f" />
              <rect x="24" y="28" width="72" height="124" rx="16" fill="#e7f0ea" stroke="#2f6b4f" strokeWidth="2" />
              <path
                d="M60 118c-14-6-20-18-18-34 14 2 22 12 18 34Zm0 0c14-6 20-18 18-34-14 2-22 12-18 34Z"
                fill="#2f6b4f"
                opacity=".75"
              />
            </svg>
          </div>

          <div>
            <p className={styles.series}>ボタニカシリーズ</p>
            <h1 id="product-name" className={styles.name}>
              ボタニカローション
            </h1>
            <ul className={styles.features}>
              <li>無香料・無着色・パラベンフリー</li>
              <li>敏感肌の方にもお使いいただけます（心配な場合はパッチテストをおすすめします）</li>
            </ul>

            <p className={styles.label}>容量</p>
            <div className={styles.sizes}>
              <span className={styles.size}>150ml</span>
              <span className={styles.size}>300ml</span>
            </div>

            <dl className={styles.notes}>
              <div>
                <dt>送料</dt>
                <dd>全国一律550円／5,000円（税込）以上のご購入で送料無料</dd>
              </div>
              <div>
                <dt>お届け</dt>
                <dd>ご注文確定から2〜4営業日</dd>
              </div>
              <div>
                <dt>返品・交換</dt>
                <dd>未開封の商品に限り、商品到着後8日以内</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={styles.help}>
          <h2>お問い合わせ</h2>
          <p>
            画面右下のチャットボタンから、AIアシスタントにご質問いただけます。担当者（オペレーター）の対応は営業時間
            10:00〜18:00（日本時間）です。
          </p>
          <p className={styles.hoursNow}>
            現在: {hours.isOpen ? "営業時間内" : `営業時間外（次回対応: ${hours.nextOpenLabel}）`}
          </p>
        </section>
      </main>

      {/* ECサイトに貼る1行（<script src="https://<ホスト>/widget-embed.js" defer>）と同等の読み込み */}
      <Script src="/widget-embed.js" strategy="afterInteractive" />
    </div>
  );
}
