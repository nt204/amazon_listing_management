// Đi hàng đang khoá để phát triển: chỉ các email trong danh sách này được vào trang /fulfill và API /api/fulfill.
// Mở cho người khác thì thêm email vào đây (hoặc bỏ khoá) rồi deploy.
export const FULFILL_ALLOWED_EMAILS = ["ndtrince@gmail.com"];

export function canAccessFulfill(actor?: { email?: string | null } | null): boolean {
  const email = actor?.email?.trim().toLowerCase();
  return !!email && FULFILL_ALLOWED_EMAILS.includes(email);
}
