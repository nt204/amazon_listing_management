import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAppSetting, setAppSetting } from "@/lib/db";
import { competitorConfig } from "@/lib/competitor-discovery/config/competitor.config";
import type { CandidateScoreWeights } from "@/lib/competitor-discovery/domain/competitor.types";

export const runtime = "nodejs";

function settingKey(teamId: string, userId: string) {
  return `competitor_scoring:${teamId}:${userId}`;
}

function parseWeights(value: unknown): CandidateScoreWeights {
  const input = value as Partial<CandidateScoreWeights> | null;
  const weights = {
    relevance: Number(input?.relevance),
    revenue: Number(input?.revenue),
    sales: Number(input?.sales),
    bsr: Number(input?.bsr),
  };
  const values = Object.values(weights);
  const total = values.reduce((sum, item) => sum + item, 0);
  if (values.some((item) => !Number.isFinite(item) || item < 0 || item > 1) || Math.abs(total - 1) > 0.001) {
    throw new Error("Tổng trọng số đánh giá phải bằng 100%.");
  }
  return weights;
}

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const saved = await getAppSetting<CandidateScoreWeights>(settingKey(actor.teamId, actor.userId));
    return Response.json({ weights: saved || competitorConfig.weights });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải trọng số đánh giá.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    const body = await request.json();
    const weights = parseWeights(body?.weights);
    await setAppSetting(
      settingKey(actor.teamId, actor.userId),
      weights as unknown as Record<string, unknown>,
    );
    return Response.json({ success: true, weights });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu trọng số đánh giá.", 400);
  }
}
