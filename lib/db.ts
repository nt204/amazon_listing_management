import "server-only";

import postgres from "postgres";
import type {
  ListingContent,
  ListingInput,
  ListingResult,
  ListingStatus,
  ListingSummary,
  StoredListing,
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
          content_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function saveGeneratedListing(input: ListingInput, result: ListingResult) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Generated"
    : "Needs Review";

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
  await addRevision(result.request_id, "generated", result.listing);
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
  return rows[0] ? toStoredListing(rows[0]) : null;
}

export async function updateListingContent(
  id: string,
  listing: ListingContent,
  result: ListingResult,
  action = "edited",
) {
  await ensureSchema();
  const sql = getDatabase();
  const status: ListingStatus = result.policy_validation.passed
    ? "Generated"
    : "Needs Review";
  const changed = await sql<{ id: string }[]>`
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
  await addRevision(id, action, listing);
  return getListing(id);
}

export async function setListingStatus(id: string, status: ListingStatus) {
  await ensureSchema();
  const sql = getDatabase();
  const changed = await sql<{ id: string }[]>`
    UPDATE listings
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id::text
  `;
  if (!changed.length) return null;
  await addRevision(id, status.toLowerCase(), { status });
  return getListing(id);
}

async function addRevision(id: string, action: string, content: unknown) {
  const sql = getDatabase();
  await sql`
    INSERT INTO listing_revisions (listing_id, action, content_json)
    VALUES (${id}, ${action}, ${sql.json(toJson(content))})
  `;
}
