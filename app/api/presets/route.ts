import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ApiError,
  authorize,
  dataScope,
  readJsonBody,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  deleteSharedMockupPreset,
  listSharedMockupPresets,
  saveSharedMockupPreset,
  importLegacySharedMockupPresetsOnce,
  type DataScope,
} from "@/lib/db";
import { RETIRED_SYSTEM_PRESET_IDS, SYSTEM_PRESETS } from "@/lib/mockup-preset-store";
import type { ProductCategoryPreset } from "@/types/mockup-preset";

export const runtime = "nodejs";

const LEGACY_PRESETS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "custom-presets.json",
);
const SYSTEM_PRESET_IDS = new Set(SYSTEM_PRESETS.map((preset) => preset.id));

const contentSchema = z.object({
  id: z.number().int().min(1).max(10_000),
  label: z.string().trim().min(1).max(500),
  checked: z.boolean(),
  promptKey: z.string().trim().max(200).optional(),
  customPrompt: z.string().trim().max(30_000).optional(),
});

const presetSchema = z
  .object({
    id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
    label: z.string().trim().min(1).max(160),
    icon: z.string().trim().max(32).default("📦"),
    isSystem: z.boolean().optional(),
    contents: z.array(contentSchema).min(1).max(100),
  })
  .superRefine((preset, context) => {
    const ids = preset.contents.map((content) => content.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["contents"],
        message: "Các Content trong một phôi không được trùng ID.",
      });
    }
    const source = preset.contents.find((content) => content.id === 1);
    if (!source?.checked) {
      context.addIssue({
        code: "custom",
        path: ["contents"],
        message: "Content 1 là ảnh gốc bắt buộc.",
      });
    }
    const selectedAiCount = preset.contents.filter(
      (content) => content.id >= 2 && content.checked,
    ).length;
    if (selectedAiCount > 6) {
      context.addIssue({
        code: "custom",
        path: ["contents"],
        message: "Mỗi phôi chỉ được chọn sẵn tối đa 6 Content AI.",
      });
    }
  });

const saveBodySchema = z
  .object({
    preset: presetSchema.optional(),
    presets: z.array(presetSchema).max(100).optional(),
  })
  .refine((body) => Boolean(body.preset) !== Boolean(body.presets), {
    message: "Chỉ gửi một preset hoặc một danh sách presets.",
  });

function normalizedPreset(
  preset: z.infer<typeof presetSchema>,
): ProductCategoryPreset {
  return {
    ...preset,
    icon: preset.icon || "📦",
    isSystem: SYSTEM_PRESET_IDS.has(preset.id),
  };
}

function mergeWithSystemPresets(
  storedPresets: readonly ProductCategoryPreset[],
): ProductCategoryPreset[] {
  const storedById = new Map(
    storedPresets
      .filter((preset) => !RETIRED_SYSTEM_PRESET_IDS.has(preset.id))
      .map((preset) => [preset.id, preset]),
  );
  const systemPresets = SYSTEM_PRESETS.map((systemPreset) => {
    const override = storedById.get(systemPreset.id);
    storedById.delete(systemPreset.id);
    return override
      ? { ...systemPreset, ...override, isSystem: true }
      : { ...systemPreset, revision: 0 };
  });
  return [...systemPresets, ...storedById.values()];
}

async function readLegacyPresets(): Promise<ProductCategoryPreset[]> {
  try {
    const content = await fs.readFile(LEGACY_PRESETS_FILE_PATH, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const result = z.array(presetSchema).safeParse(parsed);
    return result.success
      ? result.data
          .filter((preset) => !RETIRED_SYSTEM_PRESET_IDS.has(preset.id))
          .map(normalizedPreset)
      : [];
  } catch {
    return [];
  }
}

async function sharedPresetCatalog(scope: DataScope) {
  const legacyPresets =
    scope.teamId === "default" ? await readLegacyPresets() : [];
  await importLegacySharedMockupPresetsOnce(scope, legacyPresets);
  return mergeWithSystemPresets(await listSharedMockupPresets(scope));
}

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    return Response.json(
      { presets: await sharedPresetCatalog(scope) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải phôi mockup dùng chung.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const body = saveBodySchema.parse(await readJsonBody(request, 2_000_000));
    const presets = (body.presets || (body.preset ? [body.preset] : [])).map(
      normalizedPreset,
    );
    if (presets.length === 0) {
      throw new ApiError("Không có phôi mockup để lưu.", 400);
    }
    if (presets.some((preset) => RETIRED_SYSTEM_PRESET_IDS.has(preset.id))) {
      throw new ApiError("Preset mặc định này đã được gỡ khỏi hệ thống.", 400);
    }
    const saved = [];
    for (const preset of presets) {
      saved.push(await saveSharedMockupPreset(scope, preset));
    }
    return Response.json({
      success: true,
      preset: saved.length === 1 ? saved[0] : undefined,
      presets: await sharedPresetCatalog(scope),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu phôi mockup dùng chung.");
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
      throw new ApiError("ID phôi mockup không hợp lệ.", 400);
    }
    const deleted = await deleteSharedMockupPreset(scope, id);
    return Response.json({
      success: deleted,
      presets: await sharedPresetCatalog(scope),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa phôi mockup dùng chung.");
  }
}
