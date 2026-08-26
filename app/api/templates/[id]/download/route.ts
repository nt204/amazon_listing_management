import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { templateWorkbookDownloadName } from "@/lib/amazon-template-catalog";
import { getListingTemplate } from "@/lib/db";

export const runtime = "nodejs";

type DownloadRouteContext = {
  params: Promise<{ id: string }>;
};

function contentDisposition(filename: string) {
  const safeAscii = filename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150) || "Amazon-Template.xlsx";
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, { params }: DownloadRouteContext) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { id } = await params;
    const template = await getListingTemplate(scope, id);
    if (!template) throw new ApiError("Template không còn tồn tại.", 404);

    const filename = templateWorkbookDownloadName(template);
    const contentType = template.file_extension.toLowerCase() === ".xlsm"
      ? "application/vnd.ms-excel.sheet.macroEnabled.12"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new Response(new Uint8Array(template.workbook), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(template.workbook.byteLength),
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải template Amazon.", 500);
  }
}
