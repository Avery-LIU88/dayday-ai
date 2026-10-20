import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DayDay AI · 每天一点，跟上 AI。",
  description: "免费，无需注册。聚合 AI 公司动态、论文、媒体、Newsletter、开发者平台和行业事件。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
