import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  createAiImageDerivative,
  createStoredImageDerivatives,
} from "../lib/image-processing";

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

interface ImageRow {
  id: string;
  name: string;
  mime_type: string;
  image_bytes: Buffer;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  let migrated = 0;
  let derived = 0;
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

    const imageRows = await sql<ImageRow[]>`
      SELECT id::text, name, mime_type, image_bytes
      FROM listing_images
      WHERE
        ai_image_bytes IS NULL OR
        preview_image_bytes IS NULL OR
        ai_image_bytes = image_bytes
      ORDER BY created_at ASC
    `;
    for (const image of imageRows) {
      const dataUrl = `data:${image.mime_type};base64,${image.image_bytes.toString("base64")}`;
      const derivatives = await createStoredImageDerivatives({
        name: image.name,
        type: image.mime_type,
        data_url: dataUrl,
      });
      const ai = await createAiImageDerivative(image.image_bytes);
      await sql`
        UPDATE listing_images
        SET
          width = ${derivatives.width},
          height = ${derivatives.height},
          ai_mime_type = ${ai.mimeType},
          ai_image_bytes = ${ai.bytes},
          preview_mime_type = ${derivatives.previewMimeType},
          preview_image_bytes = ${derivatives.previewBytes},
          preview_width = ${derivatives.previewWidth},
          preview_height = ${derivatives.previewHeight}
        WHERE id = ${image.id}
      `;
      derived += 1;
    }
    process.stdout.write(
      `Migrated images for ${migrated} listing(s); generated derivatives for ${derived} image(s).\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
