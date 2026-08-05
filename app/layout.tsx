import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listing Desk",
  description: "Amazon listing workflow and quality control workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
