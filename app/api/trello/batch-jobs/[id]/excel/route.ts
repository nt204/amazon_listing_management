import { NextRequest, NextResponse } from "next/server";
import { getListingBatchDetail, generateAndSaveBatchExcel } from "@/lib/trello-listing-batches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Thiếu mã batch." }, { status: 400 });
    }

    const { batch } = await getListingBatchDetail(batchId);
    if (!batch) {
      return NextResponse.json({ error: "Không tìm thấy batch listing." }, { status: 404 });
    }

    // Nếu đã có URL R2 public trực tiếp, chuyển hướng 302 ngay lập tức
    if (batch.excel_combined_url && batch.excel_combined_url.startsWith("https://") && !batch.excel_combined_url.includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(batch.excel_combined_url, 302);
    }

    const result = await generateAndSaveBatchExcel(batchId, request.signal);
    if (result.publicUrl && result.publicUrl.startsWith("https://") && !result.publicUrl.includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(result.publicUrl, 302);
    }

    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    console.error("Lỗi khi tải file Excel tổng hợp batch:", error);
    return NextResponse.json(
      { error: error?.message || "Không thể tạo file Excel tổng hợp." },
      { status: 500 },
    );
  }
}
