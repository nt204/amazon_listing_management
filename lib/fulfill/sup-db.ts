import "server-only";

import { ApiError } from "@/lib/api-guard";
import { extractCloudflareEmail } from "@/lib/auth-server";
import { getDatabaseClient } from "@/lib/db";
import { lotNameOf } from "./lot-state";
import { lotKey, summarizeLot, toLotLine, type RawRow } from "./lots-db";
import type { FulfillLot, FulfillLotLine } from "./types";

// Tài khoản xưởng (bảng fulfill_sup_accounts) và dữ liệu trang /sup — CHỈ ĐỌC.
// Xem db/migrations/175_fulfill_sup_accounts.sql cho các lớp bảo vệ.

export interface SupAccount {
  id: string;
  email: string;
  display_name: string | null;
  sup_names: string[];
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

const ACCOUNT_COLUMNS = `id, email, display_name, sup_names, is_active, notes, created_by,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at, to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at`;

const normEmail = (email: string) => email.trim().toLowerCase();
const normSup = (sup: string) => sup.normalize("NFC").trim().toLowerCase();

// ---------------- Quản lý tài khoản (nội bộ) ----------------

export async function listSupAccounts(): Promise<SupAccount[]> {
  const sql = await getDatabaseClient();
  return sql.unsafe<SupAccount[]>(`SELECT ${ACCOUNT_COLUMNS} FROM fulfill_sup_accounts ORDER BY lower(email)`);
}

/** Danh sách Sup trong CHI TIẾT ĐI HÀNG kèm số lô / tiền, để gán cho tài khoản. */
export async function listSupSummaries(): Promise<Array<{ sup: string; rows: number; lots: number; amount: number; last_request: string | null }>> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ sup: string; rows: number; lots: number; amount: number; last_request: string | null }[]>`
    SELECT btrim(sup) AS sup, count(*)::int AS rows,
      count(DISTINCT (store_id, COALESCE(NULLIF(btrim(ten_lo_hang), ''), ngay_request)))::int AS lots,
      COALESCE(sum(COALESCE(total_basecost, final_basecost * quantity)), 0)::float AS amount,
      max(ngay_request) AS last_request
    FROM accounting_inbound_shipments
    WHERE deleted_at IS NULL AND NULLIF(btrim(sup), '') IS NOT NULL
    GROUP BY btrim(sup)
    ORDER BY max(ngay_request) DESC NULLS LAST
  `;
  return rows;
}

export interface SupAccountInput {
  email: string;
  display_name?: string | null;
  sup_names: string[];
  is_active?: boolean;
  notes?: string | null;
}

function cleanInput(input: SupAccountInput) {
  const email = normEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Enter a valid email.", 400);
  const supNames = [...new Map(input.sup_names.map((s) => s.trim()).filter(Boolean).map((s) => [normSup(s), s])).values()];
  if (!supNames.length) throw new ApiError("Choose at least one supplier.", 400);
  return { email, supNames, displayName: input.display_name?.trim() || null, notes: input.notes?.trim() || null };
}

/** Email xưởng không được trùng tài khoản nội bộ — tránh gộp quyền nội bộ với quyền xưởng. */
async function assertNotInternalUser(email: string) {
  const sql = await getDatabaseClient();
  const [hit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM app_users WHERE lower(username) = ${email}`;
  if (hit?.n) throw new ApiError("This email belongs to an internal user. Use a separate email for the supplier.", 409);
}

export async function createSupAccount(input: SupAccountInput, actor: string): Promise<SupAccount> {
  const { email, supNames, displayName, notes } = cleanInput(input);
  await assertNotInternalUser(email);
  const sql = await getDatabaseClient();
  try {
    const [row] = await sql.unsafe<SupAccount[]>(
      `INSERT INTO fulfill_sup_accounts (email, display_name, sup_names, is_active, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ACCOUNT_COLUMNS}`,
      [email, displayName, supNames, input.is_active ?? true, notes, actor],
    );
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("This email already has a supplier account.", 409);
    throw error;
  }
}

export async function updateSupAccount(id: string, input: SupAccountInput): Promise<SupAccount> {
  const { email, supNames, displayName, notes } = cleanInput(input);
  await assertNotInternalUser(email);
  const sql = await getDatabaseClient();
  try {
    const [row] = await sql.unsafe<SupAccount[]>(
      `UPDATE fulfill_sup_accounts
       SET email = $2, display_name = $3, sup_names = $4, is_active = $5, notes = $6, updated_at = NOW()
       WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [id, email, displayName, supNames, input.is_active ?? true, notes],
    );
    if (!row) throw new ApiError("Supplier account not found.", 404);
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("This email already has a supplier account.", 409);
    throw error;
  }
}

export async function deleteSupAccount(id: string) {
  const sql = await getDatabaseClient();
  const res = await sql`DELETE FROM fulfill_sup_accounts WHERE id = ${id}`;
  if (!res.count) throw new ApiError("Supplier account not found.", 404);
}

export async function listSupAccessLog(accountId: string, limit = 50) {
  const sql = await getDatabaseClient();
  return sql<{ action: string; detail: string | null; at: string }[]>`
    SELECT action, detail, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at FROM fulfill_sup_access_log
    WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limit}
  `;
}

// ---------------- Nhận diện xưởng (trang /sup) ----------------

/**
 * Email xưởng từ Cloudflare Access (production). Máy local không có Cloudflare: cho phép header
 * `x-dev-sup-email` CHỈ khi không phải production để thử giao diện.
 */
function supEmailFrom(headers: Headers): string | null {
  const email = extractCloudflareEmail(headers);
  if (email) return email;
  if (process.env.NODE_ENV !== "production") {
    const dev = headers.get("x-dev-sup-email")?.trim().toLowerCase();
    if (dev) return dev;
  }
  return null;
}

export async function resolveSupAccount(headers: Headers): Promise<SupAccount | null> {
  const email = supEmailFrom(headers);
  if (!email) return null;
  const sql = await getDatabaseClient();
  const [account] = await sql.unsafe<SupAccount[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM fulfill_sup_accounts WHERE lower(btrim(email)) = $1 AND is_active`,
    [email],
  );
  if (!account || !account.sup_names.length) return null;
  await sql`
    UPDATE fulfill_sup_accounts SET last_seen_at = NOW()
    WHERE id = ${account.id} AND (last_seen_at IS NULL OR last_seen_at < NOW() - interval '5 minutes')
  `;
  return account;
}

export async function requireSupAccount(request: Request): Promise<SupAccount> {
  const account = await resolveSupAccount(request.headers);
  if (!account) throw new ApiError("No supplier access for this account.", 403);
  return account;
}

export async function logSupAccess(accountId: string, action: string, detail?: string) {
  const sql = await getDatabaseClient();
  await sql`INSERT INTO fulfill_sup_access_log (account_id, action, detail) VALUES (${accountId}, ${action}, ${detail ?? null})`;
}

// ---------------- Dữ liệu cho xưởng: transaction READ ONLY + role chỉ đọc ----------------

async function loadSupRows(account: SupAccount, storeId?: string): Promise<RawRow[]> {
  const sql = await getDatabaseClient();
  const names = account.sup_names.map(normSup);
  return sql.begin("read only", async (tx) => {
    await tx`SET LOCAL ROLE fulfill_sup_reader`;
    return tx<RawRow[]>`
      SELECT * FROM fulfill_sup_lines
      WHERE lower(btrim(sup)) = ANY(${names}::text[])
        AND (${storeId ?? null}::uuid IS NULL OR store_id = ${storeId ?? null}::uuid)
      ORDER BY store_id, ngay_request, row_order, created_at
    `;
  }) as Promise<RawRow[]>;
}

export async function listSupLots(account: SupAccount): Promise<FulfillLot[]> {
  const rows = await loadSupRows(account);
  const groups = new Map<string, { name: string; generated: boolean; rows: RawRow[] }>();
  for (const row of rows) {
    const { name, generated } = lotNameOf(row);
    const key = lotKey(row.store_id, name);
    const group = groups.get(key) ?? { name, generated, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, g]) => summarizeLot(key, g.name, g.generated, g.rows))
    .sort((a, b) => (b.first_request ?? "").localeCompare(a.first_request ?? "") || a.lot_name.localeCompare(b.lot_name));
}

export async function getSupLot(
  account: SupAccount,
  storeId: string,
  lotName: string,
): Promise<{ lot: FulfillLot; lines: FulfillLotLine[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return null;
  const rows = (await loadSupRows(account, storeId)).filter((row) => lotNameOf(row).name === lotName);
  if (!rows.length) return null;
  return {
    lot: summarizeLot(lotKey(storeId, lotName), lotName, lotNameOf(rows[0]).generated, rows),
    lines: rows.map(toLotLine),
  };
}

/** URL mockup của 1 dòng — chỉ khi dòng thuộc xưởng đang đăng nhập (đọc qua role chỉ đọc). */
export async function supLineMockup(account: SupAccount, lineId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) return null;
  const sql = await getDatabaseClient();
  const names = account.sup_names.map(normSup);
  const rows = (await sql.begin("read only", async (tx) => {
    await tx`SET LOCAL ROLE fulfill_sup_reader`;
    return tx<{ mockup: string | null; sku_mockup: string | null }[]>`
      SELECT mockup, sku_mockup FROM fulfill_sup_lines
      WHERE id = ${lineId} AND lower(btrim(sup)) = ANY(${names}::text[])
    `;
  })) as { mockup: string | null; sku_mockup: string | null }[];
  const url = rows[0]?.mockup?.trim() || rows[0]?.sku_mockup?.trim() || "";
  return /^https?:\/\//i.test(url) ? url : null;
}
