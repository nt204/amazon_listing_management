import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PpcDashboard } from "@/components/ppc/ppc-dashboard";
import { resolveActorFromHeaders } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "PPC Analytics & Command Center | NCE HUB",
  description: "Báo cáo quảng cáo Amazon đa store, thống kê số liệu thực tế, cảnh báo lãng phí và gợi ý tối ưu giá thầu.",
};

export default async function PpcPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; subTab?: string; store?: string }>;
}) {
  const headerStore = await headers();
  const { actor, status } = await resolveActorFromHeaders(headerStore);

  if (status !== "approved" || !actor) {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <PpcDashboard
      actor={actor}
      initialTab={params.tab as any}
      initialSubTab={params.subTab as any}
      initialStore={params.store}
    />
  );
}
