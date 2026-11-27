import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { AccessStatusScreen } from "@/components/access-status-screen";
import { FulfillPortal } from "@/components/fulfill/fulfill-portal";

const fulfillMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500"],
  variable: "--font-fulfill-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Đi Hàng - Quản Lý Sản Xuất & Đóng Gói FBA",
  description: "Đặt sản xuất hàng FBA với xưởng: tạo đợt, gửi phiếu, theo dõi in, đóng gói và ship.",
};

export default async function FulfillPage() {
  const headerStore = await headers();
  const { actor, status, email } = await resolveActorFromHeaders(headerStore);

  if (status !== "approved" || !actor) {
    return <AccessStatusScreen status={status} email={email} />;
  }

  // Trước mắt chỉ admin và kế toán thấy
  if (actor.role !== "admin" && actor.role !== "accountant") {
    return <AccessStatusScreen status="no_features" email={email} />;
  }

  return (
    <div className={`fulfill-root ${fulfillMono.variable}`}>
      <FulfillPortal actor={actor} />
    </div>
  );
}
