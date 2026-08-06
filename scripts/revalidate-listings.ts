import postgres from "postgres";
import { revalidateStoredListing } from "../lib/listing-analysis";
import type { ListingContent, ListingInput, ListingResult, ListingStatus, StoredListing } from "../lib/types";

interface Row {
  id: string;
  team_id: string;
  status: ListingStatus;
  input_json: ListingInput | string;
  result_json: ListingResult | string;
  current_listing_json: ListingContent | string;
  created_at: string;
  updated_at: string;
}

function parse<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  let reviewed = 0;
  let returnedToReview = 0;
  try {
    const rows = await sql<Row[]>`
      SELECT id::text, team_id, status, input_json, result_json, current_listing_json,
             created_at::text, updated_at::text
      FROM listings
      ORDER BY created_at
    `;
    for (const row of rows) {
      const stored: StoredListing = {
        id: row.id,
        status: row.status,
        input: parse(row.input_json),
        result: parse(row.result_json),
        current_listing: parse(row.current_listing_json),
        revisions: [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const current = revalidateStoredListing(stored);
      const nextStatus: ListingStatus =
        !current.analysis.policy_validation.passed && ["Approved", "Exported"].includes(row.status)
          ? "Review"
          : row.status;
      if (nextStatus !== row.status) returnedToReview += 1;
      await sql.begin(async (transaction) => {
        await transaction`
          UPDATE listings
          SET input_json = ${transaction.json(jsonValue(current.input))},
              result_json = ${transaction.json(jsonValue(current.result))},
              status = ${nextStatus},
              updated_at = NOW()
          WHERE id = ${row.id} AND team_id = ${row.team_id}
        `;
        await transaction`
          INSERT INTO audit_events (
            team_id, actor_id, action, resource_type, resource_id, metadata_json
          ) VALUES (
            ${row.team_id}, 'system', 'listing.revalidated', 'listing', ${row.id},
            ${transaction.json({
              previous_status: row.status,
              next_status: nextStatus,
              policy_version: current.result.metadata.policy_version,
              error_count: current.result.policy_validation.errors.length,
            })}
          )
        `;
      });
      reviewed += 1;
    }
    process.stdout.write(`Revalidated ${reviewed} listing(s); returned ${returnedToReview} to Review.\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
