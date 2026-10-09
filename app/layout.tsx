import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-app-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NCE HUB",
  description: "NCE HUB - Amazon listing workflow and quality control workspace.",
  icons: {
    icon: "/icon.png",
    shortcut: "/favicon.ico",
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`h-full ${plusJakartaSans.variable}`}>
      <body className="h-full antialiased selection:bg-indigo-500 selection:text-white">{children}</body>
    </html>
  );
}
