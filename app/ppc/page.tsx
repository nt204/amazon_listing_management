import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PpcDashboard } from "@/components/ppc/ppc-dashboard";
import { actorFromCookieHeader } from "@/lib/auth";

export const metadata: Metadata = {
  title: "PPC Analytics & Command Center | NCE HUB",
  description: "Báo cáo quảng cáo Amazon đa store, thống kê số liệu thực tế, cảnh báo lãng phí và gợi ý tối ưu giá thầu.",
};

export default async function PpcPage() {
  const headerStore = await headers();
  if (!actorFromCookieHeader(headerStore.get("cookie"))) redirect("/");
  return <PpcDashboard />;
}
