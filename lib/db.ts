import "server-only";

import postgres from "postgres";
import type {
  BrandProfile,
  ListingContent,
  ListingInput,
  ListingRevision,
  ListingResult,
  ListingStatus,
  ListingSummary,
  StoredListing,
  WorkflowMetrics,
} from "@/lib/types";

type PostgresClient = ReturnType<typeof postgres>;

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
    globalForDatabase.listingPostgresSchema = sql
      .unsafe(`
        CREATE TABLE IF NOT EXISTS listings (
          id UUID PRIMARY KEY,
          internal_name TEXT NOT NULL,
          product_type TEXT NOT NULL,
          marketplace TEXT NOT NULL,
          status TEXT NOT NULL,
          model_used TEXT NOT NULL,
          input_json JSONB NOT NULL,
          result_json JSONB NOT NULL,
          current_listing_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS listing_revisions (
          id BIGSERIAL PRIMARY KEY,
          listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          instruction TEXT NOT NULL DEFAULT '',
          content_json JSONB NOT NULL,
          quality_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE listing_revisions
          ADD COLUMN IF NOT EXISTS instruction TEXT NOT NULL DEFAULT '';

        ALTER TABLE listing_revisions
          ADD COLUMN IF NOT EXISTS quality_json JSONB;

        CREATE TABLE IF NOT EXISTS brand_profiles (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          guidelines TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        UPDATE listings SET status = 'Draft' WHERE status = 'Generated';
        UPDATE listings SET status = 'Review' WHERE status IN ('Needs Review', 'Rejected');

        CREATE INDEX IF NOT EXISTS listing_updated_at_idx
          ON listings(updated_at DESC);

        CREATE INDEX IF NOT EXISTS listing_revisions_listing_id_idx
          ON listing_revisions(listing_id, created_at DESC);
      `)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalForDatabase.listingPostgresSchema = undefined;
        throw new Error(
          "Cannot connect to PostgreSQL. Start it with `npm run db:start` and try again.",
          { cause: error },
        );
      });
  }

  await globalForDatabase.listingPostgresSchema;
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

export async function saveGeneratedListing(input: ListingInput, result: ListingResult) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Draft"
    : "Review";

  await sql`
    INSERT INTO listings (
      id, internal_name, product_type, marketplace, status, model_used,
      input_json, result_json, current_listing_json
    ) VALUES (
      ${result.request_id},
      ${input.internal_name},
      ${input.product_type},
      ${input.marketplace},
      ${status},
      ${result.model_used},
      ${sql.json(toJson(input))},
      ${sql.json(toJson(result))},
      ${sql.json(toJson(result.listing))}
    )
  `;
  await addRevision(result.request_id, "generated", result.listing, result);
  return getListing(result.request_id);
}

export async function listListings(limit = 30): Promise<ListingSummary[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<ListingSummary[]>`
    SELECT
      id::text,
      internal_name,
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
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return [...rows];
}

export async function getListing(id: string): Promise<StoredListing | null> {
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
    WHERE id = ${id}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const listing = toStoredListing(rows[0]);
  listing.revisions = await listRevisions(id);
  return listing;
}

export async function updateListingContent(
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
          input_json = ${sql.json(toJson(options.input))},
          result_json = ${sql.json(toJson(result))},
          current_listing_json = ${sql.json(toJson(listing))},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id::text
      `
    : await sql<{ id: string }[]>`
        UPDATE listings
        SET
          status = ${status},
          result_json = ${sql.json(toJson(result))},
          current_listing_json = ${sql.json(toJson(listing))},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id::text
      `;
  if (!changed.length) return null;
  await addRevision(
    id,
    options.action || "manual_edit",
    listing,
    result,
    options.instruction,
  );
  return getListing(id);
}

export async function setListingStatus(id: string, status: ListingStatus) {
  await ensureSchema();
  const sql = getDatabase();
  const changed = await sql<
    { id: string; current_listing_json: ListingContent | string; result_json: ListingResult | string }[]
  >`
    UPDATE listings
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id::text, current_listing_json, result_json
  `;
  if (!changed.length) return null;
  await addRevision(
    id,
    status === "Review" ? "submitted_for_review" : status.toLowerCase(),
    parseJson(changed[0].current_listing_json),
    parseJson(changed[0].result_json),
  );
  return getListing(id);
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
  id: string,
  action: string,
  content: ListingContent,
  result: ListingResult,
  instruction = "",
) {
  const sql = getDatabase();
  await sql`
    INSERT INTO listing_revisions (listing_id, action, instruction, content_json, quality_json)
    VALUES (
      ${id},
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

export async function listRevisions(id: string, limit = 30): Promise<ListingRevision[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<RevisionRow[]>`
    SELECT * FROM (
      SELECT id::text, action, instruction, content_json, quality_json, created_at::text
      FROM listing_revisions
      WHERE listing_id = ${id}
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

export async function getWorkflowMetrics(): Promise<WorkflowMetrics> {
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

export async function listBrandProfiles(): Promise<BrandProfile[]> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<BrandProfile[]>`
    SELECT id::text, name, guidelines, created_at::text, updated_at::text
    FROM brand_profiles
    ORDER BY name ASC
  `;
  return [...rows];
}

export async function getBrandProfile(id: string): Promise<BrandProfile | null> {
  await ensureSchema();
  const sql = getDatabase();
  const rows = await sql<BrandProfile[]>`
    SELECT id::text, name, guidelines, created_at::text, updated_at::text
    FROM brand_profiles
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function saveBrandProfile(name: string, guidelines: string): Promise<BrandProfile> {
  await ensureSchema();
  const sql = getDatabase();
  const id = crypto.randomUUID();
  const rows = await sql<BrandProfile[]>`
    INSERT INTO brand_profiles (id, name, guidelines)
    VALUES (${id}, ${name}, ${guidelines})
    ON CONFLICT (name) DO UPDATE
    SET guidelines = EXCLUDED.guidelines, updated_at = NOW()
    RETURNING id::text, name, guidelines, created_at::text, updated_at::text
  `;
  return rows[0];
}
