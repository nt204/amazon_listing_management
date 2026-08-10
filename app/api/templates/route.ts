import { extname } from "node:path";
import { inspectListingTemplate } from "@/lib/excel-automation";
import { listListingTemplates, saveListingTemplate } from "@/lib/db";
import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    return Response.json({ templates: await listListingTemplates(scope) });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách template.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_templates"));
    enforceRequestSize(request, 15_000_000);
    const formData = await request.formData();
    const name = String(formData.get("name") || "").trim();
    const template = formData.get("template");
    if (!name || name.length > 120) throw new ApiError("Tên template phải có từ 1 đến 120 ký tự.", 400);
    if (!(template instanceof File)) throw new ApiError("Hãy chọn file template Amazon.", 400);
    if (template.size > 12_000_000) throw new ApiError("Template vượt quá 12 MB.", 413);
    const extension = extname(template.name).toLowerCase();
    if (![".xlsx", ".xlsm"].includes(extension)) throw new ApiError("Chỉ hỗ trợ .xlsx hoặc .xlsm.", 400);
    const workbook = Buffer.from(await template.arrayBuffer());
    const inspection = await inspectListingTemplate(workbook, template.name);
    const { product_type, ...metadata } = inspection;
    const saved = await saveListingTemplate(scope, {
      name,
      originalFilename: template.name,
      fileExtension: extension,
      productType: product_type,
      metadata,
      workbook,
    });
    return Response.json({ template: saved }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu template Amazon.");
  }
}
