import { createHash } from "node:crypto";
import postgres from "postgres";
import {
  deleteStoredObjects,
  headStoredObject,
  putStoredObject,
} from "../lib/object-storage";
import {
  listingImageObjectKey,
  listingTemplateObjectKey,
  readObjectStorageConfig,
  trelloPreviewObjectKey,
} from "../lib/object-storage-core";

type Mode = "backfill" | "verify" | "cleanup";
type SqlClient = ReturnType<typeof postgres>;
const BACKFILL_BATCH_SIZE = 50;

function requestedMode(): Mode {
  const mode = process.argv[2] || "backfill";
  if (mode !== "backfill" && mode !== "verify" && mode !== "cleanup") {
    throw new Error(
      "Usage: npm run storage:migrate -- [backfill|verify|cleanup] [--confirm-delete-database-bytes]",
    );
  }
  return mode;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function uploadWithRollback(
  objects: readonly {
    key: string;
    bytes: Buffer;
    contentType: string;
    sha256: string;
    metadata: Record<string, string>;
  }[],
  commit: () => Promise<void>,
) {
  const uploaded: string[] = [];
  try {
    for (const object of objects) {
      await putStoredObject(object);
      uploaded.push(object.key);
    }
    await commit();
  } catch (error) {
    await deleteStoredObjects(uploaded).catch((cleanupError) => {
      console.warn("Could not roll back R2 objects:", cleanupError);
    });
    throw error;
  }
}

async function backfillListingImages(
  sql: SqlClient,
  prefix: string,
) {
  const rows = await sql<{
    id: string;
    listing_id: string;
    team_id: string;
    image_index: number;
    mime_type: string;
    image_bytes: Buffer | null;
    original_object_key: string | null;
    ai_mime_type: string | null;
    ai_image_bytes: Buffer | null;
    ai_object_key: string | null;
    preview_mime_type: string | null;
    preview_image_bytes: Buffer | null;
    preview_object_key: string | null;
  }[]>`
    SELECT id::text, listing_id::text, team_id, image_index, mime_type,
      image_bytes, original_object_key, ai_mime_type, ai_image_bytes,
      ai_object_key, preview_mime_type, preview_image_bytes, preview_object_key
    FROM listing_images
    WHERE (image_bytes IS NOT NULL AND original_object_key IS NULL)
       OR (ai_image_bytes IS NOT NULL AND ai_object_key IS NULL)
       OR (preview_image_bytes IS NOT NULL AND preview_object_key IS NULL)
    ORDER BY created_at ASC, id ASC
    LIMIT ${BACKFILL_BATCH_SIZE}
  `;

  let migrated = 0;
  for (const row of rows) {
    const objects: {
      key: string;
      bytes: Buffer;
      contentType: string;
      sha256: string;
      metadata: Record<string, string>;
    }[] = [];
    let originalKey = row.original_object_key;
    let aiKey = row.ai_object_key;
    let previewKey = row.preview_object_key;
    if (row.image_bytes && !originalKey) {
      originalKey = listingImageObjectKey({
        prefix,
        teamId: row.team_id,
        listingId: row.listing_id,
        imageIndex: row.image_index,
        variant: "original",
        mimeType: row.mime_type,
        bytes: row.image_bytes,
      });
      objects.push({
        key: originalKey,
        bytes: row.image_bytes,
        contentType: row.mime_type,
        sha256: sha256(row.image_bytes),
        metadata: { kind: "listing-image", variant: "original" },
      });
    }
    if (row.ai_image_bytes && !aiKey) {
      const mimeType = row.ai_mime_type || row.mime_type;
      aiKey = listingImageObjectKey({
        prefix,
        teamId: row.team_id,
        listingId: row.listing_id,
        imageIndex: row.image_index,
        variant: "ai",
        mimeType,
        bytes: row.ai_image_bytes,
      });
      objects.push({
        key: aiKey,
        bytes: row.ai_image_bytes,
        contentType: mimeType,
        sha256: sha256(row.ai_image_bytes),
        metadata: { kind: "listing-image", variant: "ai" },
      });
    }
    if (row.preview_image_bytes && !previewKey) {
      const mimeType = row.preview_mime_type || row.mime_type;
      previewKey = listingImageObjectKey({
        prefix,
        teamId: row.team_id,
        listingId: row.listing_id,
        imageIndex: row.image_index,
        variant: "preview",
        mimeType,
        bytes: row.preview_image_bytes,
      });
      objects.push({
        key: previewKey,
        bytes: row.preview_image_bytes,
        contentType: mimeType,
        sha256: sha256(row.preview_image_bytes),
        metadata: { kind: "listing-image", variant: "preview" },
      });
    }
    await uploadWithRollback(objects, async () => {
      await sql`
        UPDATE listing_images
        SET original_object_key = ${originalKey},
          original_byte_size = COALESCE(original_byte_size, OCTET_LENGTH(image_bytes)),
          ai_object_key = ${aiKey},
          ai_byte_size = COALESCE(ai_byte_size, OCTET_LENGTH(ai_image_bytes)),
          preview_object_key = ${previewKey},
          preview_byte_size = COALESCE(preview_byte_size, OCTET_LENGTH(preview_image_bytes))
        WHERE id = ${row.id}
      `;
    });
    migrated += 1;
  }
  return migrated;
}

async function backfillTrelloPreviews(sql: SqlClient, prefix: string) {
  const rows = await sql<{
    team_id: string;
    card_id: string;
    attachment_id: string;
    variant: "preview" | "thumbnail";
    mime_type: string;
    image_bytes: Buffer;
    sha256: string;
  }[]>`
    SELECT team_id, card_id, attachment_id, variant, mime_type, image_bytes, sha256
    FROM trello_image_previews
    WHERE image_bytes IS NOT NULL AND object_key IS NULL
    ORDER BY updated_at ASC
    LIMIT ${BACKFILL_BATCH_SIZE}
  `;
  for (const row of rows) {
    const key = trelloPreviewObjectKey({
      prefix,
      teamId: row.team_id,
      cardId: row.card_id,
      attachmentId: row.attachment_id,
      variant: row.variant,
      mimeType: row.mime_type,
      bytes: row.image_bytes,
    });
    await uploadWithRollback(
      [
        {
          key,
          bytes: row.image_bytes,
          contentType: row.mime_type,
          sha256: row.sha256,
          metadata: { kind: "trello-preview", variant: row.variant },
        },
      ],
      async () => {
        await sql`
          UPDATE trello_image_previews
          SET object_key = ${key}, image_byte_size = OCTET_LENGTH(image_bytes)
          WHERE team_id = ${row.team_id} AND card_id = ${row.card_id}
            AND attachment_id = ${row.attachment_id} AND variant = ${row.variant}
        `;
      },
    );
  }
  return rows.length;
}

async function backfillTemplates(sql: SqlClient, prefix: string) {
  const rows = await sql<{
    id: string;
    team_id: string;
    name: string;
    file_extension: string;
    workbook_bytes: Buffer;
  }[]>`
    SELECT id::text, team_id, name, file_extension, workbook_bytes
    FROM listing_templates
    WHERE workbook_bytes IS NOT NULL AND workbook_object_key IS NULL
    ORDER BY updated_at ASC
    LIMIT ${BACKFILL_BATCH_SIZE}
  `;
  for (const row of rows) {
    const key = listingTemplateObjectKey({
      prefix,
      teamId: row.team_id,
      templateName: row.name,
      fileExtension: row.file_extension,
      bytes: row.workbook_bytes,
    });
    const contentType =
      row.file_extension.toLowerCase() === ".xlsm"
        ? "application/vnd.ms-excel.sheet.macroEnabled.12"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await uploadWithRollback(
      [
        {
          key,
          bytes: row.workbook_bytes,
          contentType,
          sha256: sha256(row.workbook_bytes),
          metadata: { kind: "listing-template" },
        },
      ],
      async () => {
        await sql`
          UPDATE listing_templates
          SET workbook_object_key = ${key},
            workbook_byte_size = OCTET_LENGTH(workbook_bytes)
          WHERE id = ${row.id}
        `;
      },
    );
  }
  return rows.length;
}

type VerificationRow = {
  source: string;
  object_key: string;
  expected_size: number;
  expected_sha256: string | null;
};

async function verificationRows(sql: SqlClient) {
  return sql<VerificationRow[]>`
    SELECT 'listing-original:' || id::text AS source,
      original_object_key AS object_key, original_byte_size AS expected_size,
      sha256 AS expected_sha256
    FROM listing_images WHERE original_object_key IS NOT NULL
    UNION ALL
    SELECT 'listing-ai:' || id::text, ai_object_key, ai_byte_size, NULL
    FROM listing_images WHERE ai_object_key IS NOT NULL
    UNION ALL
    SELECT 'listing-preview:' || id::text, preview_object_key, preview_byte_size, NULL
    FROM listing_images WHERE preview_object_key IS NOT NULL
    UNION ALL
    SELECT 'trello:' || card_id || ':' || attachment_id || ':' || variant,
      object_key, image_byte_size, sha256
    FROM trello_image_previews WHERE object_key IS NOT NULL
    UNION ALL
    SELECT 'template:' || id::text, workbook_object_key, workbook_byte_size, NULL
    FROM listing_templates WHERE workbook_object_key IS NOT NULL
    ORDER BY source
  `;
}

async function verify(sql: SqlClient) {
  const gaps = await sql<{ missing: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM listing_images
        WHERE (image_bytes IS NOT NULL AND original_object_key IS NULL)
          OR (ai_image_bytes IS NOT NULL AND ai_object_key IS NULL)
          OR (preview_image_bytes IS NOT NULL AND preview_object_key IS NULL))
      + (SELECT COUNT(*) FROM trello_image_previews
        WHERE image_bytes IS NOT NULL AND object_key IS NULL)
      + (SELECT COUNT(*) FROM listing_templates
        WHERE workbook_bytes IS NOT NULL AND workbook_object_key IS NULL)
    )::int AS missing
  `;
  if (gaps[0]?.missing) {
    throw new Error(
      `${gaps[0].missing} database row(s) still contain bytes without an R2 object key. Run backfill again.`,
    );
  }
  const rows = await verificationRows(sql);
  let failed = 0;
  for (const row of rows) {
    const object = await headStoredObject(row.object_key);
    const sizeMatches = object?.contentLength === row.expected_size;
    const shaMatches =
      !row.expected_sha256 || object?.metadata.sha256 === row.expected_sha256;
    if (!object || !sizeMatches || !shaMatches) {
      failed += 1;
      process.stderr.write(
        `FAILED ${row.source}: exists=${Boolean(object)}, expected_size=${row.expected_size}, actual_size=${
          object?.contentLength ?? "missing"
        }, sha_metadata_match=${shaMatches}\n`,
      );
    }
  }
  process.stdout.write(`Verified ${rows.length - failed}/${rows.length} R2 object references.\n`);
  if (failed) throw new Error(`${failed} R2 object reference(s) failed verification.`);
  return rows.length;
}

async function cleanupDatabaseBytes(sql: SqlClient) {
  if (!process.argv.includes("--confirm-delete-database-bytes")) {
    throw new Error(
      "Cleanup is destructive. Run verify first, then repeat with --confirm-delete-database-bytes.",
    );
  }
  await verify(sql);
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE listing_images SET
        image_bytes = CASE WHEN original_object_key IS NOT NULL THEN NULL ELSE image_bytes END,
        ai_image_bytes = CASE WHEN ai_object_key IS NOT NULL THEN NULL ELSE ai_image_bytes END,
        preview_image_bytes = CASE WHEN preview_object_key IS NOT NULL THEN NULL ELSE preview_image_bytes END
    `;
    await transaction`
      UPDATE trello_image_previews
      SET image_bytes = NULL WHERE object_key IS NOT NULL
    `;
    await transaction`
      UPDATE listing_templates
      SET workbook_bytes = NULL WHERE workbook_object_key IS NOT NULL
    `;
  });
  process.stdout.write(
    "Database binary columns were cleared for verified R2 objects. Run npm run db:maintain during the maintenance window.\n",
  );
}

async function main() {
  const mode = requestedMode();
  const config = readObjectStorageConfig();
  if (config.driver !== "r2") {
    throw new Error("Set OBJECT_STORAGE_DRIVER=r2 before migrating object storage.");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  try {
    const migrations = await sql<{ applied: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM schema_migrations WHERE name = '011_r2_object_storage.sql'
      ) AS applied
    `;
    if (!migrations[0]?.applied) {
      throw new Error("Run npm run db:migrate before migrating object storage.");
    }
    if (mode === "backfill") {
      let listingImages = 0;
      let trelloPreviews = 0;
      let templates = 0;
      while (true) {
        const migrated = await backfillListingImages(sql, config.keyPrefix);
        listingImages += migrated;
        if (migrated < BACKFILL_BATCH_SIZE) break;
      }
      while (true) {
        const migrated = await backfillTrelloPreviews(sql, config.keyPrefix);
        trelloPreviews += migrated;
        if (migrated < BACKFILL_BATCH_SIZE) break;
      }
      while (true) {
        const migrated = await backfillTemplates(sql, config.keyPrefix);
        templates += migrated;
        if (migrated < BACKFILL_BATCH_SIZE) break;
      }
      process.stdout.write(
        `Backfill complete: listing_images=${listingImages}, trello_previews=${trelloPreviews}, templates=${templates}. Database bytes were retained for rollback.\n`,
      );
    } else if (mode === "verify") {
      await verify(sql);
    } else {
      await cleanupDatabaseBytes(sql);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `Object storage migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
