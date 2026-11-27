import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { AccessStatusScreen } from "@/components/access-status-screen";
import { FulfillPortal } from "@/components/fulfill/fulfill-portal";

export const metadata: Metadata = {
  title: "NCE Fulfill - Quản Lý Sản Xuất & Đóng Gói FBA",
  description: "Cổng quản lý đợt đặt hàng gửi xưởng gia công, đồng bộ thiết kế, đóng gói FBA và tiến độ sản xuất.",
};

export default async function FulfillPage() {
  const headerStore = await headers();
  const { actor, status, email } = await resolveActorFromHeaders(headerStore);

  if (status !== "approved" || !actor) {
    return <AccessStatusScreen status={status} email={email} />;
  }

  return <FulfillPortal actor={actor} />;
}
