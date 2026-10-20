import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知更 AI · 少一点噪声，多一点洞见",
  description: "在一个地方阅读 AI 资讯、发现深度节目、追踪值得关注的更新。",
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
