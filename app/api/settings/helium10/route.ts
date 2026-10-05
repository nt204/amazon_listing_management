import { NextResponse } from "next/server";
import {
  getHelium10PlaywrightConfig,
  saveHelium10PlaywrightCookies,
  validateHelium10Session,
} from "@/lib/helium10-playwright";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    const config = await getHelium10PlaywrightConfig();

    if (action === "test") {
      if (!config.cookies?.trim()) {
        return NextResponse.json({
          status: "not_configured",
          valid: false,
          error: "Chưa cấu hình Cookie Helium 10.",
        });
      }

      const testResult = await validateHelium10Session(config.cookies);
      return NextResponse.json({
        valid: testResult.valid,
        status: testResult.valid ? "configured" : "expired",
        plan: testResult.plan || config.plan,
        accountId: testResult.accountId || config.accountId,
        error: testResult.error,
        testedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: config.status,
      updatedAt: config.updatedAt,
      lastTestedAt: config.lastTestedAt,
      hasCookies: Boolean(config.cookies?.trim()),
      plan: config.plan,
      accountId: config.accountId,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lấy cấu hình Helium 10.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write");
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
      plan: updatedConfig.plan,
      accountId: updatedConfig.accountId,
      message: "Lưu Cookie Helium 10 thành công! Kết nối API Cerebro & Magnet hoạt động tốt.",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      error instanceof Error ? error.message : "Lỗi khi lưu Cookie Helium 10.",
      400,
    );
  }
}
