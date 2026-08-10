import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { AmazonTemplateItem, ExcelImportResult } from "@/lib/excel-batch";
import type { ListingTemplateMetadata } from "@/lib/types";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "excel-automation.py");
const supportedExtensions = new Set([".xlsx", ".xlsm"]);

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
