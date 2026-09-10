import { NextResponse } from "next/server";
import { getHelium10PlaywrightConfig, saveHelium10PlaywrightCookies } from "@/lib/helium10-playwright";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const config = await getHelium10PlaywrightConfig();
    return NextResponse.json({
      status: config.status,
      updatedAt: config.updatedAt,
      lastTestedAt: config.lastTestedAt,
      hasCookies: Boolean(config.cookies?.trim()),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lấy cấu hình Helium 10.", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    const body = (await readJsonBody(request)) as { cookies?: string };

    if (!body?.cookies || typeof body.cookies !== "string") {
      return NextResponse.json(
        { error: "Vui lòng cung cấp chuỗi Cookie Helium 10 hợp lệ." },
        { status: 400 },
      );
    }

    const updatedConfig = await saveHelium10PlaywrightCookies(body.cookies);
    return NextResponse.json({
      success: true,
      status: updatedConfig.status,
      updatedAt: updatedConfig.updatedAt,
      message: "Lưu Cookie Helium 10 thành công!",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      error instanceof Error ? error.message : "Lỗi khi lưu Cookie Helium 10.",
      400,
    );
  }
}
