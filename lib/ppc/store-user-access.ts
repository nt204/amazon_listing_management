import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient, type DataScope } from "@/lib/db";

export interface PpcStoreAccessGrant {
  storeId: string;
  actorId: string;
  canAskLark: boolean;
  receiveActionNotifications: boolean;
}

export interface PpcStoreAccessStore {
  id: string;
  name: string;
}

export async function getPpcStoreAccessAdminSnapshot(teamId: string) {
  const sql = await getDatabaseClient();
  const [stores, users, rows] = await Promise.all([
    sql<Array<PpcStoreAccessStore>>`
      SELECT id, name FROM ppc_stores
      WHERE team_id = ${teamId}
      ORDER BY name ASC
    `,
    sql<Array<{ userId: string; username: string; displayName: string }>>`
      SELECT user_id AS "userId", username, display_name AS "displayName"
      FROM app_users
      WHERE team_id = ${teamId} AND status = 'approved'
      ORDER BY display_name ASC, username ASC
    `,
    sql<Array<{
      store_id: string;
      actor_id: string;
      can_ask_lark: boolean;
      receive_action_notifications: boolean;
    }>>`
      SELECT store_id, actor_id, can_ask_lark, receive_action_notifications
      FROM ppc_store_user_access
      WHERE team_id = ${teamId}
    `,
  ]);

  return {
    stores,
    users,
    grants: rows.map((row) => ({
      storeId: row.store_id,
      actorId: row.actor_id,
      canAskLark: row.can_ask_lark,
      receiveActionNotifications: row.receive_action_notifications,
    })),
  };
}

export async function replacePpcStoreAccess(
  scope: DataScope,
  grants: PpcStoreAccessGrant[],
) {
  const sql = await getDatabaseClient();
  await sql.begin(async (transaction) => {
    await transaction`DELETE FROM ppc_store_user_access WHERE team_id = ${scope.teamId}`;
    for (const grant of grants) {
      if (!grant.canAskLark && !grant.receiveActionNotifications) continue;
      await transaction`
        INSERT INTO ppc_store_user_access (
          team_id, store_id, actor_id, can_ask_lark,
          receive_action_notifications, created_by, updated_at
        )
        SELECT ${scope.teamId}, store.id, app_user.user_id, ${grant.canAskLark},
               ${grant.receiveActionNotifications}, ${scope.actorId}, NOW()
        FROM ppc_stores store
        JOIN app_users app_user
          ON app_user.team_id = store.team_id AND app_user.user_id = ${grant.actorId}
        WHERE store.team_id = ${scope.teamId} AND store.id = ${grant.storeId}
          AND app_user.status = 'approved'
      `;
    }
  });
}

export async function resolveLarkActorStoreAccess(larkSenderId: string) {
  const sql = await getDatabaseClient();
  const users = await sql<Array<{ team_id: string; actor_id: string }>>`
    SELECT connection.team_id, connection.actor_id
    FROM lark_user_connections connection
    JOIN app_users app_user
      ON app_user.team_id = connection.team_id AND app_user.user_id = connection.actor_id
    WHERE connection.enabled = TRUE
      AND connection.receive_id = ${larkSenderId}
      AND connection.receive_id_type IN ('open_id', 'user_id')
      AND app_user.status = 'approved'
    LIMIT 1
  `;
  const actorId = users[0]?.actor_id;
  const teamId = users[0]?.team_id;
  if (!actorId || !teamId) return { teamId: null, actorId: null, stores: [] as PpcStoreAccessStore[] };

  const stores = await sql<Array<PpcStoreAccessStore>>`
    SELECT store.id, store.name
    FROM ppc_store_user_access access
    JOIN ppc_stores store ON store.id = access.store_id AND store.team_id = access.team_id
    WHERE access.team_id = ${teamId} AND access.actor_id = ${actorId}
      AND access.can_ask_lark = TRUE
    ORDER BY store.name ASC
  `;
  return { teamId, actorId, stores };
}

export async function assertActorPpcStoreActionAccess(
  teamId: string,
  actorId: string,
  storeIdOrName: string,
): Promise<void> {
  const target = String(storeIdOrName || "").trim();
  if (!target || target === "ALL") {
    throw new ApiError(
      "Vui lòng chọn một Store cụ thể bạn được phân quyền để thực hiện hành động PPC.",
      400,
    );
  }
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ store_id: string }>>`
    SELECT access.store_id
    FROM ppc_store_user_access access
    JOIN ppc_stores store ON store.id = access.store_id AND store.team_id = access.team_id
    WHERE access.team_id = ${teamId}
      AND access.actor_id = ${actorId}
      AND (
        access.store_id::text = ${target}
        OR LOWER(store.name) = LOWER(${target})
      )
      AND access.receive_action_notifications = TRUE
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new ApiError(
      "Bạn không được phân quyền phụ trách store này để thực hiện hành động PPC (negative keyword, chỉnh bid, lên camp).",
      403,
    );
  }
}

export async function assertActorPpcStoresActionAccess(
  teamId: string,
  actorId: string,
  storeIdsOrNames: string[],
): Promise<void> {
  const distinctTargets = Array.from(
    new Set(storeIdsOrNames.map((s) => String(s || "").trim()).filter(Boolean)),
  );
  for (const target of distinctTargets) {
    await assertActorPpcStoreActionAccess(teamId, actorId, target);
  }
}
