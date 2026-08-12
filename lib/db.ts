import "server-only";

import postgres from "postgres";
import { createHash } from "node:crypto";
import {
  createStoredImageDerivatives,
  IMAGE_DERIVATIVE_VERSION,
} from "@/lib/image-processing";
import type {
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
        WHERE name = '005_image_derivatives.sql'
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

export async function checkDatabaseHealth() {
  await ensureSchema();
  const sql = getDatabase();
  await sql`SELECT 1`;
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

export async function saveGeneratedListing(scope: DataScope, input: ListingInput, result: ListingResult) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Draft"
    : "Review";

  const storedInputBase = result.competitor_profile
    ? { ...input, research: { ...input.research, competitor_profile: result.competitor_profile } }
    : input;
  const images = await Promise.all(input.images.map(async (image, imageIndex) => {
    const derivatives = await createStoredImageDerivatives(image);
    const sha256 = createHash("sha256")
      .update(derivatives.originalBytes)
      .digest("hex");
    return {
      ...image,
      ...derivatives,
      imageIndex,
      sha256,
      id: crypto.randomUUID(),
    };
  }));
  const storedInput: ListingInput = {
    ...storedInputBase,
    images: images.map((image) => ({
      name: image.originalName,
      type: image.originalMimeType,
      data_url: "",
      storage_key: `db:${result.request_id}:${image.imageIndex}`,
      sha256: image.sha256,
      width: image.width || undefined,
      height: image.height || undefined,
      bytes: image.originalBytes.byteLength,
    })),
  };
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO listings (
        id, team_id, internal_name, product_type, marketplace, status, model_used,
        input_json, result_json, current_listing_json
      ) VALUES (
        ${result.request_id}, ${scope.teamId}, ${input.internal_name}, ${input.product_type},
        ${input.marketplace}, ${status}, ${result.model_used}, ${transaction.json(toJson(storedInput))},
        ${transaction.json(toJson(result))}, ${transaction.json(toJson(result.listing))}
      )
    `;
    for (const image of images) {
      await transaction`
        INSERT INTO listing_images (
          id, listing_id, team_id, image_index, name, mime_type, sha256, image_bytes,
          width, height, ai_mime_type, ai_image_bytes, preview_mime_type,
          preview_image_bytes, preview_width, preview_height
        ) VALUES (
          ${image.id}, ${result.request_id}, ${scope.teamId}, ${image.imageIndex},
          ${image.originalName}, ${image.originalMimeType}, ${image.sha256},
          ${image.originalBytes}, ${image.width}, ${image.height},
          ${image.aiMimeType}, ${image.aiBytes}, ${image.previewMimeType},
          ${image.previewBytes}, ${image.previewWidth}, ${image.previewHeight}
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
      OCTET_LENGTH(image_bytes)::int AS byte_size,
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
    image_bytes: Buffer;
  }[]>`
    SELECT
      image_index,
      COALESCE(ai_mime_type, mime_type) AS mime_type,
      COALESCE(ai_image_bytes, image_bytes) AS image_bytes
    FROM listing_images
    WHERE listing_id = ${id} AND team_id = ${scope.teamId}
    ORDER BY image_index ASC
  `;
  const imageMap = new Map(imageRows.map((image) => [image.image_index, image]));
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
    image_bytes: Buffer;
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
      END AS image_bytes
    FROM listing_images
    WHERE listing_id = ${listingId}
      AND team_id = ${scope.teamId}
      AND image_index = ${imageIndex}
    LIMIT 1
  `;
  return rows[0] || null;
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

interface ListingTemplateRow extends ListingTemplateSummary {
  metadata_json: ListingTemplateMetadata | string;
  workbook_bytes?: Buffer;
}

function toListingTemplateSummary(row: ListingTemplateRow): ListingTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    original_filename: row.original_filename,
    file_extension: row.file_extension,
    product_type: row.product_type,
    metadata: parseJson(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listListingTemplates(scope: DataScope): Promise<ListingTemplateSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingTemplateRow[]>`
    SELECT id::text, name, original_filename, file_extension, product_type,
      metadata_json, created_at::text, updated_at::text
    FROM listing_templates
    WHERE team_id = ${scope.teamId}
    ORDER BY name ASC
  `;
  return rows.map(toListingTemplateSummary);
}

export async function getListingTemplate(scope: DataScope, id: string) {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingTemplateRow[]>`
    SELECT id::text, name, original_filename, file_extension, product_type,
      metadata_json, workbook_bytes, created_at::text, updated_at::text
    FROM listing_templates
    WHERE id = ${id} AND team_id = ${scope.teamId}
    LIMIT 1
  `;
  if (!rows[0]?.workbook_bytes) return null;
  return { ...toListingTemplateSummary(rows[0]), workbook: rows[0].workbook_bytes };
}

export async function saveListingTemplate(
  scope: DataScope,
  input: {
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
  const rows = await sql<ListingTemplateRow[]>`
    INSERT INTO listing_templates (
      id, team_id, name, original_filename, file_extension, product_type,
      metadata_json, workbook_bytes
    ) VALUES (
      ${id}, ${scope.teamId}, ${input.name}, ${input.originalFilename}, ${input.fileExtension},
      ${input.productType}, ${sql.json(toJson(input.metadata))}, ${input.workbook}
    )
    ON CONFLICT (team_id, LOWER(name)) DO UPDATE SET
      original_filename = EXCLUDED.original_filename,
      file_extension = EXCLUDED.file_extension,
      product_type = EXCLUDED.product_type,
      metadata_json = EXCLUDED.metadata_json,
      workbook_bytes = EXCLUDED.workbook_bytes,
      updated_at = NOW()
    RETURNING id::text, name, original_filename, file_extension, product_type,
      metadata_json, created_at::text, updated_at::text
  `;
  await recordAuditEvent(scope, "template.saved", "listing_template", rows[0].id, {
    filename: input.originalFilename,
    columns: input.metadata.column_count,
  });
  return toListingTemplateSummary(rows[0]);
}

export async function deleteListingTemplate(scope: DataScope, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getDatabase();
  const deleted = await sql`
    DELETE FROM listing_templates
    WHERE id = ${id} AND team_id = ${scope.teamId}
    RETURNING id
  `;
  if (deleted.length > 0) {
    await recordAuditEvent(scope, "template.deleted", "listing_template", id);
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
