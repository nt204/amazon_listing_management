import { getDatabaseClient } from "@/lib/db";
import { refreshSaleKwSummary } from "@/lib/ppc/repository";

async function main() {
  const sql = await getDatabaseClient();
  console.log("Checking stores...");
  const stores = await sql<{ id: string; name: string; team_id: string }[]>`
    SELECT id, name, team_id FROM ppc_stores ORDER BY name
  `;

  console.log(`Found ${stores.length} stores.`);
  for (const store of stores) {
    console.log(`Populating sale keywords summary for store ${store.name} (${store.id})...`);
    await refreshSaleKwSummary({ teamId: store.team_id, actorId: "system" }, store.id, sql, {
      daysList: [7, 14, 30, 60, 90],
    });
  }

  const countRows = await sql<{ cnt: string | number; days_window: number }[]>`
    SELECT days_window, count(*) as cnt
    FROM ppc_sale_kw_summary
    GROUP BY days_window
    ORDER BY days_window
  `;
  console.log("Summary table counts by days_window:", countRows);
  console.log("Backfill completed successfully!");
}

main().catch((err) => {
  console.error("Backfill error:", err);
  process.exit(1);
});
