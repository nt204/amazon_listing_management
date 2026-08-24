import postgres from "postgres";
import { hashPassword } from "../lib/password";

interface TeamCredential {
  team_id: string;
  user_id: string;
  display_name?: string;
  token: string;
  role: "editor" | "reviewer" | "admin";
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const configured = process.env.LISTING_DESK_TEAMS_JSON?.trim();
  if (!configured) {
    process.stdout.write("No LISTING_DESK_TEAMS_JSON configured; skipped admin bootstrap.\n");
    return;
  }
  const credentials = JSON.parse(configured) as TeamCredential[];
  const admin = credentials.find((credential) => credential.role === "admin");
  if (!admin) {
    process.stdout.write("No admin credential configured; skipped admin bootstrap.\n");
    return;
  }
  const username = admin.user_id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("Bootstrap admin user_id must be a valid username with 3-32 characters.");
  }
  const sql = postgres(connectionString, { max: 1 });
  try {
    const inserted = await sql`
      INSERT INTO app_users (
        team_id, user_id, username, display_name, password_hash, role, status,
        approved_by, approved_at
      ) VALUES (
        ${admin.team_id}, ${admin.user_id}, ${username},
        ${admin.display_name || admin.user_id}, ${hashPassword(admin.token)},
        'admin', 'approved', ${admin.user_id}, NOW()
      )
      ON CONFLICT (team_id, user_id) DO NOTHING
      RETURNING user_id
    `;
    process.stdout.write(
      inserted.length
        ? `Bootstrapped admin account: ${username}. Use its configured team token as the initial password.\n`
        : `Admin account ${username} already exists; bootstrap made no changes.\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
