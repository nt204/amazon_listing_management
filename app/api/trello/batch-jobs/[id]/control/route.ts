import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-guard";
import {
  cancelListingBatch,
  pauseListingBatch,
  resumeListingBatch,
  retryAllFailedBatchItems,
  retryBatchItem,
} from "@/lib/trello-listing-batches";
import { publicRequestOrigin } from "@/lib/amazon-listing-image-publisher";

export const runtime = "nodejs";

const controlSchema = z.object({
  action: z.enum(["pause", "resume", "cancel", "retry-item", "retry-all-failed"]),
  itemId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await authorize(request, "write");
    const { id: batchId } = await params;
    const body = await request.json();
    const { action, itemId } = controlSchema.parse(body);

    const origin = publicRequestOrigin(request);

    if (action === "pause") {
      await pauseListingBatch(batchId);
      return NextResponse.json({ success: true, message: "Đã tạm dừng batch." });
    }

    if (action === "resume") {
      await resumeListingBatch(batchId, origin);
      return NextResponse.json({ success: true, message: "Đã tiếp tục batch." });
    }

    if (action === "cancel") {
      await cancelListingBatch(batchId);
      return NextResponse.json({ success: true, message: "Đã hủy batch." });
    }

    if (action === "retry-item" && itemId) {
      await retryBatchItem(itemId, origin);
      return NextResponse.json({ success: true, message: "Đã đưa thẻ vào hàng đợi thử lại." });
    }

    if (action === "retry-all-failed") {
      await retryAllFailedBatchItems(batchId, origin);
      return NextResponse.json({ success: true, message: "Đã đưa tất cả thẻ lỗi vào hàng đợi thử lại." });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Batch control error:", error);
    return NextResponse.json(
      { error: error.message || "Không thể thực hiện thao tác batch" },
      { status: 500 }
    );
  }
}
