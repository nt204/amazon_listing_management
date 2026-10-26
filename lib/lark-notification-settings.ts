import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";

export const LARK_NOTIFICATION_CATEGORIES = ["listing", "mockups", "ppc", "accounting"] as const;
export type LarkNotificationCategory = typeof LARK_NOTIFICATION_CATEGORIES[number];
export type LarkReceiveIdType = "email" | "open_id" | "user_id";

export interface LarkChannelConfig {
  id: string;
  name: string;
  chatId: string;
  enabled: boolean;
  categories: Record<LarkNotificationCategory, boolean>;
}

export interface LarkSettingsSnapshot {
  personal: { receiveId: string; receiveIdType: LarkReceiveIdType; enabled: boolean };
  personalRules: Record<LarkNotificationCategory, boolean>;
  channels: LarkChannelConfig[];
  teamRules?: Record<LarkNotificationCategory, { enabled: boolean; channelId: string }>;
}

const emptyRules = (): Record<LarkNotificationCategory, boolean> => ({
  listing: false,
  mockups: false,
  ppc: false,
  accounting: false,
});

export async function getLarkSettings(scope: DataScope): Promise<LarkSettingsSnapshot> {
  const sql = await getDatabaseClient();
  const [connections, preferences, channels, channelRules] = await Promise.all([
    sql<Array<{ receive_id: string; receive_id_type: LarkReceiveIdType; enabled: boolean }>>`
      SELECT receive_id, receive_id_type, enabled FROM lark_user_connections
      WHERE team_id = ${scope.teamId} AND actor_id = ${scope.actorId} LIMIT 1
    `,
    sql<Array<{ category: LarkNotificationCategory; personal_enabled: boolean }>>`
      SELECT category, personal_enabled FROM lark_notification_preferences
      WHERE team_id = ${scope.teamId} AND actor_id = ${scope.actorId}
    `,
    sql<Array<{ id: string; name: string; chat_id: string; enabled: boolean }>>`
      SELECT id, name, chat_id, enabled FROM lark_team_channels
      WHERE team_id = ${scope.teamId} ORDER BY created_at ASC
    `,
    sql<Array<{ channel_id: string; category: LarkNotificationCategory; enabled: boolean }>>`
      SELECT channel_id, category, enabled FROM lark_team_notification_rules
      WHERE team_id = ${scope.teamId}
    `,
  ]);

  const personalRules = emptyRules();
  for (const row of preferences) personalRules[row.category] = row.personal_enabled;

  const channelRulesMap = new Map<string, Record<LarkNotificationCategory, boolean>>();
  for (const row of channelRules) {
    if (!channelRulesMap.has(row.channel_id)) {
      channelRulesMap.set(row.channel_id, emptyRules());
    }
    channelRulesMap.get(row.channel_id)![row.category] = row.enabled;
  }

  const connection = connections[0];
  const channelConfigs: LarkChannelConfig[] = channels.map((row) => ({
    id: row.id,
    name: row.name,
    chatId: row.chat_id,
    enabled: row.enabled,
    categories: channelRulesMap.get(row.id) || emptyRules(),
  }));

  // Maintain backwards compatibility for any legacy callers of teamRules
  const legacyTeamRules: Record<LarkNotificationCategory, { enabled: boolean; channelId: string }> = {
    listing: { enabled: false, channelId: "" },
    mockups: { enabled: false, channelId: "" },
    ppc: { enabled: false, channelId: "" },
    accounting: { enabled: false, channelId: "" },
  };
  for (const ch of channelConfigs) {
    for (const cat of LARK_NOTIFICATION_CATEGORIES) {
      if (ch.categories[cat] && ch.enabled) {
        legacyTeamRules[cat] = { enabled: true, channelId: ch.id };
      }
    }
  }

  return {
    personal: {
      receiveId: connection?.receive_id || "",
      receiveIdType: connection?.receive_id_type || "email",
      enabled: connection?.enabled ?? false,
    },
    personalRules,
    channels: channelConfigs,
    teamRules: legacyTeamRules,
  };
}

export async function savePersonalLarkSettings(
  scope: DataScope,
  personal: LarkSettingsSnapshot["personal"],
  rules: Record<LarkNotificationCategory, boolean>,
) {
  const sql = await getDatabaseClient();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO lark_user_connections (team_id, actor_id, receive_id, receive_id_type, enabled, updated_at)
      VALUES (${scope.teamId}, ${scope.actorId}, ${personal.receiveId}, ${personal.receiveIdType}, ${personal.enabled}, NOW())
      ON CONFLICT (team_id, actor_id) DO UPDATE SET
        receive_id = EXCLUDED.receive_id, receive_id_type = EXCLUDED.receive_id_type,
        enabled = EXCLUDED.enabled, updated_at = NOW()
    `;
    for (const category of LARK_NOTIFICATION_CATEGORIES) {
      await transaction`
        INSERT INTO lark_notification_preferences (team_id, actor_id, category, personal_enabled, updated_at)
        VALUES (${scope.teamId}, ${scope.actorId}, ${category}, ${Boolean(rules[category])}, NOW())
        ON CONFLICT (team_id, actor_id, category) DO UPDATE SET
          personal_enabled = EXCLUDED.personal_enabled, updated_at = NOW()
      `;
    }
  });
}

export async function saveTeamLarkSettings(
  scope: DataScope,
  channels: LarkChannelConfig[],
) {
  const sql = await getDatabaseClient();
  await sql.begin(async (transaction) => {
    const retainedIds: string[] = [];
    for (const channel of channels) {
      const persisted = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(channel.id);
      const rows = persisted
        ? await transaction<Array<{ id: string }>>`
            UPDATE lark_team_channels SET name = ${channel.name}, chat_id = ${channel.chatId},
              enabled = ${channel.enabled}, updated_at = NOW()
            WHERE id = ${channel.id} AND team_id = ${scope.teamId} RETURNING id
          `
        : await transaction<Array<{ id: string }>>`
            INSERT INTO lark_team_channels (team_id, name, chat_id, enabled, created_by)
            VALUES (${scope.teamId}, ${channel.name}, ${channel.chatId}, ${channel.enabled}, ${scope.actorId})
            RETURNING id
          `;
      const savedId = rows[0]?.id;
      if (savedId) {
        retainedIds.push(savedId);
        for (const category of LARK_NOTIFICATION_CATEGORIES) {
          const isEnabled = Boolean(channel.categories?.[category]);
          await transaction`
            INSERT INTO lark_team_notification_rules (team_id, channel_id, category, enabled, updated_at)
            VALUES (${scope.teamId}, ${savedId}, ${category}, ${isEnabled}, NOW())
            ON CONFLICT (team_id, channel_id, category) DO UPDATE SET
              enabled = EXCLUDED.enabled, updated_at = NOW()
          `;
        }
      }
    }
    if (retainedIds.length) {
      await transaction`DELETE FROM lark_team_channels WHERE team_id = ${scope.teamId} AND id NOT IN ${transaction(retainedIds)}`;
    } else {
      await transaction`DELETE FROM lark_team_channels WHERE team_id = ${scope.teamId}`;
    }
  });
}

export async function resolveLarkRecipients(
  scope: DataScope,
  category: LarkNotificationCategory,
  options: { ppcStoreId?: string } = {},
) {
  const sql = await getDatabaseClient();
  const actors = await sql<Array<{ actor_id: string }>>`
    SELECT user_id AS actor_id FROM app_users
    WHERE team_id = ${scope.teamId} AND (
      user_id = ${scope.actorId}
      OR LOWER(username) = LOWER(${scope.actorId})
      OR (
        LOWER(display_name) = LOWER(${scope.actorId})
        AND 1 = (
          SELECT COUNT(*) FROM app_users matching_user
          WHERE matching_user.team_id = ${scope.teamId}
            AND LOWER(matching_user.display_name) = LOWER(${scope.actorId})
        )
      )
    )
    ORDER BY CASE
      WHEN user_id = ${scope.actorId} THEN 0
      WHEN LOWER(username) = LOWER(${scope.actorId}) THEN 1
      ELSE 2
    END
    LIMIT 1
  `;
  const actorId = actors[0]?.actor_id || scope.actorId;
  // Only explicit background actors may fan out to admins. An unknown actor can
  // be legacy data (for example a display name) and must never become a team-wide
  // personal notification by accident.
  const isSystemActor = scope.actorId === "system" || scope.actorId === "worker";

  const ppcStoreId = options.ppcStoreId?.trim() || null;

  if (category === "ppc") {
    // Thông báo Action PPC: Chỉ thông báo cho CHÍNH người thực hiện action (nếu có thiết lập Lark + nhận PPC)
    // VÀ người đó phải được phân quyền phụ trách store đó (hoặc là admin).
    // Tuyệt đối không gửi cho người khác, không gửi vào nhóm chat.
    const rows = await sql<Array<{ receive_id: string; receive_id_type: string }>>`
      SELECT connection.receive_id, connection.receive_id_type
      FROM lark_user_connections connection
      JOIN app_users app_user
        ON app_user.team_id = connection.team_id AND app_user.user_id = connection.actor_id
      LEFT JOIN lark_notification_preferences preference
        ON preference.team_id = connection.team_id AND preference.actor_id = connection.actor_id
        AND preference.category = 'ppc'
      WHERE connection.team_id = ${scope.teamId}
        AND connection.actor_id = ${actorId}
        AND connection.enabled = TRUE
        AND COALESCE(preference.personal_enabled, FALSE) = TRUE
        AND (
          ${ppcStoreId}::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM ppc_store_user_access access
            WHERE access.team_id = ${scope.teamId}
              AND access.store_id = ${ppcStoreId}::uuid
              AND access.actor_id = ${actorId}
              AND access.receive_action_notifications = TRUE
          )
        )
    `;
    return rows;
  }

  const rows = await sql<Array<{ receive_id: string; receive_id_type: string }>>`
    SELECT connection.receive_id, connection.receive_id_type
    FROM lark_user_connections connection
    LEFT JOIN lark_notification_preferences preference
      ON preference.team_id = connection.team_id AND preference.actor_id = connection.actor_id
      AND preference.category = ${category}
    WHERE connection.team_id = ${scope.teamId}
      AND (
        connection.actor_id = ${actorId}
        OR ${isSystemActor}
      )
      AND connection.enabled = TRUE AND COALESCE(preference.personal_enabled, FALSE) = TRUE
    UNION
    SELECT channel.chat_id AS receive_id, 'chat_id' AS receive_id_type
    FROM lark_team_notification_rules rule
    JOIN lark_team_channels channel ON channel.id = rule.channel_id AND channel.team_id = rule.team_id
    WHERE rule.team_id = ${scope.teamId} AND rule.category = ${category}
      AND rule.enabled = TRUE AND channel.enabled = TRUE
  `;
  return rows;
}
