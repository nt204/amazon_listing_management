import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listing Desk",
  description: "Internal Amazon listing generation and review workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
