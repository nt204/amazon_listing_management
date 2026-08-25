import "server-only";

import postgres from "postgres";
import { createHash } from "node:crypto";
import {
  createStoredImageDerivatives,
  IMAGE_DERIVATIVE_VERSION,
  type TrelloImageDerivative,
  type TrelloImagePreviewVariant,
} from "@/lib/image-processing";
import type {
  AmazonShopSummary,
  BrandProfile,
  ListingContent,
  ListingInput,
  ListingRevision,
  ListingResult,
  ListingStatus,
  ListingSummary,
  ListingTemplateMetadata,
  ListingTemplateSummary,
  StoredListing,
  WorkflowMetrics,
} from "@/lib/types";
import type {
  MockupContentItem,
  ProductCategoryPreset,
} from "@/types/mockup-preset";
import {
  deleteStoredObjects,
  getStoredObject,
  objectStorageDriver,
  putStoredObject,
  r2KeyPrefix,
} from "@/lib/object-storage";
import {
  listingImageObjectKey,
  listingTemplateObjectKey,
  retainDatabaseObjectBytes,
  trelloPreviewObjectKey,
} from "@/lib/object-storage-core";

type PostgresClient = ReturnType<typeof postgres>;
export interface DataScope { teamId: string; actorId: string }

const globalForDatabase = globalThis as unknown as {
  listingPostgres?: PostgresClient;
  listingPostgresSchema?: Promise<void>;
};

function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. Add it to the .env file.");
  }

  if (!globalForDatabase.listingPostgres) {
    globalForDatabase.listingPostgres = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return globalForDatabase.listingPostgres;
}

async function ensureSchema() {
  if (!globalForDatabase.listingPostgresSchema) {
    const sql = getDatabase();
    globalForDatabase.listingPostgresSchema = sql<{ name: string }[]>`
        SELECT name FROM schema_migrations
        WHERE name = '022_backfill_template_brands.sql'
        LIMIT 1
      `
      .then((rows) => {
        if (!rows.length) throw new Error("Database migrations are not current. Run `npm run db:migrate`.");
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        globalForDatabase.listingPostgresSchema = undefined;
        throw new Error(
          error instanceof Error && error.message.includes("migrations")
            ? error.message
            : "Cannot connect to PostgreSQL. Start it with `npm run db:start`, run `npm run db:migrate`, and try again.",
          { cause: error },
        );
      });
  }

  await globalForDatabase.listingPostgresSchema;
}

type ObjectUpload = {
  key: string;
  bytes: Buffer;
  contentType: string;
  sha256: string;
  metadata?: Record<string, string>;
};

async function uploadObjectsAtomically(objects: readonly ObjectUpload[]) {
  const settled = await Promise.allSettled(
    objects.map(async (object) => {
      await putStoredObject(object);
      return object.key;
    }),
  );
  const uploadedKeys = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    await deleteStoredObjects(uploadedKeys).catch((cleanupError) => {
      console.warn("[R2] Could not roll back uploaded objects:", cleanupError);
    });
    throw failed.reason;
  }
  return uploadedKeys;
}

async function deleteObjectKeysBestEffort(keys: readonly (string | null)[]) {
  const filtered = keys.filter((key): key is string => Boolean(key));
  if (!filtered.length) return;
  try {
    if (objectStorageDriver() !== "r2") return;
    await deleteStoredObjects(filtered);
  } catch (error) {
    console.warn("[R2] Could not remove unreferenced objects:", error);
  }
}

async function resolveStoredBytes(
  objectKey: string | null,
  databaseBytes: Buffer | null,
  label: string,
) {
  if (objectKey && objectStorageDriver() === "r2") {
    const object = await getStoredObject(objectKey);
    if (object) return object.bytes;
    if (databaseBytes) {
      console.warn(`[R2] ${label} was missing; using the retained database copy.`);
      return databaseBytes;
    }
    throw new Error(`${label} is missing from Cloudflare R2 (${objectKey}).`);
  }
  if (databaseBytes) return databaseBytes;
  if (objectKey) {
    throw new Error(
      `${label} is stored in Cloudflare R2. Set OBJECT_STORAGE_DRIVER=r2 and configure its credentials.`,
    );
  }
  throw new Error(`${label} has no stored bytes or object key.`);
}

export async function getDatabaseClient() {
  await ensureSchema();
  return getDatabase();
}

export async function checkDatabaseHealth() {
  await ensureSchema();
  const sql = getDatabase();
  await sql`SELECT 1`;
}

export async function closeDatabaseConnection() {
  const sql = globalForDatabase.listingPostgres;
  globalForDatabase.listingPostgres = undefined;
  globalForDatabase.listingPostgresSchema = undefined;
  if (sql) await sql.end({ timeout: 5 });
}

export type AppUserStatus = "pending" | "approved" | "rejected" | "disabled";

export interface AppUserSummary {
  teamId: string;
  userId: string;
  username: string;
  displayName: string;
  role: "editor" | "reviewer" | "admin";
  status: AppUserStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AppUserRow {
  team_id: string;
  user_id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: "editor" | "reviewer" | "admin";
  status: AppUserStatus;
  approved_by: string | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function toAppUserSummary(row: AppUserRow): AppUserSummary {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPendingUserAccount(input: {
  teamId: string;
  username: string;
  displayName: string;
  passwordHash: string;
}): Promise<AppUserSummary | null> {
  await ensureSchema();
  const sql = getDatabase();
  try {
    const rows = await sql<AppUserRow[]>`
      INSERT INTO app_users (
        team_id, user_id, username, display_name, password_hash, role, status
      ) VALUES (
        ${input.teamId}, ${crypto.randomUUID()}, ${input.username},
        ${input.displayName}, ${input.passwordHash}, 'editor', 'pending'
      )
      RETURNING team_id, user_id, username, display_name, password_hash, role,
        status, approved_by, approved_at::text, last_login_at::text,
        created_at::text, updated_at::text
    `;
    return toAppUserSummary(rows[0]);
  } catch (error) {
    if (
      typeof error === "object" && error !== null &&
      "code" in error && error.code === "23505"
    ) {
      return null;
    }
    throw error;
  }
}

export async function getUserAccountForLogin(teamId: string, username: string) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<AppUserRow[]>`
    SELECT team_id, user_id, username, display_name, password_hash, role,
      status, approved_by, approved_at::text, last_login_at::text,
      created_at::text, updated_at::text
    FROM app_users
    WHERE team_id = ${teamId} AND LOWER(username) = LOWER(${username})
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...toAppUserSummary(row), passwordHash: row.password_hash } : null;
}

export async function getUserAccountForLoginById(teamId: string, userId: string) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<AppUserRow[]>`
    SELECT team_id, user_id, username, display_name, password_hash, role,
      status, approved_by, approved_at::text, last_login_at::text,
      created_at::text, updated_at::text
    FROM app_users
    WHERE team_id = ${teamId} AND user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...toAppUserSummary(row), passwordHash: row.password_hash } : null;
}

export async function updateUserPassword(scope: DataScope, passwordHash: string) {
  await ensureSchema();
  const sql = getDatabase();
  const updated = await sql<{ user_id: string }[]>`
    UPDATE app_users
    SET password_hash = ${passwordHash}, updated_at = NOW()
    WHERE team_id = ${scope.teamId}
      AND user_id = ${scope.actorId}
      AND status = 'approved'
    RETURNING user_id
  `;
  if (!updated.length) return false;
  await recordAuditEvent(scope, "user.password_changed", "app_user", scope.actorId);
  return true;
}

export async function recordUserLogin(teamId: string, userId: string) {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    UPDATE app_users
    SET last_login_at = NOW(), updated_at = NOW()
    WHERE team_id = ${teamId} AND user_id = ${userId}
  `;
}

export async function listTeamUserAccounts(teamId: string): Promise<AppUserSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<AppUserRow[]>`
    SELECT team_id, user_id, username, display_name, password_hash, role,
      status, approved_by, approved_at::text, last_login_at::text,
      created_at::text, updated_at::text
    FROM app_users
    WHERE team_id = ${teamId}
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      created_at DESC
  `;
  return rows.map(toAppUserSummary);
}

export async function updateTeamUserAccount(
  scope: DataScope,
  targetUserId: string,
  action: "approve" | "reject" | "disable" | "restore",
): Promise<AppUserSummary | null> {
  await ensureSchema();
  const sql = getDatabase();
  const statusByAction: Record<typeof action, AppUserStatus> = {
    approve: "approved",
    reject: "rejected",
    disable: "disabled",
    restore: "approved",
  };
  const nextStatus = statusByAction[action];
  const rows = await sql<AppUserRow[]>`
    UPDATE app_users
    SET
      status = ${nextStatus},
      approved_by = CASE WHEN ${nextStatus} = 'approved' THEN ${scope.actorId} ELSE approved_by END,
      approved_at = CASE WHEN ${nextStatus} = 'approved' THEN NOW() ELSE approved_at END,
      updated_at = NOW()
    WHERE team_id = ${scope.teamId}
      AND user_id = ${targetUserId}
      AND user_id <> ${scope.actorId}
    RETURNING team_id, user_id, username, display_name, password_hash, role,
      status, approved_by, approved_at::text, last_login_at::text,
      created_at::text, updated_at::text
  `;
  if (!rows[0]) return null;
  await recordAuditEvent(scope, `user.${action}`, "app_user", targetUserId, {
    status: nextStatus,
  });
  return toAppUserSummary(rows[0]);
}

export interface ImageStorageStats {
  listingRows: number;
  listingDatabaseBytes: number;
  listingR2BackedDatabaseBytes: number;
  trelloPreviewRows: number;
  trelloPreviewDatabaseBytes: number;
  trelloR2BackedDatabaseBytes: number;
}

export async function getImageStorageStats(teamId: string): Promise<ImageStorageStats> {
  await ensureSchema();
  const sql = getDatabase();
  const [listing] = await sql<{
    row_count: number;
    database_bytes: string;
    r2_backed_database_bytes: string;
  }[]>`
    SELECT
      COUNT(*)::int AS row_count,
      COALESCE(SUM(
        COALESCE(OCTET_LENGTH(image_bytes), 0) +
        COALESCE(OCTET_LENGTH(ai_image_bytes), 0) +
        COALESCE(OCTET_LENGTH(preview_image_bytes), 0)
      ), 0)::bigint AS database_bytes,
      COALESCE(SUM(
        CASE WHEN original_object_key IS NOT NULL THEN COALESCE(OCTET_LENGTH(image_bytes), 0) ELSE 0 END +
        CASE WHEN ai_object_key IS NOT NULL THEN COALESCE(OCTET_LENGTH(ai_image_bytes), 0) ELSE 0 END +
        CASE WHEN preview_object_key IS NOT NULL THEN COALESCE(OCTET_LENGTH(preview_image_bytes), 0) ELSE 0 END
      ), 0)::bigint AS r2_backed_database_bytes
    FROM listing_images
    WHERE team_id = ${teamId}
  `;
  const [trello] = await sql<{
    row_count: number;
    database_bytes: string;
    r2_backed_database_bytes: string;
  }[]>`
    SELECT
      COUNT(*)::int AS row_count,
      COALESCE(SUM(COALESCE(OCTET_LENGTH(image_bytes), 0)), 0)::bigint AS database_bytes,
      COALESCE(SUM(
        CASE WHEN object_key IS NOT NULL THEN COALESCE(OCTET_LENGTH(image_bytes), 0) ELSE 0 END
      ), 0)::bigint AS r2_backed_database_bytes
    FROM trello_image_previews
    WHERE team_id = ${teamId}
  `;
  return {
    listingRows: Number(listing.row_count),
    listingDatabaseBytes: Number(listing.database_bytes),
    listingR2BackedDatabaseBytes: Number(listing.r2_backed_database_bytes),
    trelloPreviewRows: Number(trello.row_count),
    trelloPreviewDatabaseBytes: Number(trello.database_bytes),
    trelloR2BackedDatabaseBytes: Number(trello.r2_backed_database_bytes),
  };
}

export async function clearR2BackedImageBytes(scope: DataScope) {
  await ensureSchema();
  const sql = getDatabase();
  const before = await getImageStorageStats(scope.teamId);
  const [listingRows, trelloRows] = await sql.begin(async (transaction) => {
    const listing = await transaction<{ id: string }[]>`
      UPDATE listing_images
      SET
        image_bytes = CASE WHEN original_object_key IS NOT NULL THEN NULL ELSE image_bytes END,
        ai_image_bytes = CASE WHEN ai_object_key IS NOT NULL THEN NULL ELSE ai_image_bytes END,
        preview_image_bytes = CASE WHEN preview_object_key IS NOT NULL THEN NULL ELSE preview_image_bytes END
      WHERE team_id = ${scope.teamId}
        AND (
          (original_object_key IS NOT NULL AND image_bytes IS NOT NULL) OR
          (ai_object_key IS NOT NULL AND ai_image_bytes IS NOT NULL) OR
          (preview_object_key IS NOT NULL AND preview_image_bytes IS NOT NULL)
        )
      RETURNING id::text
    `;
    const trello = await transaction<{ attachment_id: string }[]>`
      UPDATE trello_image_previews
      SET image_bytes = NULL, updated_at = NOW()
      WHERE team_id = ${scope.teamId}
        AND object_key IS NOT NULL
        AND image_bytes IS NOT NULL
      RETURNING attachment_id
    `;
    return [listing.length, trello.length] as const;
  });
  const after = await getImageStorageStats(scope.teamId);
  const freedBytes = Math.max(
    0,
    before.listingDatabaseBytes + before.trelloPreviewDatabaseBytes -
      after.listingDatabaseBytes - after.trelloPreviewDatabaseBytes,
  );
  await recordAuditEvent(scope, "storage.database_image_bytes_cleared", "storage", scope.teamId, {
    listingRows,
    trelloRows,
    freedBytes,
  });
  return { listingRows, trelloRows, freedBytes, stats: after };
}

export interface UserTrelloSettings {
  boardId: string;
  listingSourceListId: string;
  listingTargetListId: string;
  mockupSourceListId: string;
  mockupTargetListId: string;
}

export async function getUserTrelloSettings(scope: DataScope): Promise<UserTrelloSettings> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<{
    board_id: string;
    listing_source_list_id: string;
    listing_target_list_id: string;
    mockup_source_list_id: string;
    mockup_target_list_id: string;
  }[]>`
    SELECT board_id, listing_source_list_id, listing_target_list_id,
      mockup_source_list_id, mockup_target_list_id
    FROM user_trello_settings
    WHERE team_id = ${scope.teamId} AND actor_id = ${scope.actorId}
    LIMIT 1
  `;
  const row = rows[0];
  return {
    boardId: row?.board_id || "",
    listingSourceListId: row?.listing_source_list_id || "",
    listingTargetListId: row?.listing_target_list_id || "",
    mockupSourceListId: row?.mockup_source_list_id || "",
    mockupTargetListId: row?.mockup_target_list_id || "",
  };
}

export async function getUserTrelloBoardId(scope: DataScope): Promise<string> {
  return (await getUserTrelloSettings(scope)).boardId;
}

export async function saveUserTrelloBoardId(
  scope: DataScope,
  boardId: string,
): Promise<void> {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    INSERT INTO user_trello_settings (team_id, actor_id, board_id)
    VALUES (${scope.teamId}, ${scope.actorId}, ${boardId})
    ON CONFLICT (team_id, actor_id) DO UPDATE SET
      board_id = EXCLUDED.board_id,
      updated_at = NOW()
  `;
}

export async function saveUserTrelloSettings(
  scope: DataScope,
  settings: UserTrelloSettings,
): Promise<void> {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    INSERT INTO user_trello_settings (
      team_id, actor_id, board_id, listing_source_list_id,
      listing_target_list_id, mockup_source_list_id, mockup_target_list_id
    ) VALUES (
      ${scope.teamId}, ${scope.actorId}, ${settings.boardId},
      ${settings.listingSourceListId}, ${settings.listingTargetListId},
      ${settings.mockupSourceListId}, ${settings.mockupTargetListId}
    )
    ON CONFLICT (team_id, actor_id) DO UPDATE SET
      board_id = EXCLUDED.board_id,
      listing_source_list_id = EXCLUDED.listing_source_list_id,
      listing_target_list_id = EXCLUDED.listing_target_list_id,
      mockup_source_list_id = EXCLUDED.mockup_source_list_id,
      mockup_target_list_id = EXCLUDED.mockup_target_list_id,
      updated_at = NOW()
  `;
}

export async function saveTrelloImageDerivatives(
  scope: DataScope,
  cardId: string,
  attachmentId: string,
  derivatives: readonly TrelloImageDerivative[],
) {
  if (derivatives.length === 0) return;
  await ensureSchema();
  const sql = getDatabase();
  const useR2 = objectStorageDriver() === "r2";
  const keepDatabaseBytes = !useR2 || retainDatabaseObjectBytes();
  const uploadId = crypto.randomUUID();
  const storedDerivatives = derivatives.map((derivative) => ({
    ...derivative,
    objectKey: useR2
      ? trelloPreviewObjectKey({
          prefix: r2KeyPrefix(),
          teamId: scope.teamId,
          cardId,
          attachmentId,
          variant: derivative.variant,
          mimeType: derivative.mimeType,
          bytes: derivative.bytes,
          objectId: uploadId,
        })
      : null,
  }));
  const oldRows = await sql<{ object_key: string | null }[]>`
    SELECT object_key
    FROM trello_image_previews
    WHERE team_id = ${scope.teamId}
      AND card_id = ${cardId}
      AND attachment_id = ${attachmentId}
      AND variant IN ${sql(derivatives.map((item) => item.variant))}
  `;
  const uploadedKeys = useR2
    ? await uploadObjectsAtomically(
        storedDerivatives.map((derivative) => ({
          key: derivative.objectKey!,
          bytes: derivative.bytes,
          contentType: derivative.mimeType,
          sha256: derivative.sha256,
          metadata: {
            kind: "trello-preview",
            variant: derivative.variant,
          },
        })),
      )
    : [];
  try {
    await sql.begin(async (transaction) => {
      for (const derivative of storedDerivatives) {
        await transaction`
          INSERT INTO trello_image_previews (
            team_id, card_id, attachment_id, variant, mime_type, image_bytes,
            object_key, image_byte_size, width, height, sha256
          ) VALUES (
            ${scope.teamId}, ${cardId}, ${attachmentId}, ${derivative.variant},
            ${derivative.mimeType}, ${keepDatabaseBytes ? derivative.bytes : null},
            ${derivative.objectKey}, ${derivative.bytes.byteLength},
            ${derivative.width}, ${derivative.height}, ${derivative.sha256}
          )
          ON CONFLICT (team_id, card_id, attachment_id, variant) DO UPDATE SET
            mime_type = EXCLUDED.mime_type,
            image_bytes = EXCLUDED.image_bytes,
            object_key = EXCLUDED.object_key,
            image_byte_size = EXCLUDED.image_byte_size,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            sha256 = EXCLUDED.sha256,
            updated_at = NOW()
        `;
      }
    });
  } catch (error) {
    await deleteObjectKeysBestEffort(uploadedKeys);
    throw error;
  }
  const currentKeys = new Set(storedDerivatives.map((item) => item.objectKey));
  await deleteObjectKeysBestEffort(
    oldRows.map((row) => row.object_key).filter((key) => !currentKeys.has(key)),
  );
}

export async function deleteTrelloImageDerivatives(
  scope: DataScope,
  cardId: string,
  attachmentIds: readonly string[],
) {
  if (attachmentIds.length === 0) return 0;
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql<{ attachment_id: string; object_key: string | null }[]>`
    DELETE FROM trello_image_previews
    WHERE team_id = ${scope.teamId}
      AND card_id = ${cardId}
      AND attachment_id IN ${sql([...attachmentIds])}
    RETURNING attachment_id, object_key
  `;
  await deleteObjectKeysBestEffort(deleted.map((row) => row.object_key));
  return deleted.length;
}

function configuredPreviewRetentionDays() {
  const parsed = Number(process.env.TRELLO_PREVIEW_RETENTION_DAYS || 90);
  return Number.isFinite(parsed)
    ? Math.min(3_650, Math.max(7, Math.round(parsed)))
    : 90;
}

export async function pruneExpiredTrelloImageDerivatives(options: {
  scope?: DataScope;
  retentionDays?: number;
  batchSize?: number;
} = {}) {
  await ensureSchema();
  const sql = getDatabase();
  const retentionDays = Number.isFinite(options.retentionDays)
    ? Math.min(3_650, Math.max(7, Math.round(options.retentionDays!)))
    : configuredPreviewRetentionDays();
  const batchSize = Number.isFinite(options.batchSize)
    ? Math.min(10_000, Math.max(100, Math.round(options.batchSize!)))
    : 1_000;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  const deleted = options.scope
    ? await sql<{ attachment_id: string; object_key: string | null }[]>`
        WITH expired AS (
          SELECT team_id, card_id, attachment_id, variant
          FROM trello_image_previews
          WHERE team_id = ${options.scope.teamId}
            AND updated_at < ${cutoff}
          ORDER BY updated_at ASC
          LIMIT ${batchSize}
        )
        DELETE FROM trello_image_previews AS preview
        USING expired
        WHERE preview.team_id = expired.team_id
          AND preview.card_id = expired.card_id
          AND preview.attachment_id = expired.attachment_id
          AND preview.variant = expired.variant
        RETURNING preview.attachment_id, preview.object_key
      `
    : await sql<{ attachment_id: string; object_key: string | null }[]>`
        WITH expired AS (
          SELECT team_id, card_id, attachment_id, variant
          FROM trello_image_previews
          WHERE updated_at < ${cutoff}
          ORDER BY updated_at ASC
          LIMIT ${batchSize}
        )
        DELETE FROM trello_image_previews AS preview
        USING expired
        WHERE preview.team_id = expired.team_id
          AND preview.card_id = expired.card_id
          AND preview.attachment_id = expired.attachment_id
          AND preview.variant = expired.variant
        RETURNING preview.attachment_id, preview.object_key
      `;

  await deleteObjectKeysBestEffort(deleted.map((row) => row.object_key));
  return deleted.length;
}

export async function vacuumImageStorageTables() {
  await ensureSchema();
  const sql = getDatabase();
  await sql.unsafe("VACUUM (ANALYZE) trello_image_previews");
  await sql.unsafe("VACUUM (ANALYZE) listing_images");
}

export async function getTrelloImageDerivative(
  scope: DataScope,
  cardId: string,
  attachmentId: string,
  variant: TrelloImagePreviewVariant,
) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<{
    mime_type: string;
    image_bytes: Buffer | null;
    object_key: string | null;
    width: number;
    height: number;
    sha256: string;
  }[]>`
    SELECT mime_type, image_bytes, object_key, width, height, sha256
    FROM trello_image_previews
    WHERE team_id = ${scope.teamId}
      AND card_id = ${cardId}
      AND attachment_id = ${attachmentId}
      AND variant = ${variant}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    ...rows[0],
    image_bytes: await resolveStoredBytes(
      rows[0].object_key,
      rows[0].image_bytes,
      `Trello ${variant} derivative`,
    ),
  };
}

export async function listTrelloImageDerivativeReferences(
  scope: DataScope,
  cardIds: readonly string[],
) {
  if (cardIds.length === 0) return [];
  await ensureSchema();
  const sql = getDatabase();
  return sql<{
    cardId: string;
    attachmentId: string;
    variant: TrelloImagePreviewVariant;
    sha256: string;
  }[]>`
    SELECT
      card_id AS "cardId",
      attachment_id AS "attachmentId",
      variant,
      sha256
    FROM trello_image_previews
    WHERE team_id = ${scope.teamId}
      AND card_id IN ${sql(cardIds)}
  `;
}

interface ListingRow {
  id: string;
  internal_name: string;
  product_type: string;
  marketplace: "US" | "UK" | "DE";
  status: ListingStatus;
  model_used: ListingResult["model_used"];
  input_json: ListingInput | string;
  result_json: ListingResult | string;
  current_listing_json: ListingContent | string;
  source_trello_card_id?: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function toJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function toStoredListing(row: ListingRow): StoredListing {
  return {
    id: row.id,
    status: row.status,
    input: parseJson(row.input_json),
    result: parseJson(row.result_json),
    current_listing: parseJson(row.current_listing_json),
    revisions: [],
    source_trello_card_id: row.source_trello_card_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function storedInputReferences(input: ListingInput, listingId: string): ListingInput {
  return {
    ...input,
    images: input.images.map((image, imageIndex) => ({
      name: image.name,
      type: image.type,
      data_url: "",
      storage_key: image.storage_key || `db:${listingId}:${imageIndex}`,
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    })),
  };
}

export async function saveGeneratedListing(
  scope: DataScope,
  input: ListingInput,
  result: ListingResult,
  options: { sourceTrelloCardId?: string } = {},
) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Draft"
    : "Review";

  const storedInputBase = result.competitor_profile
    ? { ...input, research: { ...input.research, competitor_profile: result.competitor_profile } }
    : input;
  const useR2 = objectStorageDriver() === "r2";
  const keepDatabaseBytes = !useR2 || retainDatabaseObjectBytes();
  const prefix = useR2 ? r2KeyPrefix() : "";
  const images = await Promise.all(input.images.map(async (image, imageIndex) => {
    const derivatives = await createStoredImageDerivatives(image);
    const id = crypto.randomUUID();
    const sha256 = createHash("sha256")
      .update(derivatives.originalBytes)
      .digest("hex");
    const aiSha256 = createHash("sha256").update(derivatives.aiBytes).digest("hex");
    const previewSha256 = createHash("sha256")
      .update(derivatives.previewBytes)
      .digest("hex");
    return {
      ...image,
      ...derivatives,
      imageIndex,
      sha256,
      aiSha256,
      previewSha256,
      id,
      originalObjectKey: useR2
        ? listingImageObjectKey({
            prefix,
            teamId: scope.teamId,
            listingId: result.request_id,
            imageIndex,
            variant: "original",
            mimeType: derivatives.originalMimeType,
            bytes: derivatives.originalBytes,
            objectId: id,
          })
        : null,
      aiObjectKey: useR2
        ? listingImageObjectKey({
            prefix,
            teamId: scope.teamId,
            listingId: result.request_id,
            imageIndex,
            variant: "ai",
            mimeType: derivatives.aiMimeType,
            bytes: derivatives.aiBytes,
            objectId: id,
          })
        : null,
      previewObjectKey: useR2
        ? listingImageObjectKey({
            prefix,
            teamId: scope.teamId,
            listingId: result.request_id,
            imageIndex,
            variant: "preview",
            mimeType: derivatives.previewMimeType,
            bytes: derivatives.previewBytes,
            objectId: id,
          })
        : null,
    };
  }));
  const uploadedKeys = useR2
    ? await uploadObjectsAtomically(
        images.flatMap((image) => [
          {
            key: image.originalObjectKey!,
            bytes: image.originalBytes,
            contentType: image.originalMimeType,
            sha256: image.sha256,
            metadata: { kind: "listing-image", variant: "original" },
          },
          {
            key: image.aiObjectKey!,
            bytes: image.aiBytes,
            contentType: image.aiMimeType,
            sha256: image.aiSha256,
            metadata: { kind: "listing-image", variant: "ai" },
          },
          {
            key: image.previewObjectKey!,
            bytes: image.previewBytes,
            contentType: image.previewMimeType,
            sha256: image.previewSha256,
            metadata: { kind: "listing-image", variant: "preview" },
          },
        ]),
      )
    : [];
  const storedInput: ListingInput = {
    ...storedInputBase,
    images: images.map((image) => ({
      name: image.originalName,
      type: image.originalMimeType,
      data_url: "",
      storage_key: useR2
        ? `r2:${image.originalObjectKey}`
        : `db:${result.request_id}:${image.imageIndex}`,
      sha256: image.sha256,
      width: image.width || undefined,
      height: image.height || undefined,
      bytes: image.originalBytes.byteLength,
    })),
  };
  try {
    await sql.begin(async (transaction) => {
      await transaction`
      INSERT INTO listings (
        id, team_id, internal_name, product_type, marketplace, status, model_used,
        input_json, result_json, current_listing_json, source_trello_card_id
      ) VALUES (
        ${result.request_id}, ${scope.teamId}, ${input.internal_name}, ${input.product_type},
        ${input.marketplace}, ${status}, ${result.model_used}, ${transaction.json(toJson(storedInput))},
        ${transaction.json(toJson(result))}, ${transaction.json(toJson(result.listing))},
        ${options.sourceTrelloCardId || null}
      )
      `;
      for (const image of images) {
        await transaction`
        INSERT INTO listing_images (
          id, listing_id, team_id, image_index, name, mime_type, sha256, image_bytes,
          width, height, ai_mime_type, ai_image_bytes, preview_mime_type,
          preview_image_bytes, preview_width, preview_height, original_object_key,
          original_byte_size, ai_object_key, ai_byte_size, preview_object_key,
          preview_byte_size
        ) VALUES (
          ${image.id}, ${result.request_id}, ${scope.teamId}, ${image.imageIndex},
          ${image.originalName}, ${image.originalMimeType}, ${image.sha256},
          ${keepDatabaseBytes ? image.originalBytes : null}, ${image.width}, ${image.height},
          ${image.aiMimeType}, ${keepDatabaseBytes ? image.aiBytes : null}, ${image.previewMimeType},
          ${keepDatabaseBytes ? image.previewBytes : null}, ${image.previewWidth}, ${image.previewHeight},
          ${image.originalObjectKey}, ${image.originalBytes.byteLength},
          ${image.aiObjectKey}, ${image.aiBytes.byteLength}, ${image.previewObjectKey},
          ${image.previewBytes.byteLength}
        )
        `;
      }
      await transaction`
      INSERT INTO listing_revisions (
        listing_id, team_id, actor_id, action, instruction, content_json, quality_json
      ) VALUES (
        ${result.request_id}, ${scope.teamId}, ${scope.actorId}, 'generated', '',
        ${transaction.json(toJson(result.listing))},
        ${transaction.json(toJson(qualitySnapshot(result)))}
      )
      `;
      await transaction`
      INSERT INTO audit_events (
        team_id, actor_id, action, resource_type, resource_id, metadata_json
      ) VALUES (
        ${scope.teamId}, ${scope.actorId}, 'listing.generated', 'listing', ${result.request_id},
        ${transaction.json(toJson({ model: result.metadata.model_name }))}
      )
      `;
    });
  } catch (error) {
    await deleteObjectKeysBestEffort(uploadedKeys);
    throw error;
  }
  return getListing(scope, result.request_id);
}

export async function listListings(scope: DataScope, limit = 30): Promise<ListingSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingSummary[]>`
    SELECT
      id::text,
      internal_name,
      COALESCE(input_json->>'main_keyword', '') AS main_keyword,
      product_type,
      marketplace,
      status,
      model_used,
      COALESCE((result_json->'content_quality'->>'fact_coverage_percent')::int, 100)::int AS fact_coverage_percent,
      COALESCE((result_json->'seo_analysis'->>'keyword_coverage_percent')::int, 0)::int AS keyword_coverage_percent,
      COALESCE(jsonb_array_length(result_json->'policy_validation'->'errors'), 0)::int AS error_count,
      COALESCE(jsonb_array_length(result_json->'policy_validation'->'warnings'), 0)::int AS warning_count,
      COALESCE(jsonb_array_length(result_json->'content_quality'->'unused_facts'), 0)::int AS missing_fact_count,
      created_at::text,
      updated_at::text
    FROM listings
    WHERE team_id = ${scope.teamId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return [...rows];
}

export async function getListing(scope: DataScope, id: string): Promise<StoredListing | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingRow[]>`
    SELECT
      id::text,
      internal_name,
      product_type,
      marketplace,
      status,
      model_used,
      input_json,
      result_json,
      current_listing_json,
      source_trello_card_id::text,
      created_at::text,
      updated_at::text
    FROM listings
    WHERE id = ${id} AND team_id = ${scope.teamId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const listing = toStoredListing(rows[0]);
  listing.revisions = await listRevisions(scope, id);

  const imageRows = await sql<{
    image_index: number;
    name: string;
    mime_type: string;
    sha256: string;
    byte_size: number;
    width: number | null;
    height: number | null;
  }[]>`
    SELECT
      image_index,
      name,
      mime_type,
      sha256,
      COALESCE(original_byte_size, OCTET_LENGTH(image_bytes), 0)::int AS byte_size,
      width,
      height
    FROM listing_images
    WHERE listing_id = ${id} AND team_id = ${scope.teamId}
    ORDER BY image_index ASC
  `;
  const imageMap = new Map(imageRows.map((image) => [image.image_index, image]));
  if (listing.input && Array.isArray(listing.input.images)) {
    listing.input.images = listing.input.images.map((image, index) => {
      const storedImage = imageMap.get(index);
      if (!storedImage) return image;
      const version = storedImage.sha256.slice(0, 16);
      const baseUrl = `/api/listings/${encodeURIComponent(id)}/images/${index}`;
      return {
        name: storedImage.name,
        type: storedImage.mime_type,
        data_url: `${baseUrl}?variant=preview&v=${version}&dv=${IMAGE_DERIVATIVE_VERSION}`,
        download_url: `${baseUrl}?download=1&v=${version}`,
        storage_key: image.storage_key || `db:${id}:${index}`,
        sha256: storedImage.sha256,
        width: storedImage.width || undefined,
        height: storedImage.height || undefined,
        bytes: storedImage.byte_size,
      };
    });
  }

  return listing;
}

export async function getLatestListingForTrelloCard(
  scope: DataScope,
  cardId: string,
  sku?: string,
): Promise<StoredListing | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<{ id: string }[]>`
    SELECT id::text
    FROM listings
    WHERE team_id = ${scope.teamId}
      AND (
        source_trello_card_id = ${cardId}
        OR (
          source_trello_card_id IS NULL
          AND ${sku || ""} <> ''
          AND (
            internal_name = ${sku || ""}
            OR LEFT(internal_name, LENGTH(${sku || ""}) + 1) = ${`${sku || ""}_`}
          )
        )
      )
    ORDER BY (source_trello_card_id = ${cardId}) DESC, created_at DESC
    LIMIT 1
  `;
  return rows[0] ? getListing(scope, rows[0].id) : null;
}

export async function getListingWithAiImages(
  scope: DataScope,
  id: string,
): Promise<StoredListing | null> {
  const listing = await getListing(scope, id);
  if (!listing) return null;
  const sql = getDatabase();
  const imageRows = await sql<{
    image_index: number;
    mime_type: string;
    image_bytes: Buffer | null;
    object_key: string | null;
  }[]>`
    SELECT
      image_index,
      COALESCE(ai_mime_type, mime_type) AS mime_type,
      COALESCE(ai_image_bytes, image_bytes) AS image_bytes,
      COALESCE(ai_object_key, original_object_key) AS object_key
    FROM listing_images
    WHERE listing_id = ${id} AND team_id = ${scope.teamId}
    ORDER BY image_index ASC
  `;
  const resolvedRows = await Promise.all(
    imageRows.map(async (image) => ({
      ...image,
      image_bytes: await resolveStoredBytes(
        image.object_key,
        image.image_bytes,
        `AI image ${image.image_index} for listing ${id}`,
      ),
    })),
  );
  const imageMap = new Map(resolvedRows.map((image) => [image.image_index, image]));
  listing.input.images = listing.input.images.map((image, index) => {
    const storedImage = imageMap.get(index);
    if (!storedImage) return image;
    return {
      ...image,
      type: storedImage.mime_type,
      data_url: `data:${storedImage.mime_type};base64,${storedImage.image_bytes.toString("base64")}`,
    };
  });
  return listing;
}

export async function getListingImage(
  scope: DataScope,
  listingId: string,
  imageIndex: number,
  variant: "original" | "preview",
) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<{
    name: string;
    mime_type: string;
    sha256: string;
    image_bytes: Buffer | null;
    object_key: string | null;
  }[]>`
    SELECT
      name,
      CASE
        WHEN ${variant} = 'preview' THEN COALESCE(preview_mime_type, mime_type)
        ELSE mime_type
      END AS mime_type,
      sha256,
      CASE
        WHEN ${variant} = 'preview' THEN COALESCE(preview_image_bytes, image_bytes)
        ELSE image_bytes
      END AS image_bytes,
      CASE
        WHEN ${variant} = 'preview' THEN COALESCE(preview_object_key, original_object_key)
        ELSE original_object_key
      END AS object_key
    FROM listing_images
    WHERE listing_id = ${listingId}
      AND team_id = ${scope.teamId}
      AND image_index = ${imageIndex}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    ...rows[0],
    image_bytes: await resolveStoredBytes(
      rows[0].object_key,
      rows[0].image_bytes,
      `${variant} image ${imageIndex} for listing ${listingId}`,
    ),
  };
}

export async function updateListingContent(
  scope: DataScope,
  id: string,
  listing: ListingContent,
  result: ListingResult,
  options: {
    action?: string;
    instruction?: string;
    input?: ListingInput;
  } = {},
) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Draft"
    : "Review";
  const changed = options.input
    ? await sql<{ id: string }[]>`
        UPDATE listings
        SET
          status = ${status},
          input_json = ${sql.json(toJson(storedInputReferences(options.input, id)))},
          result_json = ${sql.json(toJson(result))},
          current_listing_json = ${sql.json(toJson(listing))},
          updated_at = NOW()
        WHERE id = ${id} AND team_id = ${scope.teamId}
        RETURNING id::text
      `
    : await sql<{ id: string }[]>`
        UPDATE listings
        SET
          status = ${status},
          result_json = ${sql.json(toJson(result))},
          current_listing_json = ${sql.json(toJson(listing))},
          updated_at = NOW()
        WHERE id = ${id} AND team_id = ${scope.teamId}
        RETURNING id::text
      `;
  if (!changed.length) return null;
  await addRevision(
    scope,
    id,
    options.action || "manual_edit",
    listing,
    result,
    options.instruction,
  );
  await recordAuditEvent(scope, `listing.${options.action || "manual_edit"}`, "listing", id);
  return getListing(scope, id);
}

export async function setListingStatus(scope: DataScope, id: string, status: ListingStatus) {
  await ensureSchema();
  const sql = getDatabase();
  const changed = await sql<
    { id: string; current_listing_json: ListingContent | string; result_json: ListingResult | string }[]
  >`
    UPDATE listings
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} AND team_id = ${scope.teamId} AND status = 'Draft'
    RETURNING id::text, current_listing_json, result_json
  `;
  if (!changed.length) return null;
  await addRevision(
    scope,
    id,
    status === "Review" ? "submitted_for_review" : status.toLowerCase(),
    parseJson(changed[0].current_listing_json),
    parseJson(changed[0].result_json),
  );
  await recordAuditEvent(scope, `listing.status.${status.toLowerCase()}`, "listing", id);
  return getListing(scope, id);
}

export async function setListingStatusWithValidation(
  scope: DataScope,
  id: string,
  status: ListingStatus,
  input: ListingInput,
  result: ListingResult,
) {
  await ensureSchema();
  const sql = getDatabase();
  const expectedStatus = status === "Approved" ? "Review" : status === "Exported" ? "Approved" : "";
  const changed = await sql<
    { id: string; current_listing_json: ListingContent | string }[]
  >`
    UPDATE listings
    SET
      status = ${status},
      input_json = ${sql.json(toJson(storedInputReferences(input, id)))},
      result_json = ${sql.json(toJson(result))},
      updated_at = NOW()
    WHERE id = ${id} AND team_id = ${scope.teamId}
      AND (${expectedStatus} = '' OR status = ${expectedStatus})
    RETURNING id::text, current_listing_json
  `;
  if (!changed.length) return null;
  await addRevision(
    scope,
    id,
    status === "Approved" ? "approved_after_revalidation" : status.toLowerCase(),
    parseJson(changed[0].current_listing_json),
    result,
  );
  await recordAuditEvent(scope, `listing.status.${status.toLowerCase()}`, "listing", id, {
    policy_version: result.metadata.policy_version,
    error_count: result.policy_validation.errors.length,
  });
  return getListing(scope, id);
}

function qualitySnapshot(result: ListingResult) {
  return {
    fact_coverage_percent: result.content_quality.fact_coverage_percent,
    keyword_coverage_percent: result.seo_analysis.keyword_coverage_percent,
    error_count: result.policy_validation.errors.length,
    warning_count: result.policy_validation.warnings.length,
  };
}

async function addRevision(
  scope: DataScope,
  id: string,
  action: string,
  content: ListingContent,
  result: ListingResult,
  instruction = "",
) {
  const sql = getDatabase();
  await sql`
    INSERT INTO listing_revisions (listing_id, team_id, actor_id, action, instruction, content_json, quality_json)
    VALUES (
      ${id},
      ${scope.teamId},
      ${scope.actorId},
      ${action},
      ${instruction},
      ${sql.json(toJson(content))},
      ${sql.json(toJson(qualitySnapshot(result)))}
    )
  `;
}

interface RevisionRow {
  id: string;
  action: string;
  instruction: string;
  content_json: ListingContent | string;
  quality_json: ListingRevision["quality"] | string | null;
  created_at: string;
}

export async function listRevisions(scope: DataScope, id: string, limit = 30): Promise<ListingRevision[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<RevisionRow[]>`
    SELECT * FROM (
      SELECT id::text, action, instruction, content_json, quality_json, created_at::text
      FROM listing_revisions
      WHERE listing_id = ${id} AND team_id = ${scope.teamId}
        AND content_json ? 'title'
        AND content_json ? 'bullet_points'
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    ) recent
    ORDER BY created_at ASC, id::bigint ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    instruction: row.instruction,
    content: parseJson(row.content_json),
    quality: row.quality_json ? parseJson(row.quality_json) : null,
    created_at: row.created_at,
  }));
}

export async function getWorkflowMetrics(scope: DataScope): Promise<WorkflowMetrics> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<WorkflowMetrics[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft,
      COUNT(*) FILTER (WHERE status = 'Review')::int AS review,
      COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
      COUNT(*) FILTER (WHERE status = 'Exported')::int AS exported,
      COUNT(*) FILTER (
        WHERE COALESCE(jsonb_array_length(result_json->'policy_validation'->'errors'), 0) > 0
      )::int AS with_errors,
      COUNT(*) FILTER (
        WHERE COALESCE(jsonb_array_length(result_json->'content_quality'->'unused_facts'), 0) > 0
      )::int AS missing_facts
    FROM listings
    WHERE team_id = ${scope.teamId}
  `;
  return rows[0] || {
    total: 0,
    draft: 0,
    review: 0,
    approved: 0,
    exported: 0,
    with_errors: 0,
    missing_facts: 0,
  };
}

export async function listBrandProfiles(scope: DataScope): Promise<BrandProfile[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<BrandProfile[]>`
    SELECT id::text, name, guidelines, created_at::text, updated_at::text
    FROM brand_profiles
    WHERE team_id = ${scope.teamId}
    ORDER BY name ASC
  `;
  return [...rows];
}

export async function getBrandProfile(scope: DataScope, id: string): Promise<BrandProfile | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<BrandProfile[]>`
    SELECT id::text, name, guidelines, created_at::text, updated_at::text
    FROM brand_profiles
    WHERE id = ${id} AND team_id = ${scope.teamId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function saveBrandProfile(scope: DataScope, name: string, guidelines: string): Promise<BrandProfile> {
  await ensureSchema();
  const sql = getDatabase();
  const id = crypto.randomUUID();
  const rows = await sql<BrandProfile[]>`
    INSERT INTO brand_profiles (id, team_id, name, guidelines)
    VALUES (${id}, ${scope.teamId}, ${name}, ${guidelines})
    ON CONFLICT (team_id, name) DO UPDATE
    SET guidelines = EXCLUDED.guidelines, updated_at = NOW()
    RETURNING id::text, name, guidelines, created_at::text, updated_at::text
  `;
  await recordAuditEvent(scope, "brand.saved", "brand_profile", rows[0].id);
  return rows[0];
}

export async function deleteBrandProfile(scope: DataScope, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql`
    DELETE FROM brand_profiles
    WHERE id = ${id} AND team_id = ${scope.teamId}
    RETURNING id
  `;
  if (deleted.length > 0) {
    await recordAuditEvent(scope, "brand.deleted", "brand_profile", id);
    return true;
  }
  return false;
}

export async function listAmazonShops(scope: DataScope): Promise<AmazonShopSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<AmazonShopSummary[]>`
    SELECT
      shop.id::text,
      shop.name,
      shop.seller_id,
      shop.contributor_id,
      shop.is_unassigned,
      COUNT(template.id)::int AS template_count,
      shop.created_at::text,
      shop.updated_at::text
    FROM amazon_shops AS shop
    LEFT JOIN listing_templates AS template
      ON template.team_id = shop.team_id AND template.shop_id = shop.id
    WHERE shop.team_id = ${scope.teamId}
    GROUP BY shop.id
    ORDER BY shop.is_unassigned ASC, shop.name ASC
  `;
  return [...rows];
}

export async function getAmazonShop(scope: DataScope, id: string): Promise<AmazonShopSummary | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<AmazonShopSummary[]>`
    SELECT
      shop.id::text,
      shop.name,
      shop.seller_id,
      shop.contributor_id,
      shop.is_unassigned,
      COUNT(template.id)::int AS template_count,
      shop.created_at::text,
      shop.updated_at::text
    FROM amazon_shops AS shop
    LEFT JOIN listing_templates AS template
      ON template.team_id = shop.team_id AND template.shop_id = shop.id
    WHERE shop.team_id = ${scope.teamId} AND shop.id = ${id}
    GROUP BY shop.id
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function saveAmazonShop(
  scope: DataScope,
  input: { name: string; sellerId?: string; contributorId?: string },
): Promise<AmazonShopSummary> {
  await ensureSchema();
  const sql = getDatabase();
  const id = crypto.randomUUID();
  const rows = await sql<AmazonShopSummary[]>`
    WITH saved AS (
      INSERT INTO amazon_shops (id, team_id, name, seller_id, contributor_id)
      VALUES (${id}, ${scope.teamId}, ${input.name}, ${input.sellerId || ""}, ${input.contributorId || ""})
      ON CONFLICT (team_id, LOWER(name)) DO UPDATE SET
        seller_id = EXCLUDED.seller_id,
        contributor_id = CASE
          WHEN EXCLUDED.contributor_id <> '' THEN EXCLUDED.contributor_id
          ELSE amazon_shops.contributor_id
        END,
        updated_at = NOW()
      RETURNING id, name, seller_id, contributor_id, is_unassigned, created_at, updated_at
    )
    SELECT
      saved.id::text,
      saved.name,
      saved.seller_id,
      saved.contributor_id,
      saved.is_unassigned,
      0::int AS template_count,
      saved.created_at::text,
      saved.updated_at::text
    FROM saved
  `;
  await recordAuditEvent(scope, "amazon_shop.saved", "amazon_shop", rows[0].id, {
    name: rows[0].name,
  });
  return rows[0];
}

export async function resolveAmazonShopFromTemplate(
  scope: DataScope,
  input: { contributorId: string; shopKey: string; brandName: string },
): Promise<AmazonShopSummary> {
  await ensureSchema();
  const sql = getDatabase();
  const contributorId = input.contributorId.trim();
  const shopKey = input.shopKey.trim();
  const brandName = input.brandName.trim();
  if (!contributorId) throw new Error("File không chứa mã nhận diện shop Amazon (contributorId).");
  if (!brandName) throw new Error("Chưa xác định Brand đang nhận template.");

  const matches = await sql<AmazonShopSummary[]>`
    SELECT shop.id::text, shop.name, shop.seller_id, shop.contributor_id,
      shop.is_unassigned, COUNT(template.id)::int AS template_count,
      shop.created_at::text, shop.updated_at::text
    FROM amazon_shops AS shop
    LEFT JOIN listing_templates AS template
      ON template.team_id = shop.team_id AND template.shop_id = shop.id
    WHERE shop.team_id = ${scope.teamId}
      AND shop.is_unassigned = FALSE
      AND (
        LOWER(shop.contributor_id) = LOWER(${contributorId})
        OR (shop.seller_id <> '' AND LOWER(shop.seller_id) IN (LOWER(${contributorId}), LOWER(${shopKey})))
      )
    GROUP BY shop.id
    LIMIT 1
  `;
  if (matches[0]) {
    if (matches[0].name.localeCompare(brandName, undefined, { sensitivity: "accent" }) !== 0) {
      const updated = await sql<AmazonShopSummary[]>`
        UPDATE amazon_shops
        SET name = ${brandName}, updated_at = NOW()
        WHERE team_id = ${scope.teamId} AND id = ${matches[0].id}
        RETURNING id::text, name, seller_id, contributor_id, is_unassigned,
          ${matches[0].template_count}::int AS template_count, created_at::text, updated_at::text
      `;
      return updated[0] || matches[0];
    }
    return matches[0];
  }

  const brandAccounts = await sql<AmazonShopSummary[]>`
    SELECT shop.id::text, shop.name, shop.seller_id, shop.contributor_id,
      shop.is_unassigned, COUNT(template.id)::int AS template_count,
      shop.created_at::text, shop.updated_at::text
    FROM amazon_shops AS shop
    LEFT JOIN listing_templates AS template
      ON template.team_id = shop.team_id AND template.shop_id = shop.id
    WHERE shop.team_id = ${scope.teamId}
      AND shop.is_unassigned = FALSE
      AND LOWER(shop.name) = LOWER(${brandName})
    GROUP BY shop.id
    ORDER BY shop.created_at ASC
  `;

  if (brandAccounts[0]) {
    const bound = await sql<AmazonShopSummary[]>`
      UPDATE amazon_shops
      SET contributor_id = ${contributorId},
          seller_id = CASE WHEN ${shopKey} <> '' THEN ${shopKey} ELSE seller_id END,
          updated_at = NOW()
      WHERE team_id = ${scope.teamId} AND id = ${brandAccounts[0].id}
      RETURNING id::text, name, seller_id, contributor_id, is_unassigned,
        ${brandAccounts[0].template_count}::int AS template_count, created_at::text, updated_at::text
    `;
    if (bound[0]) return bound[0];
  }

  return saveAmazonShop(scope, { name: brandName, sellerId: shopKey, contributorId });
}

export async function deleteAmazonShop(scope: DataScope, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql<{ id: string }[]>`
    DELETE FROM amazon_shops AS shop
    WHERE shop.id = ${id}
      AND shop.team_id = ${scope.teamId}
      AND shop.is_unassigned = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM listing_templates AS template
        WHERE template.team_id = shop.team_id AND template.shop_id = shop.id
      )
    RETURNING shop.id::text
  `;
  if (!deleted.length) return false;
  await recordAuditEvent(scope, "amazon_shop.deleted", "amazon_shop", id);
  return true;
}

interface ListingTemplateRow extends ListingTemplateSummary {
  metadata_json: ListingTemplateMetadata | string;
  workbook_bytes?: Buffer | null;
  workbook_object_key?: string | null;
}

function toListingTemplateSummary(row: ListingTemplateRow): ListingTemplateSummary {
  const metadata = parseJson(row.metadata_json) as ListingTemplateMetadata;
  const isBlank = Boolean(metadata?.is_blank);
  const isExplicitNotReady = metadata?.is_ready === false;
  const hasParentChild = Boolean(metadata?.source_parent_row && metadata?.source_child_row);
  const isReady = !isBlank && !isExplicitNotReady && hasParentChild;

  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name,
    shop_is_unassigned: row.shop_is_unassigned,
    brand_profile_id: row.brand_profile_id,
    brand_name: row.brand_name,
    phoi_name: row.phoi_name,
    phoi_key: row.phoi_key,
    source_template_id: row.source_template_id,
    is_auto_mapped: row.is_auto_mapped,
    is_ready: isReady,
    name: row.name,
    original_filename: row.original_filename,
    file_extension: row.file_extension,
    product_type: row.product_type,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listListingTemplates(scope: DataScope): Promise<ListingTemplateSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingTemplateRow[]>`
    SELECT template.id::text, template.shop_id::text, shop.name AS shop_name,
      shop.is_unassigned AS shop_is_unassigned, template.brand_profile_id::text,
      template.brand_name, template.phoi_name, template.phoi_key,
      template.source_template_id::text, template.is_auto_mapped,
      template.name, template.original_filename,
      template.file_extension, template.product_type, template.metadata_json,
      template.created_at::text, template.updated_at::text
    FROM listing_templates AS template
    JOIN amazon_shops AS shop
      ON shop.id = template.shop_id AND shop.team_id = template.team_id
    WHERE template.team_id = ${scope.teamId}
    ORDER BY shop.is_unassigned ASC, shop.name ASC, template.name ASC
  `;
  return rows.map(toListingTemplateSummary);
}

export async function getListingTemplate(scope: DataScope, id: string) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingTemplateRow[]>`
    SELECT template.id::text, template.shop_id::text, shop.name AS shop_name,
      shop.is_unassigned AS shop_is_unassigned, template.brand_profile_id::text,
      template.brand_name, template.phoi_name, template.phoi_key,
      template.source_template_id::text, template.is_auto_mapped,
      template.name, template.original_filename,
      template.file_extension, template.product_type, template.metadata_json,
      template.workbook_bytes, template.workbook_object_key,
      template.created_at::text, template.updated_at::text
    FROM listing_templates AS template
    JOIN amazon_shops AS shop
      ON shop.id = template.shop_id AND shop.team_id = template.team_id
    WHERE template.id = ${id} AND template.team_id = ${scope.teamId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const workbook = await resolveStoredBytes(
    rows[0].workbook_object_key || null,
    rows[0].workbook_bytes || null,
    `Workbook for template ${id}`,
  );
  return { ...toListingTemplateSummary(rows[0]), workbook };
}

export async function saveListingTemplate(
  scope: DataScope,
  input: {
    shopId: string;
    brandProfileId?: string | null;
    brandName: string;
    phoiName: string;
    phoiKey: string;
    sourceTemplateId?: string | null;
    isAutoMapped?: boolean;
    name: string;
    originalFilename: string;
    fileExtension: string;
    productType: string;
    metadata: ListingTemplateMetadata;
    workbook: Buffer;
  },
) {
  await ensureSchema();
  const sql = getDatabase();
  const id = crypto.randomUUID();
  const shop = await getAmazonShop(scope, input.shopId);
  if (!shop || shop.is_unassigned) throw new Error("Shop Amazon đã chọn không hợp lệ.");
  const useR2 = objectStorageDriver() === "r2";
  const keepDatabaseBytes = !useR2 || retainDatabaseObjectBytes();
  const sha256 = createHash("sha256").update(input.workbook).digest("hex");
  const objectKey = useR2
    ? listingTemplateObjectKey({
        prefix: r2KeyPrefix(),
        teamId: scope.teamId,
        templateName: input.name,
        fileExtension: input.fileExtension,
        bytes: input.workbook,
        objectId: id,
      })
    : null;
  const oldRows = await sql<{ workbook_object_key: string | null }[]>`
    SELECT workbook_object_key
    FROM listing_templates
    WHERE team_id = ${scope.teamId} AND shop_id = ${input.shopId}
      AND LOWER(brand_name) = LOWER(${input.brandName})
      AND LOWER(phoi_key) = LOWER(${input.phoiKey})
    LIMIT 1
  `;
  const uploadedKeys = useR2
    ? await uploadObjectsAtomically([
        {
          key: objectKey!,
          bytes: input.workbook,
          contentType:
            input.fileExtension.toLowerCase() === ".xlsm"
              ? "application/vnd.ms-excel.sheet.macroEnabled.12"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sha256,
          metadata: { kind: "listing-template" },
        },
      ])
    : [];
  let rows: ListingTemplateRow[];
  try {
    rows = await sql<ListingTemplateRow[]>`
      WITH saved AS (
        INSERT INTO listing_templates (
          id, team_id, shop_id, brand_profile_id, brand_name, phoi_name, phoi_key,
          source_template_id, is_auto_mapped, name, original_filename, file_extension, product_type,
          metadata_json, workbook_bytes, workbook_object_key, workbook_byte_size
        ) VALUES (
          ${id}, ${scope.teamId}, ${input.shopId}, ${input.brandProfileId || null},
          ${input.brandName}, ${input.phoiName}, ${input.phoiKey},
          ${input.sourceTemplateId || null}, ${input.isAutoMapped || false},
          ${input.name}, ${input.originalFilename},
          ${input.fileExtension}, ${input.productType}, ${sql.json(toJson(input.metadata))},
          ${keepDatabaseBytes ? input.workbook : null}, ${objectKey}, ${input.workbook.byteLength}
        )
        ON CONFLICT (team_id, shop_id, LOWER(brand_name), LOWER(phoi_key)) DO UPDATE SET
          brand_profile_id = EXCLUDED.brand_profile_id,
          phoi_name = EXCLUDED.phoi_name,
          source_template_id = EXCLUDED.source_template_id,
          is_auto_mapped = EXCLUDED.is_auto_mapped,
          name = EXCLUDED.name,
          original_filename = EXCLUDED.original_filename,
          file_extension = EXCLUDED.file_extension,
          product_type = EXCLUDED.product_type,
          metadata_json = EXCLUDED.metadata_json,
          workbook_bytes = EXCLUDED.workbook_bytes,
          workbook_object_key = EXCLUDED.workbook_object_key,
          workbook_byte_size = EXCLUDED.workbook_byte_size,
          updated_at = NOW()
        RETURNING id, shop_id, brand_profile_id, brand_name, phoi_name, phoi_key,
          source_template_id, is_auto_mapped, name, original_filename, file_extension, product_type,
          metadata_json, created_at, updated_at
      )
      SELECT saved.id::text, saved.shop_id::text, ${shop.name} AS shop_name,
        FALSE AS shop_is_unassigned, saved.brand_profile_id::text, saved.brand_name,
        saved.phoi_name, saved.phoi_key, saved.source_template_id::text, saved.is_auto_mapped,
        saved.name, saved.original_filename,
        saved.file_extension, saved.product_type, saved.metadata_json,
        saved.created_at::text, saved.updated_at::text
      FROM saved
    `;
  } catch (error) {
    await deleteObjectKeysBestEffort(uploadedKeys);
    throw error;
  }
  if (oldRows[0]?.workbook_object_key !== objectKey) {
    await deleteObjectKeysBestEffort([oldRows[0]?.workbook_object_key || null]);
  }
  await recordAuditEvent(scope, "template.saved", "listing_template", rows[0].id, {
    filename: input.originalFilename,
    columns: input.metadata.column_count,
  });
  return toListingTemplateSummary(rows[0]);
}

export async function moveListingTemplateToShop(
  scope: DataScope,
  templateId: string,
  shopId: string,
): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const moved = await sql<{ id: string }[]>`
    UPDATE listing_templates AS template
    SET shop_id = shop.id, updated_at = NOW()
    FROM amazon_shops AS shop
    WHERE template.id = ${templateId}
      AND template.team_id = ${scope.teamId}
      AND shop.id = ${shopId}
      AND shop.team_id = ${scope.teamId}
      AND shop.is_unassigned = FALSE
    RETURNING template.id::text
  `;
  if (!moved.length) return false;
  await recordAuditEvent(scope, "template.shop_changed", "listing_template", templateId, {
    shop_id: shopId,
  });
  return true;
}

export async function deleteListingTemplate(scope: DataScope, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql<{ id: string; workbook_object_key: string | null }[]>`
    WITH target AS (
      SELECT id, shop_id, phoi_key
      FROM listing_templates
      WHERE id = ${id} AND team_id = ${scope.teamId}
    )
    DELETE FROM listing_templates AS template
    USING target
    WHERE template.team_id = ${scope.teamId}
      AND (
        template.id = target.id
        OR (
          template.shop_id = target.shop_id
          AND template.phoi_key = target.phoi_key
          AND template.is_auto_mapped = TRUE
        )
      )
    RETURNING template.id::text, template.workbook_object_key
  `;
  if (deleted.length > 0) {
    await deleteObjectKeysBestEffort(deleted.map((row) => row.workbook_object_key));
    await recordAuditEvent(scope, "template.deleted", "listing_template", id);
    return true;
  }
  return false;
}

interface SharedMockupPresetRow {
  id: string;
  label: string;
  icon: string;
  is_system: boolean;
  contents_json: MockupContentItem[] | string;
  revision: number;
  updated_at: string;
  updated_by: string;
}

function toSharedMockupPreset(
  row: SharedMockupPresetRow,
): ProductCategoryPreset {
  return {
    id: row.id,
    label: row.label,
    icon: row.icon,
    isSystem: row.is_system,
    contents: parseJson(row.contents_json),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function listSharedMockupPresets(
  scope: DataScope,
): Promise<ProductCategoryPreset[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<SharedMockupPresetRow[]>`
    SELECT preset_id AS id, label, icon, is_system, contents_json,
      revision::int, updated_at::text, updated_by
    FROM shared_mockup_presets
    WHERE team_id = ${scope.teamId}
    ORDER BY created_at ASC, preset_id ASC
  `;
  return rows.map(toSharedMockupPreset);
}

export async function saveSharedMockupPreset(
  scope: DataScope,
  preset: ProductCategoryPreset,
): Promise<ProductCategoryPreset> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<SharedMockupPresetRow[]>`
    INSERT INTO shared_mockup_presets (
      team_id, preset_id, label, icon, is_system, contents_json, updated_by
    ) VALUES (
      ${scope.teamId}, ${preset.id}, ${preset.label}, ${preset.icon || "📦"},
      ${Boolean(preset.isSystem)}, ${sql.json(toJson(preset.contents))},
      ${scope.actorId}
    )
    ON CONFLICT (team_id, preset_id) DO UPDATE SET
      label = EXCLUDED.label,
      icon = EXCLUDED.icon,
      is_system = EXCLUDED.is_system,
      contents_json = EXCLUDED.contents_json,
      revision = shared_mockup_presets.revision + 1,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING preset_id AS id, label, icon, is_system, contents_json,
      revision::int, updated_at::text, updated_by
  `;
  await recordAuditEvent(
    scope,
    "mockup_preset.saved",
    "mockup_preset",
    preset.id,
    { revision: rows[0].revision },
  );
  return toSharedMockupPreset(rows[0]);
}

export async function importLegacySharedMockupPresetsOnce(
  scope: DataScope,
  presets: readonly ProductCategoryPreset[],
): Promise<void> {
  await ensureSchema();
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const claimed = await transaction`
      INSERT INTO shared_mockup_preset_state (team_id)
      VALUES (${scope.teamId})
      ON CONFLICT (team_id) DO NOTHING
      RETURNING team_id
    `;
    if (claimed.length === 0) return;
    for (const preset of presets) {
      await transaction`
        INSERT INTO shared_mockup_presets (
          team_id, preset_id, label, icon, is_system, contents_json, updated_by
        ) VALUES (
          ${scope.teamId}, ${preset.id}, ${preset.label}, ${preset.icon || "📦"},
          ${Boolean(preset.isSystem)}, ${transaction.json(toJson(preset.contents))},
          ${scope.actorId}
        )
        ON CONFLICT (team_id, preset_id) DO NOTHING
      `;
    }
  });
}

export async function deleteSharedMockupPreset(
  scope: DataScope,
  presetId: string,
): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql`
    DELETE FROM shared_mockup_presets
    WHERE team_id = ${scope.teamId} AND preset_id = ${presetId}
    RETURNING preset_id
  `;
  if (deleted.length > 0) {
    await recordAuditEvent(
      scope,
      "mockup_preset.deleted",
      "mockup_preset",
      presetId,
    );
    return true;
  }
  return false;
}

export async function consumeRateLimit(
  scope: DataScope,
  name: string,
  limit: number,
  windowSeconds: number,
) {
  await ensureSchema();
  const sql = getDatabase();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSeconds);
  await sql`
    DELETE FROM api_rate_limits
    WHERE team_id = ${scope.teamId} AND scope = ${name} AND bucket < ${bucket - 2}
  `;
  const rows = await sql<{ request_count: number }[]>`
    INSERT INTO api_rate_limits (team_id, scope, bucket, request_count)
    VALUES (${scope.teamId}, ${name}, ${bucket}, 1)
    ON CONFLICT (team_id, scope, bucket) DO UPDATE
    SET request_count = api_rate_limits.request_count + 1, updated_at = NOW()
    RETURNING request_count
  `;
  return {
    allowed: rows[0].request_count <= limit,
    remaining: Math.max(0, limit - rows[0].request_count),
    retryAfterSeconds: Math.max(1, (bucket + 1) * windowSeconds - nowSeconds),
  };
}

export async function claimIdempotency(
  scope: DataScope,
  endpoint: string,
  key: string,
) {
  await ensureSchema();
  const sql = getDatabase();
  const retentionHours = Math.min(168, Math.max(1, Number(process.env.IDEMPOTENCY_RETENTION_HOURS || 24)));
  await sql`
    DELETE FROM api_idempotency
    WHERE team_id = ${scope.teamId}
      AND created_at < NOW() - (${retentionHours} * INTERVAL '1 hour')
  `;
  const inserted = await sql<{ idempotency_key: string }[]>`
    INSERT INTO api_idempotency (team_id, endpoint, idempotency_key)
    VALUES (${scope.teamId}, ${endpoint}, ${key})
    ON CONFLICT DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length) return { state: "claimed" as const };
  const existing = await sql<{ response_json: Record<string, unknown> | string | null; status_code: number | null }[]>`
    SELECT response_json, status_code
    FROM api_idempotency
    WHERE team_id = ${scope.teamId} AND endpoint = ${endpoint} AND idempotency_key = ${key}
    LIMIT 1
  `;
  if (!existing[0]?.response_json) return { state: "pending" as const };
  return {
    state: "complete" as const,
    response: parseJson(existing[0].response_json),
    statusCode: existing[0].status_code || 200,
  };
}

export async function completeIdempotency(
  scope: DataScope,
  endpoint: string,
  key: string,
  response: Record<string, unknown>,
  statusCode: number,
) {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    UPDATE api_idempotency
    SET response_json = ${sql.json(toJson(response))}, status_code = ${statusCode}
    WHERE team_id = ${scope.teamId} AND endpoint = ${endpoint} AND idempotency_key = ${key}
  `;
}

export async function releaseIdempotency(scope: DataScope, endpoint: string, key: string) {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    DELETE FROM api_idempotency
    WHERE team_id = ${scope.teamId} AND endpoint = ${endpoint} AND idempotency_key = ${key}
      AND response_json IS NULL
  `;
}

export async function recordAuditEvent(
  scope: DataScope,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    INSERT INTO audit_events (team_id, actor_id, action, resource_type, resource_id, metadata_json)
    VALUES (
      ${scope.teamId}, ${scope.actorId}, ${action}, ${resourceType}, ${resourceId},
      ${sql.json(toJson(metadata))}
    )
  `;
}

export async function getAppSetting<T = Record<string, unknown>>(key: string): Promise<T | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<{ value_json: string }[]>`
    SELECT value AS value_json FROM app_settings WHERE key = ${key} LIMIT 1
  `;
  if (!rows.length || !rows[0].value_json) return null;
  return parseJson(rows[0].value_json) as T;
}

export async function setAppSetting(key: string, value: Record<string, unknown> | unknown[]) {
  await ensureSchema();
  const sql = getDatabase();
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${sql.json(toJson(value as Record<string, unknown>))}, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
  `;
}
