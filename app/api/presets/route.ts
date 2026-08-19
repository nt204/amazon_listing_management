import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { SYSTEM_PRESETS } from "@/lib/mockup-preset-store";
import type { ProductCategoryPreset } from "@/types/mockup-preset";

const PRESETS_FILE_PATH = path.join(process.cwd(), "data", "custom-presets.json");

async function readCustomPresetsFromFile(): Promise<ProductCategoryPreset[]> {
  try {
    const content = await fs.readFile(PRESETS_FILE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ProductCategoryPreset =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        Array.isArray(item.contents),
    );
  } catch {
    return [];
  }
}

async function writeCustomPresetsToFile(presets: ProductCategoryPreset[]): Promise<void> {
  try {
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });
    const customOnly = presets.filter((p) => !p.isSystem);
    await fs.writeFile(PRESETS_FILE_PATH, JSON.stringify(customOnly, null, 2), "utf-8");
  } catch (err) {
    console.error("Lỗi khi ghi file custom-presets.json:", err);
  }
}

export async function GET() {
  try {
    const customPresets = await readCustomPresetsFromFile();
    const customMap = new Map(customPresets.map((p) => [p.id, p]));

    const mergedSystem = SYSTEM_PRESETS.map((sys) => {
      const override = customMap.get(sys.id);
      if (override) {
        customMap.delete(sys.id);
        return {
          ...sys,
          ...override,
          isSystem: true,
        };
      }
      return sys;
    });

    const allPresets = [...mergedSystem, ...Array.from(customMap.values())];
    return NextResponse.json({ presets: allPresets });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const presets: ProductCategoryPreset[] = Array.isArray(body?.presets) ? body.presets : [];

    await writeCustomPresetsToFile(presets);

    // Re-read to return merged updated state
    const customPresets = await readCustomPresetsFromFile();
    const customMap = new Map(customPresets.map((p) => [p.id, p]));

    const mergedSystem = SYSTEM_PRESETS.map((sys) => {
      const override = customMap.get(sys.id);
      if (override) {
        customMap.delete(sys.id);
        return {
          ...sys,
          ...override,
          isSystem: true,
        };
      }
      return sys;
    });

    const allPresets = [...mergedSystem, ...Array.from(customMap.values())];
    return NextResponse.json({ success: true, presets: allPresets });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
