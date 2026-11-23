// Auto giảm bid có xác nhận qua Lark (lib/ppc/auto-decrease.ts):
//   GET  ?storeName=  → cấu hình + bộ đếm + các lô gần đây của CHÍNH người đang đăng nhập
//   PUT  { storeName, enabled, scope, skus, waitDays, minBid, cooldownDays } → lưu cấu hình của chính mình
//   POST { action: "confirm" | "snooze", batchId, recIds? } → duyệt / hoãn lô của chính mình từ web
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import {
  confirmAutoDecreaseBatch,
  getAutoDecreaseSettings,
  getAutoDecreaseStreakSummary,
  listAutoDecreaseBatches,
  listAutoDecreaseRecipients,
  saveAutoDecreaseSettings,
  snoozeAutoDecreaseBatch,
  autoDecreaseHour,
  autoDecreaseChannels,
  listTelegramRecipients,
  listOtherAutoDecreaseConfigs,
} from "@/lib/ppc/auto-decrease";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";

export const runtime = "nodejs";

async function findStore(teamId: string, storeName: string) {
  const name = storeName.trim();
  if (!name || name === "ALL") throw new ApiError("Vui lòng chọn một Store cụ thể.", 400);
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; name: string }>>`
    SELECT id::text AS id, name FROM ppc_stores
    WHERE team_id = ${teamId} AND LOWER(name) = LOWER(${name})
    LIMIT 1
  `;
  if (!rows[0]) throw new ApiError(`Không tìm thấy store "${name}".`, 404);
  return rows[0];
}

async function canAct(teamId: string, actorId: string, storeId: string) {
  try {
    await assertActorPpcStoreActionAccess(teamId, actorId, storeId);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const store = await findStore(actor.teamId, new URL(request.url).searchParams.get("storeName") || "");
    // Mỗi người chỉ thấy / sửa cấu hình và lô của chính mình.
    const settings = await getAutoDecreaseSettings(store.id, actor.userId);
    const channels = autoDecreaseChannels();
    const [streaks, batches, larkRecipients, telegramRecipients, editable, others] = await Promise.all([
      getAutoDecreaseStreakSummary(store.id, actor.userId, settings.waitDays),
      listAutoDecreaseBatches(store.id, actor.userId),
      channels.lark ? listAutoDecreaseRecipients(actor.teamId, store.id, actor.userId) : Promise.resolve([]),
      channels.telegram ? listTelegramRecipients(actor.teamId, store.id, actor.userId) : Promise.resolve([]),
      canAct(actor.teamId, actor.userId, store.id),
      listOtherAutoDecreaseConfigs(store.id, actor.userId),
    ]);
    return Response.json({
      store,
      settings,
      streaks,
      batches,
      // Kênh mà CHÍNH người này sẽ nhận thông báo.
      myChannels: [...(larkRecipients.length ? ["Lark"] : []), ...(telegramRecipients.length ? ["Telegram"] : [])],
      // Người khác đang bật cấu hình cho store này (để báo trùng SKU).
      others: others.map((o) => ({ name: o.name, scope: o.scope, skus: o.skus })),
      channels,
      notifyHour: autoDecreaseHour(),
      canEdit: editable,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được cài đặt Auto giảm Bid.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    const body = (await readJsonBody(request, 100_000)) as Record<string, unknown>;
    const store = await findStore(actor.teamId, String(body.storeName || ""));
    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);
    if (body.scope === "SKUS" && body.enabled === true && Array.isArray(body.skus) && body.skus.length === 0) {
      throw new ApiError("Chọn ít nhất 1 SKU, hoặc chuyển phạm vi sang Tất cả SKU.", 400);
    }
    const settings = await saveAutoDecreaseSettings(dataScope(actor), store.id, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      scope: body.scope === "ALL" || body.scope === "SKUS" ? body.scope : undefined,
      skus: body.skus === undefined ? undefined : (body.skus as string[]),
      waitDays: body.waitDays === undefined ? undefined : Number(body.waitDays),
      minBid: body.minBid === undefined ? undefined : Number(body.minBid),
      cooldownDays: body.cooldownDays === undefined ? undefined : Number(body.cooldownDays),
    });
    return Response.json({ settings });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được cài đặt Auto giảm Bid.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    const body = (await readJsonBody(request, 200_000)) as Record<string, unknown>;
    const batchId = String(body.batchId || "");
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new ApiError("Thiếu mã lô.", 400);
    const who = { teamId: actor.teamId, actorId: actor.userId, displayName: actor.displayName };

    if (body.action === "snooze") {
      const outcome = await snoozeAutoDecreaseBatch(batchId, who, "web");
      if (!outcome.ok) throw new ApiError(outcome.message, outcome.status);
      return Response.json({ ok: true, snoozedUntil: outcome.snoozedUntil });
    }
    if (body.action === "confirm") {
      const recIds = Array.isArray(body.recIds) ? body.recIds.map(String) : undefined;
      if (recIds && recIds.length === 0) throw new ApiError("Chưa chọn target nào.", 400);
      const outcome = await confirmAutoDecreaseBatch(batchId, who, "web", recIds);
      if (!outcome.ok) throw new ApiError(outcome.message, outcome.status);
      return Response.json({ ok: true, result: "result" in outcome ? outcome.result : null });
    }
    throw new ApiError("Hành động không hợp lệ.", 400);
  } catch (error) {
    return routeErrorResponse(error, "Không xử lý được lô Auto giảm Bid.", 500);
  }
}
