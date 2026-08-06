import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const directory = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      const body = await readFile(path.join(directory, name), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const existing = await sql<{ checksum: string }[]>`
        SELECT checksum FROM schema_migrations WHERE name = ${name} LIMIT 1
      `;
      if (existing[0]) {
        if (existing[0].checksum !== checksum) throw new Error(`Applied migration ${name} was modified.`);
        continue;
      }
      await sql.begin(async (transaction) => {
        await transaction.unsafe(body);
        await transaction`
          INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})
        `;
      });
      process.stdout.write(`Applied ${name}\n`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
