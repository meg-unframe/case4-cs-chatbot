import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOTANICA カスタマーサポート",
  description: "BOTANICA（架空ブランド）のCSチャットボット",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
