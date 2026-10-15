import { NextRequest, NextResponse } from "next/server";
import { authorize, dataScope } from "@/lib/api-guard";
import { getActiveListingBatches } from "@/lib/trello-listing-batches";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await authorize(request, "read");
    const scope = dataScope(actor);
    const { activeBatches, activeItems } = await getActiveListingBatches(scope.teamId, actor.userId);

    return NextResponse.json({
      success: true,
      activeBatches,
      activeItems,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Không thể tải trạng thái Batch" },
      { status: 500 }
    );
  }
}
