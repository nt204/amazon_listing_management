import type { Metadata } from "next";
import { headers } from "next/headers";
import { SupPortal } from "@/components/fulfill/sup-portal";
import { resolveSupAccount } from "@/lib/fulfill/sup-db";

export const metadata: Metadata = {
  title: "Supplier requests",
  robots: { index: false, follow: false },
};

// Trang xưởng — CHỈ ĐỌC. Nhận diện bằng email Cloudflare Access trong bảng fulfill_sup_accounts,
// không dùng tài khoản nội bộ (không gọi resolveActorFromHeaders để tránh tạo user chờ duyệt).
export default async function SupPage() {
  const headerStore = await headers();
  const account = await resolveSupAccount(headerStore);

  if (!account) {
    return (
      <div className="fulfill-root grid min-h-dvh place-items-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">No access</h1>
          <p className="mt-2 text-sm text-(--ff-muted)">This email has no supplier account. Contact NCE to get access.</p>
          <a href="/cdn-cgi/access/logout" className="mt-4 inline-block text-sm font-medium text-(--ff-accent) hover:underline">
            Sign out
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fulfill-root min-h-dvh">
      <SupPortal name={account.display_name || account.sup_names.join(", ")} email={account.email} />
    </div>
  );
}
