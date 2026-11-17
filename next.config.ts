import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 顧客ウィジェットは ECサイトへ iframe で埋め込む。
        // 本番では frame-ancestors を ECサイトのドメインに限定する（README 参照）。
        source: "/widget/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        // 管理画面は埋め込み禁止（クリックジャッキング対策）
        source: "/operator/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
