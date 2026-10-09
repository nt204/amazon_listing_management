import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const sql = postgres(connectionString, { max: 1 });
  try {
    const adminEmails = ["ndtrince@gmail.com", "nguyendangtri2507@gmail.com"];
    for (const email of adminEmails) {
      await sql`
        INSERT INTO app_users (
          team_id, user_id, username, display_name, password_hash, role, status,
          allowed_features, approved_by, approved_at, created_at, updated_at
        ) VALUES (
          'default', ${`admin-${email.split("@")[0]}`}, ${email}, ${`Admin (${email.split("@")[0]})`},
          NULL, 'admin', 'approved', ARRAY['listing', 'mockups', 'sellersprite', 'ppc', 'accounting']::TEXT[],
          'system', NOW(), NOW(), NOW()
        )
        ON CONFLICT (team_id, LOWER(username)) DO UPDATE SET
          role = 'admin',
          status = 'approved',
          allowed_features = ARRAY['listing', 'mockups', 'sellersprite', 'ppc', 'accounting']::TEXT[],
          updated_at = NOW()
      `;
    }
    process.stdout.write("Admin bootstrap verified for: " + adminEmails.join(", ") + "\n");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
