import fs from "node:fs";
import { Readable } from "node:stream";
import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getPpcFileDownloadUrl, resolvePpcLocalFilePath } from "@/lib/ppc/file-manager";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const url = new URL(request.url);
    const fileName = (url.searchParams.get("fileName") || "").trim();
    const r2Key = (url.searchParams.get("r2Key") || "").trim() || undefined;
    const serverPath = (url.searchParams.get("serverPath") || "").trim() || undefined;
    const format = (url.searchParams.get("format") || "redirect").toLowerCase();

    if (!fileName && !r2Key && !serverPath) {
      throw new ApiError("Vui lòng cung cấp tên file cần tải.", 400);
    }

    const effectiveFileName = fileName || (r2Key ? r2Key.split("/").pop() || "report.xlsx" : "report.xlsx");

    // 1. Thử lấy Presigned URL từ Cloudflare R2 trước (Tối ưu nhất: 0% tải máy chủ)
    if (r2Key || !serverPath) {
      const presignedUrl = await getPpcFileDownloadUrl({
        fileName: effectiveFileName,
        r2Key,
        expiresInSeconds: 1800, // 30 phút
      });

      if (presignedUrl) {
        if (format === "json") {
          return Response.json({
            success: true,
            downloadUrl: presignedUrl,
            fileName: effectiveFileName,
            source: "r2",
          });
        }
        return Response.redirect(presignedUrl, 302);
      }
    }

    // 2. Dự phòng: Nếu file lưu trên Server cục bộ (Streaming trực tiếp, không ngốn RAM)
    const localFilePath = resolvePpcLocalFilePath({
      fileName: effectiveFileName,
      serverPath,
    });

    if (localFilePath && fs.existsSync(localFilePath)) {
      if (format === "json") {
        const streamUrl = `/api/ppc/files/download?fileName=${encodeURIComponent(effectiveFileName)}&serverPath=${encodeURIComponent(localFilePath)}&format=stream`;
        return Response.json({
          success: true,
          downloadUrl: streamUrl,
          fileName: effectiveFileName,
          source: "server",
        });
      }

      const stat = fs.statSync(localFilePath);
      const isCsv = effectiveFileName.toLowerCase().endsWith(".csv");
      const contentType = isCsv
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      const asciiFileName = effectiveFileName
        .normalize("NFKD")
        .replace(/[^A-Za-z0-9 ._+()-]+/g, "")
        .replace(/\s+/g, " ")
        .trim() || "ppc_report.xlsx";

      const nodeStream = fs.createReadStream(localFilePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(effectiveFileName)}`,
          "Cache-Control": "no-store",
        },
      });
    }

    throw new ApiError(`Không tìm thấy file '${effectiveFileName}' trên Cloudflare R2 hoặc Server.`, 404);
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo liên kết tải file PPC.", 500);
  }
}
