import { NextResponse } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { openH10InteractiveLoginWindow } from "@/scripts/open-h10-interactive-login-window";

export const runtime = "nodejs";
export const maxDuration = 180;

let isLoginInProgress = false;

export async function POST(request: Request) {
  try {
    await authorize(request, "write");

    if (isLoginInProgress) {
      return NextResponse.json(
        { error: "Phiên đăng nhập Helium 10 đang diễn ra trong một cửa sổ Chrome. Vui lòng kiểm tra màn hình máy tính." },
        { status: 409 }
      );
    }

    isLoginInProgress = true;
    try {
      const email = process.env.HELIUM10_EMAIL || "haonguyen36928@gmail.com";
      const password = process.env.HELIUM10_PASSWORD || "Nce147@@2026";
      const totpSecret = process.env.HELIUM10_TOTP_SECRET || "UOOUD6QB6DZ46NIM";

      const cookies = await openH10InteractiveLoginWindow({
        email,
        password,
        totpSecret,
      });

      return NextResponse.json({
        success: true,
        message: "Đăng nhập Helium 10 thành công! Đã tự động cập nhật Cookie phiên làm việc.",
        cookieCount: cookies.length,
      });
    } finally {
      isLoginInProgress = false;
    }
  } catch (error) {
    return routeErrorResponse(
      error,
      error instanceof Error ? error.message : "Lỗi khi tự động đăng nhập Helium 10.",
      500
    );
  }
}
