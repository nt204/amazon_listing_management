import { NextResponse } from "next/server";
import { getSellerSpriteConfig, saveSellerSpriteCookies, saveSellerSpriteToken } from "@/lib/sellersprite";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "sellersprite");
    const config = await getSellerSpriteConfig();
    return NextResponse.json({
      status: config.status,
      updatedAt: config.updatedAt,
      lastTestedAt: config.lastTestedAt,
      hasCookies: Boolean(config.cookies?.trim()),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lấy cấu hình SellerSprite.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "sellersprite");
    const body = (await readJsonBody(request)) as { cookies?: string; token?: string };

    if (body?.token && typeof body.token === "string" && body.token.trim().length > 10) {
      const res = await saveSellerSpriteToken(body.token);
      return NextResponse.json({
        success: true,
        status: "configured",
        updatedAt: res.updatedAt,
        message: "Lưu Token SellerSprite thành công!",
      });
    }

    if (!body?.cookies || typeof body.cookies !== "string") {
      return NextResponse.json(
        { error: "Vui lòng cung cấp Extension Token hoặc chuỗi Cookie hợp lệ." },
        { status: 400 },
      );
    }

    const updatedConfig = await saveSellerSpriteCookies(body.cookies);
    return NextResponse.json({
      success: true,
      status: updatedConfig.status,
      updatedAt: updatedConfig.updatedAt,
      message: "Lưu Cookie SellerSprite thành công!",
    });
  } catch (error) {
    return routeErrorResponse(error, error instanceof Error ? error.message : "Lỗi khi lưu cấu hình SellerSprite.", 400);
  }
}
