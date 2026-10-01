import postgres from "postgres";
import type {
  CompetitorDiscoveryOutput,
  ScoredCandidate,
  RejectedCandidateRecord,
} from "../domain/competitor.types";

let schemaInitialized = false;

function getDbClient(): ReturnType<typeof postgres> | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    return postgres(connectionString, { max: 2, connect_timeout: 5 });
  } catch {
    return null;
  }
}

async function initSchema(sql: ReturnType<typeof postgres>) {
  if (schemaInitialized) return;
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS competitor_discovery_runs (
        id TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        marketplace TEXT NOT NULL,
        raw_count INT NOT NULL DEFAULT 0,
        organic_count INT NOT NULL DEFAULT 0,
        ai_pass_count INT NOT NULL DEFAULT 0,
        selected_count INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS competitor_candidates (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES competitor_discovery_runs(id) ON DELETE CASCADE,
        asin TEXT NOT NULL,
        parent_asin TEXT,
        title TEXT NOT NULL,
        brand TEXT,
        placement TEXT NOT NULL,
        monthly_revenue NUMERIC,
        monthly_sales INT,
        bsr INT,
        relevance_score INT,
        hard_mismatch BOOLEAN,
        ai_reason TEXT,
        revenue_score NUMERIC,
        sales_score NUMERIC,
        bsr_score NUMERIC,
        final_score NUMERIC,
        status TEXT NOT NULL,
        reject_reason TEXT,
        selected_rank INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_competitor_candidates_run ON competitor_candidates(run_id);
    `);
    schemaInitialized = true;
  } catch (err) {
    console.warn("[CompetitorRepository] Could not initialize tables:", err);
  }
}

/**
 * Persists competitor discovery run and all candidate states to PostgreSQL (Sections 31 & 32)
 */
export async function saveDiscoveryRun(
  runId: string,
  output: CompetitorDiscoveryOutput,
  allCandidates: ScoredCandidate[],
  rejectedRecords: RejectedCandidateRecord[]
): Promise<void> {
  const sql = getDbClient();
  if (!sql) return;

  try {
    await initSchema(sql);

    // 1. Insert run
    await sql`
      INSERT INTO competitor_discovery_runs (
        id, product_name, marketplace, raw_count, organic_count, ai_pass_count, selected_count, status
      ) VALUES (
        ${runId},
        ${output.productName},
        ${output.marketplace},
        ${output.stats.raw},
        ${output.stats.organicOnly},
        ${output.stats.afterHardFilter},
        ${output.stats.selected},
        'COMPLETED'
      )
    `;

    // 2. Insert candidates
    for (const c of allCandidates) {
      await sql`
        INSERT INTO competitor_candidates (
          run_id, asin, parent_asin, title, brand, placement,
          monthly_revenue, monthly_sales, bsr,
          relevance_score, hard_mismatch, ai_reason,
          revenue_score, sales_score, bsr_score, final_score,
          status, reject_reason, selected_rank
        ) VALUES (
          ${runId},
          ${c.asin},
          ${c.parentAsin || null},
          ${c.title},
          ${c.brand || null},
          ${c.placement},
          ${c.monthlyRevenue || null},
          ${c.monthlySales || null},
          ${c.bsr || null},
          ${c.ai?.relevanceScore ?? null},
          ${c.ai?.hardMismatch ?? null},
          ${c.ai?.reason || null},
          ${c.scores?.revenue || null},
          ${c.scores?.sales || null},
          ${c.scores?.bsr || null},
          ${c.scores?.final || null},
          ${c.status || "RAW"},
          ${c.rejectReason || null},
          ${c.rank || null}
        )
      `;
    }
  } catch (err) {
    console.warn("[CompetitorRepository] Error saving discovery run to DB:", err);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
