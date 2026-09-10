import { z } from "zod";
import {
  ApiError,
  authorize,
  dataScope,
  readJsonBody,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  listCustomMockupTemplates,
  saveCustomMockupTemplate,
  deleteCustomMockupTemplate,
} from "@/lib/db";
import {
  ALL_BUILTIN_TEMPLATES,
  type ProductTemplateSpec,
} from "@/lib/template-mockup-types";

export const runtime = "nodejs";

const saveTemplateSchema = z.object({
  id: z.string().trim().optional(),
  category: z.string().trim().min(1).max(64).default("box"),
  name: z.string().trim().min(1, "Tên phôi không được để trống.").max(200),
  badge: z.string().trim().max(64).default("Custom"),
  description: z.string().trim().max(1000).default(""),
  promptInstruction: z.string().trim().max(2000).default(""),
  accessories: z.array(z.string().trim()).optional(),
  imageData: z.string().min(10, "Vui lòng tải lên ảnh phôi hợp lệ."),
  contentType: z.string().trim().default("image/png"),
});

export async function GET(request: Request) {
  try {
    let customTemplates: ProductTemplateSpec[] = [];
    try {
      const scope = dataScope(authorize(request, "read"));
      const records = await listCustomMockupTemplates(scope.teamId);
      customTemplates = records.map((rec) => ({
        id: rec.id,
        category: rec.category,
        name: rec.name,
        badge: rec.badge || "Custom",
        description: rec.description,
        promptInstruction: rec.promptInstruction,
        accessories: rec.accessories || [],
        templateDataUrl: rec.imageData,
        isCustom: true,
      }));
    } catch {
      // Fallback if DB is not ready or user is not logged in
      customTemplates = [];
    }

    const allTemplates = [...ALL_BUILTIN_TEMPLATES, ...customTemplates];
    return Response.json(
      { templates: allTemplates, customCount: customTemplates.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách template.");
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const body = saveTemplateSchema.parse(await readJsonBody(request, 15_000_000));

    const saved = await saveCustomMockupTemplate({
      id: body.id,
      teamId: scope.teamId,
      category: body.category,
      name: body.name,
      badge: body.badge,
      description: body.description,
      promptInstruction: body.promptInstruction,
      accessories: body.accessories,
      imageData: body.imageData,
      contentType: body.contentType,
    });

    const templateSpec: ProductTemplateSpec = {
      id: saved.id,
      category: saved.category,
      name: saved.name,
      badge: saved.badge,
      description: saved.description,
      promptInstruction: saved.promptInstruction,
      accessories: saved.accessories || [],
      templateDataUrl: saved.imageData,
      isCustom: true,
    };

    return Response.json({
      success: true,
      template: templateSpec,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu template phôi.");
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) {
      throw new ApiError("ID template không hợp lệ.", 400);
    }
    const deleted = await deleteCustomMockupTemplate(id, scope.teamId);
    return Response.json({ success: deleted });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa template phôi.");
  }
}
