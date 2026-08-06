import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

interface StoredImage {
  name: string;
  type: string;
  data_url: string;
  storage_key?: string;
  sha256?: string;
}

interface ListingRow {
  id: string;
  team_id: string;
  input_json: { images?: StoredImage[] } | string;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  let migrated = 0;
  try {
    const rows = await sql<ListingRow[]>`
      SELECT id::text, team_id, input_json
      FROM listings
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(input_json->'images', '[]'::jsonb)) image
        WHERE COALESCE(image->>'data_url', '') <> ''
      )
    `;
    for (const row of rows) {
      const input = typeof row.input_json === "string" ? JSON.parse(row.input_json) : row.input_json;
      const images = input.images || [];
      await sql.begin(async (transaction) => {
        for (const [imageIndex, image] of images.entries()) {
          if (!image.data_url) continue;
          const payload = image.data_url.slice(image.data_url.indexOf(",") + 1);
          const bytes = Buffer.from(payload, "base64");
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          await transaction`
            INSERT INTO listing_images (
              id, listing_id, team_id, image_index, name, mime_type, sha256, image_bytes
            ) VALUES (
              ${randomUUID()}, ${row.id}, ${row.team_id}, ${imageIndex}, ${image.name},
              ${image.type}, ${sha256}, ${bytes}
            )
            ON CONFLICT (listing_id, image_index) DO NOTHING
          `;
          images[imageIndex] = {
            name: image.name,
            type: image.type,
            data_url: "",
            storage_key: `db:${row.id}:${imageIndex}`,
            sha256,
          };
        }
        await transaction`
          UPDATE listings SET input_json = ${transaction.json(input)}, updated_at = NOW()
          WHERE id = ${row.id} AND team_id = ${row.team_id}
        `;
      });
      migrated += 1;
    }
    process.stdout.write(`Migrated images for ${migrated} listing(s).\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
