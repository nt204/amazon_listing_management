import { z } from "zod";
import { createAmazonTemplate } from "@/lib/excel-automation";
import { getListingTemplate } from "@/lib/db";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { generatedListingSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const exportSchema = z.object({
  template_id: z.uuid(),
  items: z.array(
    z.object({
      sku: z.string().trim().min(1).max(120),
      image_urls: z.array(z.url()).min(1).max(10),
      brand: z.string().trim().max(120),
      listing: generatedListingSchema,
    }),
  ).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const payload = exportSchema.parse(await readJsonBody(request, 3_000_000));
    const template = await getListingTemplate(scope, payload.template_id);
    if (!template) throw new ApiError("Template đã chọn không còn tồn tại.", 404);
    const output = await createAmazonTemplate(template.workbook, template.original_filename, payload.items);
    const campaign = payload.items[0]?.sku.replace(/[^A-Za-z0-9_-]/g, "-") || "listing";
    const templateName = template.name.replace(/[^A-Za-z0-9_-]/g, "-") || "Amazon-Template";
    const isMacro = output.extension === ".xlsm";
    return new Response(output.workbook, {
      headers: {
        "Content-Type": isMacro
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${templateName}-${campaign}${output.extension}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return routeErrorResponse(new ApiError(error.issues[0]?.message || "Dữ liệu xuất không hợp lệ.", 400), "Không thể xuất template.");
    }
    return routeErrorResponse(error, "Không thể xuất template Amazon.");
  }
}
