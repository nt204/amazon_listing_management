import postgres from "postgres";
import { extractLocalOcr } from "../lib/local-ocr";
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
  const sql = postgres(connectionString, { max: 1 });
  try {
    const listings = requestedId
      ? await sql<ListingRow[]>`
          SELECT id::text, internal_name, input_json
          FROM listings WHERE id = ${requestedId} LIMIT 1
        `
      : await sql<ListingRow[]>`
          SELECT id::text, internal_name, input_json
          FROM listings ORDER BY created_at DESC LIMIT 1
        `;
    const listing = listings[0];
    if (!listing) throw new Error(requestedId ? "Listing not found." : "No listing is available.");
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
    const result = await extractLocalOcr(input);
    process.stdout.write(`${JSON.stringify({
      listing_id: listing.id,
      internal_name: listing.internal_name,
      status: result.status,
      images_processed: result.imagesProcessed,
      warnings: result.warnings,
      lines: result.lines,
    }, null, 2)}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
