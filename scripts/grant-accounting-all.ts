import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });

  const updated = await sql`
    UPDATE app_users 
    SET allowed_features = array_append(allowed_features, 'accounting') 
    WHERE NOT ('accounting' = ANY(allowed_features))
    RETURNING username, allowed_features;
  `;
  console.log("Updated users with accounting permission:", updated);

  const all = await sql`
    SELECT username, role, allowed_features FROM app_users ORDER BY username;
  `;
  console.log("Current all users:", all);
  await sql.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
