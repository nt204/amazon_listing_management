import { NextRequest, NextResponse } from "next/server";
import { listSkuMonthly } from "@/lib/accounting/sku-monthly-db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");

    if (!storeId) {
      return NextResponse.json({ error: "Thiếu storeId" }, { status: 400 });
    }

    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : 2026;
    const monthParam = searchParams.get("month");
    const month = monthParam === "all" ? "all" : monthParam ? parseInt(monthParam, 10) : 9;

    const search = searchParams.get("search") || undefined;
    const productType = searchParams.get("productType") || undefined;
    const status = searchParams.get("status") || undefined;
    const skuType = (searchParams.get("skuType") as any) || "all";
    const sortField = searchParams.get("sortField") || "revenue";
    const sortDirection = (searchParams.get("sortDirection") as "asc" | "desc") || "desc";
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 100;

    const result = await listSkuMonthly(storeId, {
      year,
      month,
      search,
      productType,
      status,
      skuType,
      sortField,
      sortDirection,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[API SKU Monthly] Error:", err);
    return NextResponse.json(
      { error: err.message || "Lỗi nạp dữ liệu SKU Monthly" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { storeId, year, month, force = true } = body;

    if (!storeId || !year || !month) {
      return NextResponse.json({ error: "Thiếu storeId, year hoặc month" }, { status: 400 });
    }

    const period = `${year}-${String(month).padStart(2, "0")}`;
    const path = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const scriptPath = path.join(process.cwd(), "scripts", "ingest_monthly_from_raw.py");
    const args = [
      scriptPath,
      "--store",
      storeId,
      "--month",
      period,
    ];
    if (force) {
      args.push("--force");
    }

    // Thiết lập timeout 120 giây đề phòng script chạy lâu
    const { stdout, stderr } = await execFileAsync("python3", args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && stderr.includes("Traceback")) {
      console.error("[API SKU Monthly Recalculate Error stderr]:", stderr);
    }

    return NextResponse.json({
      success: true,
      message: `Đã tính toán và ghi nhận xong dữ liệu cho kỳ ${period}`,
      output: stdout,
    });
  } catch (err: any) {
    console.error("[API SKU Monthly Recalculate] Error:", err);
    return NextResponse.json(
      { error: err.message || "Lỗi khi tính toán dữ liệu thô" },
      { status: 500 }
    );
  }
}
