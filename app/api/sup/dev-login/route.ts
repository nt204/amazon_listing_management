import { NextResponse } from "next/server";

/**
 * CHỈ máy local: đăng nhập thử trang xưởng dưới email một tài khoản xưởng.
 *   http://localhost:2411/api/sup/dev-login?email=xuong@example.com   → vào /sup
 *   http://localhost:2411/api/sup/dev-login                           → thoát
 * Production luôn trả 404 (đăng nhập thật qua Cloudflare Access).
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  const host = req.headers.get("host") ?? url.host;
  const response = NextResponse.redirect(new URL("/sup", `${url.protocol}//${host}`));
  if (email) response.cookies.set("dev_sup_email", email, { path: "/", httpOnly: true, sameSite: "lax" });
  else response.cookies.delete("dev_sup_email");
  return response;
}
