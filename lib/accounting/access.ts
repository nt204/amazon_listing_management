import "server-only";

import { ApiError } from "@/lib/api-guard";
import type { RequestActor } from "@/lib/auth";
import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listStores } from "@/lib/accounting/accounting-db";
import { parseStoreTeams } from "@/lib/accounting/store-teams";
import type { Store } from "@/lib/accounting/types";

export type AccountingChannel = "FBA" | "FBM";
export type AccountingAccessMode = "read" | "write";

/** Quyền của người dùng trên 1 store: kênh xem được, kênh sửa được. */
export interface StoreAccess {
  channels: AccountingChannel[];
  editChannels: AccountingChannel[];
}

export interface AccountingAccess {
  /** Admin / Kế toán: toàn quyền mọi store. */
  full: boolean;
  /** Admin / Kế toán: được phân quyền kế toán cho người khác. */
  canManage: boolean;
  stores: Map<string, StoreAccess>;
}

export interface AccountingAccessGrant {
  actorId: string;
  storeTeam: string;
  canEdit: boolean;
}

const isFbmTeam = (team: string) => /^fbm$/i.test(team.trim());
const isFbaTeam = (team: string) => /^fba\b/i.test(team.trim());

export function hasFullAccountingAccess(actor: RequestActor) {
  return actor.role === "admin" || actor.role === "accountant";
}

/**
 * Quyền kế toán theo Team được phân (bảng accounting_user_access):
 *   team FBA x → kênh FBA của các store có team đó;
 *   team FBM   → kênh FBM của mọi store có team FBM.
 * Chưa được phân team nào → không thấy store nào.
 */
export async function getAccountingAccess(actor: RequestActor, stores?: Store[]): Promise<AccountingAccess> {
  if (hasFullAccountingAccess(actor)) return { full: true, canManage: true, stores: new Map() };
  const sql = await getDatabaseClient();
  const [grants, allStores] = await Promise.all([
    sql<{ store_team: string; can_edit: boolean }[]>`
      SELECT store_team, can_edit FROM accounting_user_access
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId}
    `,
    stores ? Promise.resolve(stores) : listStores(),
  ]);
  const map = new Map<string, StoreAccess>();
  for (const store of allStores) {
    const storeTeams = parseStoreTeams(store.team).map((t) => t.toUpperCase());
    const access: StoreAccess = { channels: [], editChannels: [] };
    for (const grant of grants) {
      const key = grant.store_team.trim().toUpperCase();
      if (!storeTeams.includes(key)) continue;
      const channel: AccountingChannel | null = isFbmTeam(key) ? "FBM" : isFbaTeam(key) ? "FBA" : null;
      if (!channel) continue;
      if (!access.channels.includes(channel)) access.channels.push(channel);
      if (grant.can_edit && !access.editChannels.includes(channel)) access.editChannels.push(channel);
    }
    if (access.channels.length) map.set(store.id, access);
  }
  return { full: false, canManage: false, stores: map };
}

export function canAccessStore(
  access: AccountingAccess,
  storeId: string,
  channel?: AccountingChannel,
  mode: AccountingAccessMode = "read",
) {
  if (access.full) return true;
  const store = access.stores.get(storeId);
  if (!store) return false;
  const list = mode === "write" ? store.editChannels : store.channels;
  return channel ? list.includes(channel) : list.length > 0;
}

/** Ném 403 nếu không có quyền trên store (và kênh, nếu chỉ định). */
export function assertStoreAccess(
  access: AccountingAccess,
  storeId: string,
  channel?: AccountingChannel,
  mode: AccountingAccessMode = "read",
) {
  if (canAccessStore(access, storeId, channel, mode)) return;
  throw new ApiError(
    mode === "write"
      ? `Bạn chỉ có quyền xem${channel ? ` ${channel}` : ""} của store này, không được sửa.`
      : `Bạn không được phân quyền xem${channel ? ` ${channel}` : ""} của store này.`,
    403,
  );
}

/** Kênh được xem của 1 store (full → cả 2). */
export function storeChannelsFor(access: AccountingAccess, storeId: string): AccountingChannel[] {
  if (access.full) return ["FBA", "FBM"];
  return access.stores.get(storeId)?.channels ?? [];
}

export function filterAccessibleStores<T extends { id: string }>(access: AccountingAccess, stores: T[]): T[] {
  return access.full ? stores : stores.filter((s) => access.stores.has(s.id));
}

/** Gắn quyền vào danh sách store để giao diện ẩn tab / nút sửa. */
export function withStoreAccess<T extends { id: string }>(access: AccountingAccess, stores: T[]) {
  return filterAccessibleStores(access, stores).map((s) => ({
    ...s,
    access: access.full
      ? { channels: ["FBA", "FBM"] as AccountingChannel[], editChannels: ["FBA", "FBM"] as AccountingChannel[] }
      : access.stores.get(s.id)!,
  }));
}

export function assertCanManageAccounting(actor: RequestActor) {
  if (!hasFullAccountingAccess(actor)) throw new ApiError("Chỉ Admin hoặc Kế toán được phân quyền kế toán.", 403);
}

// ----------------- QUẢN LÝ PHÂN QUYỀN -----------------

export async function getAccountingAccessSnapshot(teamId: string) {
  const sql = await getDatabaseClient();
  const [users, rows, stores] = await Promise.all([
    sql<{ userId: string; username: string; displayName: string; role: string }[]>`
      SELECT user_id AS "userId", username, display_name AS "displayName", role
      FROM app_users
      WHERE team_id = ${teamId} AND status = 'approved'
        AND (allowed_features IS NULL OR 'accounting' = ANY(allowed_features))
      ORDER BY display_name ASC, username ASC
    `,
    sql<{ actor_id: string; store_team: string; can_edit: boolean }[]>`
      SELECT actor_id, store_team, can_edit FROM accounting_user_access WHERE team_id = ${teamId}
    `,
    listStores(),
  ]);
  return {
    users,
    stores: stores.map((s) => ({ id: s.id, name: s.name, team: s.team, status: s.status })),
    grants: rows.map((r) => ({ actorId: r.actor_id, storeTeam: r.store_team, canEdit: r.can_edit })),
  };
}

export async function replaceAccountingAccess(scope: DataScope, grants: AccountingAccessGrant[]) {
  const sql = await getDatabaseClient();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM accounting_user_access WHERE team_id = ${scope.teamId}`;
    for (const grant of grants) {
      const storeTeam = grant.storeTeam.trim();
      if (!storeTeam) continue;
      await tx`
        INSERT INTO accounting_user_access (team_id, actor_id, store_team, can_edit, created_by, updated_at)
        SELECT ${scope.teamId}, u.user_id, ${storeTeam}, ${grant.canEdit}, ${scope.actorId}, NOW()
        FROM app_users u
        WHERE u.team_id = ${scope.teamId} AND u.user_id = ${grant.actorId} AND u.status = 'approved'
        ON CONFLICT (team_id, actor_id, store_team) DO UPDATE SET can_edit = EXCLUDED.can_edit, updated_at = NOW()
      `;
    }
  });
}

/** Kiểm tra quyền của actor trên 1 store / kênh (dùng trong route có store_id). */
export async function requireStoreAccess(
  actor: RequestActor,
  storeId: string,
  channel?: AccountingChannel,
  mode: AccountingAccessMode = "read",
) {
  if (hasFullAccountingAccess(actor)) return;
  assertStoreAccess(await getAccountingAccess(actor), storeId, channel, mode);
}

/** Kênh theo tham số channel=fbm của các route Financials / Inventory (mặc định FBA). */
export const channelParam = (value: string | null | undefined): AccountingChannel =>
  value === "fbm" ? "FBM" : "FBA";

/** Kênh của link Google Sheet: File INVENTORY → FBA; Bảng mã FBM / Kế toán tổng hợp FBM → FBM. */
export const sheetLinkChannel = (linkType: string): AccountingChannel => (linkType === "inventory" ? "FBA" : "FBM");
