import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SupPortal } from "@/components/fulfill/sup-portal";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { canAccessFulfill } from "@/lib/fulfill/access";
import { getSupAccountById, listSupAccounts, resolveSupAccount, supPreviewId } from "@/lib/fulfill/sup-db";

export const metadata: Metadata = {
  title: "Supplier requests",
  robots: { index: false, follow: false },
};

// Trang xưởng — CHỈ ĐỌC. Nhận diện bằng email Cloudflare Access trong bảng fulfill_sup_accounts.
// Team xem trước (cookie sup_preview, đặt từ tab Suppliers) phải có quyền Đi hàng nội bộ.
export default async function SupPage() {
  const headerStore = await headers();

  const previewId = supPreviewId(headerStore);
  if (previewId) {
    const { actor } = await resolveActorFromHeaders(headerStore);
    const account = actor && canAccessFulfill(actor) ? await getSupAccountById(previewId) : null;
    if (account) {
      return (
        <div className="fulfill-root min-h-dvh">
          <SupPortal name={account.display_name || account.sup_names.join(", ")} email={account.email} preview />
        </div>
      );
    }
  }

  const account = await resolveSupAccount(headerStore);

  if (!account) {
    // Nhân viên nội bộ mở thẳng /sup: chọn tài khoản xưởng để xem đúng như xưởng thấy (chế độ xem trước)
    const { actor } = await resolveActorFromHeaders(headerStore);
    if (actor && canAccessFulfill(actor)) {
      const accounts = (await listSupAccounts()).filter((a) => a.is_active);
      return (
        <div className="fulfill-root grid min-h-dvh place-items-center px-4 py-10">
          <div className="w-full max-w-md">
            <h1 className="text-xl font-semibold">View as a supplier</h1>
            <p className="mt-1 text-sm text-(--ff-muted)">Pick a supplier account to see exactly what they see.</p>
            {accounts.length ? (
              <ul className="mt-4 divide-y divide-(--ff-line) overflow-hidden rounded-xl border border-(--ff-line) bg-(--ff-side)">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/sup/preview?as=${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-(--ff-raised)">
                      <span className="min-w-0">
                        <span className="block font-medium">{a.display_name || a.sup_names.join(", ")}</span>
                        <span className="block truncate text-xs text-(--ff-muted)">{a.sup_names.join(", ")} · {a.email}</span>
                      </span>
                      <span className="shrink-0 text-sm font-medium text-(--ff-accent)">View</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-(--ff-muted)">No supplier accounts yet. Add one in Fulfill → Suppliers.</p>
            )}
            <Link href="/fulfill" className="mt-4 inline-block text-sm font-medium text-(--ff-accent) hover:underline">← Back to Fulfill</Link>
          </div>
        </div>
      );
    }
    return (
      <div className="fulfill-root grid min-h-dvh place-items-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">No access</h1>
          <p className="mt-2 text-sm text-(--ff-muted)">This email has no supplier account. Contact NCE to get access.</p>
          <a href={process.env.NODE_ENV === "production" ? "/cdn-cgi/access/logout" : "/api/sup/dev-login"} className="mt-4 inline-block text-sm font-medium text-(--ff-accent) hover:underline">
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
