import { ApiError, authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { enqueuePpcIngestion, getPpcIngestion } from "@/lib/ppc/ingestion-jobs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor=authorize(request,"read");
    const id=new URL(request.url).searchParams.get("jobId")?.trim();
    if(!id) throw new ApiError("Thiếu ingestion jobId.",400);
    const job=await getPpcIngestion(dataScope(actor),id);
    if(!job) throw new ApiError("Không tìm thấy ingestion job.",404);
    return Response.json({success:job.status==="COMPLETED",job});
  } catch(error){return routeErrorResponse(error,"Lỗi khi đọc trạng thái đồng bộ R2.",500);}
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-r2-sync", 5, 60);
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const batchId=String(body.batchId||"").trim(), batchDate=String(body.batchDate||"").trim();
    const storeNames=Array.isArray(body.storeNames)?body.storeNames.map(String).map(v=>v.trim()).filter(Boolean):[];
    if(!/^[A-Za-z0-9_.-]{1,120}$/.test(batchId)) throw new ApiError("batchId không hợp lệ.",400);
    if(!/^\d{4}-?\d{2}-?\d{2}$/.test(batchDate)) throw new ApiError("batchDate không hợp lệ.",400);
    if(!storeNames.length||storeNames.length>50) throw new ApiError("storeNames không hợp lệ.",400);
    const job=await enqueuePpcIngestion(dataScope(actor),{batchId,batchDate,storeNames});
    return Response.json({success:job.status==="COMPLETED",accepted:job.status!=="COMPLETED",
      message:job.status==="COMPLETED"?"Batch đã đồng bộ trước đó.":"Batch đã được đưa vào hàng đợi đồng bộ.",job},
      {status:job.status==="COMPLETED"?200:202});
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi quét Cloudflare R2.", 500);
  }
}
