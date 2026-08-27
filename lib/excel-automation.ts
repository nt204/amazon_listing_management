import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { AmazonTemplateItem, ExcelImportResult } from "@/lib/excel-batch";
import type { ListingTemplateMetadata, ListingTemplateRequiredField } from "@/lib/types";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "excel-automation.py");
const supportedExtensions = new Set([".xlsx", ".xlsm"]);

export interface TemplateMappingReport {
  source_columns: number;
  destination_columns: number;
  mapped_columns: number;
  source_values: number;
  mapped_values: number;
  unmapped_columns: string[];
}

export interface ListingTemplateScan {
  sheet_name: string;
  attribute_row: number;
  label_row: number;
  data_row: number | null;
  column_count: number;
  contributor_id: string;
  shop_key: string;
  marketplace_id: string;
  template_identifier: string;
  store_name?: string;
  product_type: string;
  phoi_name: string;
}

export interface StandaloneTemplateFieldScan extends ListingTemplateScan {
  required_fields: ListingTemplateRequiredField[];
  managed_fields_count: number;
}

async function runPython(args: string[]) {
  try {
    const { stdout } = await execFileAsync(process.env.PYTHON_BIN || "python3", [scriptPath, ...args], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
      timeout: 120_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    return stdout;
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error
      ? String(error.stderr || "")
      : "";
    const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const typedError = [...lines].reverse().find((line) => /^(?:ValueError|RuntimeError):\s/.test(line));
    const concise = typedError?.replace(/^[^:]+:\s*/, "") || lines.find(
      (line) => !line.includes("Warning") && !line.startsWith("Traceback") && !line.startsWith("File "),
    );
    throw new Error(concise || "Không thể xử lý file Excel.");
  }
}

async function withTempDirectory<T>(callback: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "amazon-listing-excel-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function parseSkuWorkbook(buffer: Buffer, filename: string): Promise<ExcelImportResult> {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Chỉ hỗ trợ file .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `input${extension}`);
    await writeFile(sourcePath, buffer);
    const output = await runPython(["parse", sourcePath]);
    return JSON.parse(output) as ExcelImportResult;
  });
}

export async function inspectListingTemplate(
  buffer: Buffer,
  filename: string,
): Promise<ListingTemplateMetadata & { product_type: string }> {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Chỉ hỗ trợ template .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `template${extension}`);
    await writeFile(sourcePath, buffer);
    const output = await runPython(["inspect", sourcePath]);
    return JSON.parse(output) as ListingTemplateMetadata & { product_type: string };
  });
}

export async function scanListingTemplate(
  buffer: Buffer,
  filename: string,
): Promise<ListingTemplateScan> {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Chỉ hỗ trợ template .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `scan${extension}`);
    await writeFile(sourcePath, buffer);
    const output = await runPython(["scan_template", sourcePath]);
    return JSON.parse(output) as ListingTemplateScan;
  });
}

export async function scanStandaloneTemplateFields(
  buffer: Buffer,
  filename: string,
  fieldValues?: Record<string, string>,
  options: { includeSetupFields?: boolean; showExistingSetupFields?: boolean } = {},
): Promise<StandaloneTemplateFieldScan> {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Chỉ hỗ trợ template .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `scan-fields${extension}`);
    await writeFile(sourcePath, buffer);
    const args = ["scan_required_fields", sourcePath];
    if (
      (fieldValues && Object.keys(fieldValues).length > 0)
      || options.includeSetupFields
      || options.showExistingSetupFields
    ) {
      const payloadPath = join(directory, "field-values.json");
      await writeFile(payloadPath, JSON.stringify({
        field_values: fieldValues || {},
        include_setup_fields: options.includeSetupFields === true,
        show_existing_setup_fields: options.showExistingSetupFields === true,
      }), "utf8");
      args.push(payloadPath);
    }
    const output = await runPython(args);
    return JSON.parse(output) as StandaloneTemplateFieldScan;
  });
}

export async function prepareStandaloneListingTemplate(
  buffer: Buffer,
  filename: string,
  input: { brandName: string; fieldValues: Record<string, string> },
): Promise<{ workbook: Buffer; metadata: ListingTemplateMetadata & { product_type: string } }> {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Chỉ hỗ trợ template .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `standalone-source${extension}`);
    const payloadPath = join(directory, "standalone-fields.json");
    const outputPath = join(directory, `standalone-template${extension}`);
    await Promise.all([
      writeFile(sourcePath, buffer),
      writeFile(payloadPath, JSON.stringify({
        brand_name: input.brandName,
        field_values: input.fieldValues,
        include_setup_fields: true,
        show_existing_setup_fields: false,
      }), "utf8"),
    ]);
    const output = await runPython(["prepare_standalone", sourcePath, payloadPath, outputPath]);
    return {
      workbook: await readFile(outputPath),
      metadata: JSON.parse(output) as ListingTemplateMetadata & { product_type: string },
    };
  });
}

export async function mapListingTemplateToBlank(
  sourceTemplate: Buffer,
  sourceFilename: string,
  destinationBlank: Buffer,
  destinationFilename: string,
  options: { brandName?: string } = {},
): Promise<{ workbook: Buffer; report: TemplateMappingReport }> {
  const sourceExtension = extname(sourceFilename).toLowerCase();
  const destinationExtension = extname(destinationFilename).toLowerCase();
  if (!supportedExtensions.has(sourceExtension) || !supportedExtensions.has(destinationExtension)) {
    throw new Error("Chỉ hỗ trợ template .xlsx hoặc .xlsm.");
  }
  return withTempDirectory(async (directory) => {
    const sourcePath = join(directory, `source${sourceExtension}`);
    const destinationPath = join(directory, `destination${destinationExtension}`);
    const outputPath = join(directory, `mapped${destinationExtension}`);
    await Promise.all([
      writeFile(sourcePath, sourceTemplate),
      writeFile(destinationPath, destinationBlank),
    ]);
    const args = ["map_template", sourcePath, destinationPath, outputPath];
    if (options.brandName?.trim()) {
      args.push("--brand", options.brandName.trim());
    }
    const output = await runPython(args);
    return {
      workbook: await readFile(outputPath),
      report: JSON.parse(output) as TemplateMappingReport,
    };
  });
}

export async function createSkuInputSample() {
  return withTempDirectory(async (directory) => {
    const outputPath = join(directory, "sku-input-template.xlsx");
    await runPython(["sample", outputPath]);
    return readFile(outputPath);
  });
}

export async function createAmazonTemplate(
  template: Buffer,
  filename: string,
  items: AmazonTemplateItem[],
) {
  const extension = extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) throw new Error("Template đã lưu có định dạng không hợp lệ.");
  return withTempDirectory(async (directory) => {
    const sourceTemplate = join(directory, `source-template${extension}`);
    const payloadPath = join(directory, "payload.json");
    const outputPath = join(directory, `amazon-listing${extension}`);
    await writeFile(sourceTemplate, template);
    await writeFile(payloadPath, JSON.stringify({ items }), "utf8");
    await runPython(["fill", sourceTemplate, payloadPath, outputPath]);
    return { workbook: await readFile(outputPath), extension };
  });
}

export async function createStandardListingExcel(items: AmazonTemplateItem[]) {
  return withTempDirectory(async (directory) => {
    const payloadPath = join(directory, "payload.json");
    const outputPath = join(directory, "amazon-listing.xlsx");
    await writeFile(payloadPath, JSON.stringify({ items }), "utf8");
    await runPython(["build_excel", payloadPath, outputPath]);
    return { workbook: await readFile(outputPath), extension: ".xlsx" };
  });
}

export async function optimizeImageForAi(
  imageBuffer: Buffer,
  maxDim = 1600,
  quality = 82,
): Promise<{ dataUrl: string; mimeType: string; bytes: number }> {
  return withTempDirectory(async (directory) => {
    const inputPath = join(directory, "raw_image");
    const outputPath = join(directory, "optimized.jpg");
    await writeFile(inputPath, imageBuffer);
    await runPython([
      "resize_image",
      inputPath,
      outputPath,
      "--max-dim",
      String(maxDim),
      "--quality",
      String(quality),
    ]);
    const optimizedBuffer = await readFile(outputPath);
    const mimeType = "image/jpeg";
    return {
      dataUrl: `data:${mimeType};base64,${optimizedBuffer.toString("base64")}`,
      mimeType,
      bytes: optimizedBuffer.length,
    };
  });
}
