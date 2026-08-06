import postgres from "postgres";
import { generateListing } from "../lib/ai";
import type { ListingInput } from "../lib/types";

interface ListingRow {
  id: string;
  internal_name: string;
  input_json: ListingInput | string;
}

interface ImageRow {
  image_index: number;
  name: string;
  mime_type: ListingInput["images"][number]["type"];
  image_bytes: Buffer;
}

function parse<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const requestedId = process.argv[2]?.trim();
  if (!requestedId) throw new Error("Pass a listing ID to evaluate.");
  const sql = postgres(connectionString, { max: 1 });
  try {
    const listings = await sql<ListingRow[]>`
      SELECT id::text, internal_name, input_json
      FROM listings WHERE id = ${requestedId} LIMIT 1
    `;
    const listing = listings[0];
    if (!listing) throw new Error("Listing not found.");
    const storedInput = parse(listing.input_json);
    const images = await sql<ImageRow[]>`
      SELECT image_index, name, mime_type, image_bytes
      FROM listing_images
      WHERE listing_id = ${listing.id}
      ORDER BY image_index
    `;
    const input: ListingInput = {
      ...storedInput,
      images: images.map((image) => ({
        name: image.name,
        type: image.mime_type,
        data_url: `data:${image.mime_type};base64,${Buffer.from(image.image_bytes).toString("base64")}`,
      })),
    };
    const result = await generateListing(input);
    process.stdout.write(`${JSON.stringify({
      listing_id: listing.id,
      internal_name: listing.internal_name,
      model_used: result.model_used,
      fallback_used: result.fallback_used,
      fallback_reason: result.metadata.fallback_reason,
      processing_time_ms: result.metadata.processing_time_ms,
      retry_count: result.metadata.retry_count,
      ocr: result.product_analysis?.ocr,
      exact_text: result.product_analysis?.exact_text,
      listing: result.listing,
      backend_bytes: result.seo_analysis.backend_search_terms?.bytes_used,
      backend_quality_percent: result.seo_analysis.backend_coverage_percent,
      operator_facts: result.product_analysis?.supplied_facts,
      competitor_references: result.competitor_profile?.references.map((reference) => ({
        asin: reference.asin,
        title: reference.title,
      })),
      errors: result.policy_validation.errors,
      warnings: result.policy_validation.warnings,
    }, null, 2)}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
