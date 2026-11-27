import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { SUP_PREVIEW_COOKIE, getSupAccountById } from "@/lib/fulfill/sup-db";

/**
 * Team xem trước trang xưởng: /api/sup/preview?as=<id tài khoản xưởng> → /sup như xưởng đó thấy.
 * /api/sup/preview (không có as) → thoát xem trước, về /fulfill. Chỉ người có quyền Đi hàng nội bộ.
 */
export async function GET(req: Request) {
  try {
    await authorizeFulfill(req, "read");
    const url = new URL(req.url);
    const base = `${url.protocol}//${req.headers.get("host") ?? url.host}`;
    const as = url.searchParams.get("as") ?? "";
    if (!as) {
      const response = NextResponse.redirect(new URL("/fulfill", base));
      response.cookies.delete(SUP_PREVIEW_COOKIE);
      return response;
    }
    if (!(await getSupAccountById(as))) return NextResponse.json({ error: "Supplier account not found." }, { status: 404 });
    const response = NextResponse.redirect(new URL("/sup", base));
    response.cookies.set(SUP_PREVIEW_COOKIE, as, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error) {
    return routeErrorResponse(error, "Could not open the supplier preview.");
  }
}
