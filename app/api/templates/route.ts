import { extname } from "node:path";
import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { normalizePhoiKey } from "@/lib/amazon-template-catalog";
import { inspectListingTemplate, scanListingTemplate } from "@/lib/excel-automation";
import {
  deleteListingTemplate,
  getBrandProfile,
  listBrandProfiles,
  listListingTemplates,
  moveListingTemplateToShop,
  resolveAmazonShopFromTemplate,
  saveBrandProfile,
  saveListingTemplate,
} from "@/lib/db";
import type { BrandProfile, ListingTemplateMetadata } from "@/lib/types";
import { z } from "zod";

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_templates"));
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Thiếu ID template" }, { status: 400 });
    const success = await deleteListingTemplate(scope, id);
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa template.");
  }
}
export const runtime = "nodejs";
export const maxDuration = 120;

const phoiNameSchema = z.string().trim().min(2).max(120).refine(
  (value) => Boolean(normalizePhoiKey(value)),
  "Tên phôi phải có ít nhất một chữ cái hoặc chữ số.",
);

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
    const template = formData.get("template");
    if (!(template instanceof File)) throw new ApiError("Hãy chọn file template Amazon.", 400);
    if (template.size > 12_000_000) throw new ApiError("Template vượt quá 12 MB.", 413);
    const extension = extname(template.name).toLowerCase();
    if (![".xlsx", ".xlsm"].includes(extension)) throw new ApiError("Chỉ hỗ trợ .xlsx hoặc .xlsm.", 400);
    const blankWorkbook = Buffer.from(await template.arrayBuffer());
    const scan = await scanListingTemplate(blankWorkbook, template.name);
    const requestedPhoiName = String(formData.get("phoi_name") || "").trim();
    const parsedPhoiName = requestedPhoiName
      ? phoiNameSchema.safeParse(requestedPhoiName)
      : null;
    if (parsedPhoiName && !parsedPhoiName.success) {
      throw new ApiError(parsedPhoiName.error.issues[0]?.message || "Tên phôi không hợp lệ.", 400);
    }
    if (!scan.contributor_id) {
      throw new ApiError("Không tìm thấy mã shop trong file. Hãy tải đúng template trực tiếp từ Seller Central.", 400);
    }
    if (!scan.product_type || (!scan.phoi_name && !parsedPhoiName?.data)) {
      throw new ApiError("Không nhận diện được loại phôi trong file template Amazon.", 400);
    }

    const detectedStoreName = scan.store_name?.trim() || "";
    let brandProfileId = String(formData.get("brand_profile_id") || "").trim();
    let resolvedBrand: BrandProfile | null = null;

    if (detectedStoreName) {
      const allBrands = await listBrandProfiles(scope);
      const existing = allBrands.find(
        (b) => b.name.localeCompare(detectedStoreName, undefined, { sensitivity: "accent" }) === 0,
      );
      if (existing) {
        resolvedBrand = existing;
      } else {
        resolvedBrand = await saveBrandProfile(scope, detectedStoreName, "");
      }
    } else if (z.uuid().safeParse(brandProfileId).success) {
      resolvedBrand = await getBrandProfile(scope, brandProfileId);
    }

    if (!resolvedBrand) {
      throw new ApiError("Hãy chọn hoặc nạp file có thông tin Store / Thương hiệu hợp lệ.", 400);
    }

    const brandName = resolvedBrand.name;
    const finalBrandProfileId = resolvedBrand.id;

    let shop;
    try {
      shop = await resolveAmazonShopFromTemplate(scope, {
        contributorId: scan.contributor_id,
        shopKey: scan.shop_key,
        brandName,
      });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : "Không thể xác minh tài khoản của Brand.", 409);
    }
    const phoiName = parsedPhoiName?.data || scan.phoi_name;
    const phoiKey = normalizePhoiKey(phoiName);

    let workbook: Buffer = blankWorkbook;
    let isBlank = false;
    let metadata: ListingTemplateMetadata;
    let productType = scan.product_type;

    try {
      const inspection = await inspectListingTemplate(workbook, template.name);
      productType = inspection.product_type || productType;
      const { product_type, ...inspectedMeta } = inspection;
      metadata = inspectedMeta;
      isBlank = false;
    } catch {
      isBlank = true;
      metadata = {
        is_blank: true,
        is_ready: false,
        warning_reason: "File blank chưa có dòng mẫu Parent/Child. Hãy điền dòng mẫu vào file Excel rồi tải lại.",
        sheet_name: scan.sheet_name || "Template",
        attribute_row: scan.attribute_row || 3,
        label_row: scan.label_row || 2,
        data_row: scan.data_row || 4,
        column_count: scan.column_count || 0,
        last_column: "",
        source_parent_row: 0,
        source_child_row: 0,
        content_columns: { sku: "", title: "", description: "", bullet_points: [], generic_keywords: "", main_image: "" },
        defaults: { material: "", size_capacity: "", color: "", package_contents: "", features: [], country_of_origin: "" },
      };
    }

    const name = `${shop.name} - ${phoiName}`;
    const saved = await saveListingTemplate(scope, {
      shopId: shop.id,
      brandProfileId: finalBrandProfileId || null,
      brandName,
      phoiName,
      phoiKey,
      sourceTemplateId: null,
      isAutoMapped: false,
      name,
      originalFilename: template.name,
      fileExtension: extension,
      productType,
      metadata,
      workbook,
    });

    return Response.json({
      template: saved,
      shop,
      scan,
      brand: resolvedBrand,
      is_blank: isBlank,
      is_ready: !isBlank,
      warning: isBlank
        ? `Đã nhận diện store "${shop.name}" và lưu file template của phôi "${phoiName}". Lưu ý: File này CHƯA THỂ DÙNG vì chưa có dòng mẫu Parent/Child. Hãy điền dòng mẫu vào file Excel rồi tải lại.`
        : null,
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu template Amazon.");
  }
}

const moveTemplateSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
}).strict();

export async function PATCH(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_templates"));
    const payload = moveTemplateSchema.parse(await request.json());
    const success = await moveListingTemplateToShop(scope, payload.id, payload.shop_id);
    if (!success) throw new ApiError("Template hoặc shop không còn tồn tại.", 404);
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Không thể đổi shop cho template.");
  }
}
