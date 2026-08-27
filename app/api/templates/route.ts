import { extname } from "node:path";
import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { normalizePhoiKey } from "@/lib/amazon-template-catalog";
import { prepareStandaloneListingTemplate, scanStandaloneTemplateFields } from "@/lib/excel-automation";
import {
  deleteListingTemplate,
  getBrandProfile,
  listAmazonShops,
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

const templateFieldValuesSchema = z.record(
  z.string().min(1).max(500),
  z.string().trim().max(5000),
).refine(
  (values) => Object.keys(values).length <= 200,
  "File template có quá nhiều trường cần lưu.",
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
    let currentFieldValues: Record<string, string> | undefined = undefined;
    const rawFieldsString = formData.get("field_values");
    if (rawFieldsString) {
      try {
        const parsed = JSON.parse(String(rawFieldsString));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          currentFieldValues = parsed as Record<string, string>;
        }
      } catch {
        // ignore parsing error in scan mode
      }
    }
    const mode = String(formData.get("mode") || "save");
    const includeSetupFields = mode === "save" || String(formData.get("include_setup_fields") || "") === "true";
    const showExistingSetupFields = mode === "scan"
      && String(formData.get("show_existing_setup_fields") || "") === "true";
    const scan = await scanStandaloneTemplateFields(blankWorkbook, template.name, currentFieldValues, {
      includeSetupFields,
      showExistingSetupFields,
    });
    if (mode === "scan") {
      const { required_fields, managed_fields_count, ...templateScan } = scan;
      const detectedStoreName = scan.store_name?.trim() || "";
      const allBrands = await listBrandProfiles(scope);
      let matchedBrand = detectedStoreName
        ? allBrands.find((b) => b.name.localeCompare(detectedStoreName, undefined, { sensitivity: "accent" }) === 0) || null
        : null;

      let matchedShop: import("@/lib/types").AmazonShopSummary | null = null;
      if (scan.contributor_id) {
        const allShops = await listAmazonShops(scope);
        matchedShop = allShops.find((s) => s.contributor_id === scan.contributor_id) || null;
        if (!matchedBrand && matchedShop) {
          const shopToMatch = matchedShop;
          matchedBrand = allBrands.find(
            (b) => b.name.localeCompare(shopToMatch.name, undefined, { sensitivity: "accent" }) === 0,
          ) || null;
        }
      }

      return Response.json({
        scan: templateScan,
        required_fields,
        managed_fields_count,
        detected_brand: matchedBrand,
        detected_shop: matchedShop,
        detected_store_name: detectedStoreName || matchedShop?.name || matchedBrand?.name || "",
        detected_product_type: scan.product_type || "",
      });
    }
    if (mode !== "save") throw new ApiError("Chế độ xử lý template không hợp lệ.", 400);
    const requestedPhoiName = String(formData.get("phoi_name") || "").trim();
    const parsedPhoiName = phoiNameSchema.safeParse(requestedPhoiName);
    if (!parsedPhoiName.success) {
      throw new ApiError(parsedPhoiName.error.issues[0]?.message || "Tên phôi không hợp lệ.", 400);
    }
    if (!scan.contributor_id) {
      throw new ApiError("Không tìm thấy mã shop trong file. Hãy tải đúng template trực tiếp từ Seller Central.", 400);
    }
    if (!scan.product_type) {
      throw new ApiError("Không nhận diện được loại phôi trong file template Amazon.", 400);
    }

    const detectedStoreName = scan.store_name?.trim() || "";
    const brandProfileId = String(formData.get("brand_profile_id") || "").trim();
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
    const phoiName = parsedPhoiName.data;
    const phoiKey = normalizePhoiKey(phoiName);

    let rawFieldValues: unknown = {};
    try {
      rawFieldValues = JSON.parse(String(formData.get("field_values") || "{}"));
    } catch {
      throw new ApiError("Dữ liệu các trường template không hợp lệ.", 400);
    }
    const parsedFieldValues = templateFieldValuesSchema.safeParse(rawFieldValues);
    if (!parsedFieldValues.success) {
      throw new ApiError(parsedFieldValues.error.issues[0]?.message || "Dữ liệu các trường template không hợp lệ.", 400);
    }
    let prepared;
    try {
      prepared = await prepareStandaloneListingTemplate(blankWorkbook, template.name, {
        brandName,
        fieldValues: parsedFieldValues.data,
      });
    } catch (saveError) {
      let errorMsg = saveError instanceof Error ? saveError.message : "Lỗi lưu template.";
      let extraRequiredFields: import("@/lib/types").ListingTemplateRequiredField[] = [];
      if (errorMsg.includes("__REQUIRED_FIELDS_JSON__")) {
        const parts = errorMsg.split("__REQUIRED_FIELDS_JSON__");
        errorMsg = parts[0];
        try {
          extraRequiredFields = JSON.parse(parts[1]) as import("@/lib/types").ListingTemplateRequiredField[];
        } catch {
          // ignore
        }
      }
      const rescan = extraRequiredFields.length > 0
        ? { required_fields: extraRequiredFields }
        : await scanStandaloneTemplateFields(blankWorkbook, template.name, parsedFieldValues.data, {
          includeSetupFields: true,
          showExistingSetupFields: false,
        });
      return Response.json(
        {
          error: errorMsg,
          required_fields: rescan.required_fields || [],
        },
        { status: 400 },
      );
    }
    const workbook = prepared.workbook;
    const { product_type: preparedProductType, ...preparedMetadata } = prepared.metadata;
    const productType = preparedProductType || scan.product_type;
    const metadata: ListingTemplateMetadata = {
      ...preparedMetadata,
      is_blank: false,
      is_ready: true,
      listing_mode: "standalone",
    };

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
      is_blank: false,
      is_ready: true,
      warning: null,
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
