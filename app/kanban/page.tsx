import { headers } from "next/headers";
import Link from "next/link";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { KanbanBoard } from "@/components/kanban/kanban-board";

export const metadata = {
  title: "Kanban Góp Ý & Báo Lỗi - NCE HUB",
  description: "Bảng theo dõi và tiếp nhận ý kiến, báo lỗi hệ thống.",
};

export default async function KanbanPage() {
  const headerStore = await headers();
  const { actor } = await resolveActorFromHeaders(headerStore);

  return (
    <div className="font-accounting-system flex min-h-[100dvh] w-full flex-col overflow-hidden bg-slate-50">
      {/* Top Banner Navigation */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            ← Về Trang Chủ
          </Link>
          <span className="truncate text-xs font-extrabold text-slate-900 tracking-tight">
            NCE HUB - Kanban Ý Kiến &amp; Báo Lỗi
          </span>
        </div>
        {actor && (
          <div className="hidden shrink-0 text-xs font-medium text-slate-600 sm:block">
            Đăng nhập: <span className="font-bold text-slate-800">{actor.displayName || actor.userId}</span>
          </div>
        )}
      </div>

      {/* Main Kanban Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <KanbanBoard currentUser={actor ? { displayName: actor.displayName, email: actor.email } : undefined} />
      </div>
    </div>
  );
}
