/**
 * Nạp bù lịch sử tồn từng ngày (accounting_live_inventory_daily, migration 172) từ các file crawler kế toán đã tải:
 *   <thư mục>/<ngày>/<STORE>/06_FbaInventory_<ngày>.txt  (FBA Inventory — File 06)
 *   <thư mục>/<ngày>/<STORE>/09_AwdInventory_<ngày>.csv  (AWD inventory report)
 * Ngày của ảnh chụp lấy từ chính file Amazon (FBA: cột snapshot-date; AWD: dòng Timestamp), không theo tên thư mục;
 * lưu vào ngày TRƯỚC đó (= tồn cuối ngày, cùng quy ước với lib/accounting/live-inventory.ts: chụp ~16h VN ≈ 1h sáng Mỹ hôm sau).
 * Không ghi đè ngày đã có (ảnh do crawler nạp trực tiếp luôn được giữ). Cùng store + kho + ngày có nhiều file → lấy file lớn nhất.
 *
 * Dùng: node --conditions=react-server --env-file=.env --import tsx scripts/backfill-live-inventory-daily.ts <thư mục downloads | --r2> [--dry-run]
 *   <thư mục>: Mac mini ~/AmazonAccounting/downloads
 *   --r2: đọc thẳng kho file kế toán trên Cloudflare R2 (accounting-reports/<ngày>/<STORE>/<file>) — chạy trên server
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { parseAwdInventoryReport, parseFbaInventoryReport, type ParsedLiveInventory } from "../lib/accounting/live-inventory";

const root = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const fromR2 = root === "--r2";
if (!root || (!fromR2 && !fs.existsSync(root))) {
  console.error("Thiếu / sai nguồn. Dùng: ... backfill-live-inventory-daily.ts <thư mục downloads | --r2> [--dry-run]");
  process.exit(1);
}

interface SourceFile {
  name: string;
  store: string;
  size: number;
  read: () => Promise<string>;
}

/** File 06 / 09 trong thư mục downloads (…/<STORE>/<file>) */
function localFiles(dir: string): SourceFile[] {
  return walk(dir).map((file) => ({
    name: path.basename(file),
    store: path.basename(path.dirname(file)),
    size: fs.statSync(file).size,
    read: async () => fs.readFileSync(file, "utf8"),
  }));
}

/** File 06 / 09 trên R2: <prefix>/<ngày>/<STORE>/<file> */
async function r2Files(): Promise<SourceFile[]> {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.ACCOUNTING_R2_PREFIX || "accounting-reports").replace(/^\/+|\/+$/g, "");
  const out: SourceFile[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      const parts = (o.Key ?? "").split("/");
      const name = parts.at(-1) ?? "";
      if (parts.length < 4 || !/^(06_FbaInventory_|09_AwdInventory_)/.test(name)) continue;
      const key = o.Key!;
      out.push({
        name,
        store: parts.at(-2)!,
        size: o.Size ?? 0,
        read: async () => {
          const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          return (await obj.Body?.transformToString("utf-8")) ?? "";
        },
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** "2026-11-20" | "11/20/26 16:25:01" | "11/20/2026" → YYYY-MM-DD */
function labelDate(label: string | null): string | null {
  if (!label) return null;
  const iso = label.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = label.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return null;
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
  try {
    await sql`SET statement_timeout = '60s'`;
    const stores = await sql<{ id: string; name: string }[]>`SELECT id::text, name FROM stores`;
    const storeId = new Map(stores.map((s) => [s.name.trim().toUpperCase(), s.id]));

    // (store, kho, ngày) → file lớn nhất
    const picks = new Map<string, { file: string; size: number; storeId: string; store: string; source: "FBA" | "AWD"; date: string; parsed: ParsedLiveInventory }>();
    let skipped = 0;
    const files = fromR2 ? await r2Files() : localFiles(root);
    for (const f of files) {
      const base = f.name;
      const file = `${f.store}/${f.name}`;
      const source = base.startsWith("06_FbaInventory_") ? "FBA" : base.startsWith("09_AwdInventory_") ? "AWD" : null;
      if (!source) continue;
      const store = f.store.trim().toUpperCase();
      const id = storeId.get(store);
      if (!id) {
        skipped++;
        continue;
      }
      let parsed: ParsedLiveInventory;
      try {
        const content = await f.read();
        parsed = source === "FBA" ? parseFbaInventoryReport(content) : parseAwdInventoryReport(content);
      } catch (error) {
        console.warn(`  bỏ qua ${file}: ${(error as Error).message}`);
        skipped++;
        continue;
      }
      const label = labelDate(parsed.reportLabel);
      const date = label ? prevDay(label) : null;
      if (!date || parsed.rows.length === 0) {
        skipped++;
        continue;
      }
      const key = `${id}|${source}|${date}`;
      const size = f.size;
      const prev = picks.get(key);
      if (!prev || size > prev.size) picks.set(key, { file, size, storeId: id, store, source, date, parsed });
    }

    const existing = new Set(
      (await sql<{ k: string }[]>`
        SELECT DISTINCT store_id::text || '|' || source || '|' || snapshot_date::text AS k FROM accounting_live_inventory_daily
      `).map((r) => r.k),
    );

    let inserted = 0;
    const summary = new Map<string, string[]>();
    for (const p of [...picks.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      const key = `${p.storeId}|${p.source}|${p.date}`;
      if (existing.has(key)) continue;
      const list = summary.get(`${p.store} ${p.source}`) ?? [];
      list.push(p.date);
      summary.set(`${p.store} ${p.source}`, list);
      if (dryRun) continue;
      const rows = p.parsed.rows.map((r) => ({
        store_id: p.storeId,
        source: p.source,
        snapshot_date: p.date,
        sku: r.sku,
        fnsku: r.fnsku,
        asin: r.asin,
        available: r.available,
        inbound: r.inbound,
        reserved: r.reserved,
      }));
      for (let i = 0; i < rows.length; i += 1000) {
        await sql`INSERT INTO accounting_live_inventory_daily ${sql(rows.slice(i, i + 1000))} ON CONFLICT DO NOTHING`;
      }
      inserted++;
    }
    for (const [k, dates] of [...summary.entries()].sort()) {
      console.log(`${k}: ${dates.length} ngày (${dates[0]} → ${dates.at(-1)})`);
    }
    console.log(`${dryRun ? "[dry-run] sẽ nạp" : "Đã nạp"} ${dryRun ? [...summary.values()].reduce((s, d) => s + d.length, 0) : inserted} ảnh chụp; bỏ qua ${skipped} file.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
