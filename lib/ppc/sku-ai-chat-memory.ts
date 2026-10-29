import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type { DataScope } from "@/lib/db";

/**
 * Bộ nhớ riêng của AI chat theo SKU:
 * - Hội thoại theo người dùng + SKU (mỗi người một luồng).
 * - Ghi nhớ của SKU dùng chung cả team (kế hoạch, quyết định, bối cảnh ngoài dữ liệu).
 */

export type SkuNoteKind = "FACT" | "DECISION" | "PLAN";

export interface SkuChatStoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SkuNote {
  id: number;
  kind: SkuNoteKind;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface SkuThread {
  scope: DataScope;
  storeId: string;
  sku: string;
}

const MAX_NOTES_PER_SKU = 30;

export async function listThreadMessages(thread: SkuThread, limit = 50): Promise<SkuChatStoredMessage[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; role: "user" | "assistant"; content: string; created_at: string }>>`
    SELECT id, role, content, created_at::text
    FROM ppc_sku_ai_chat_messages
    WHERE team_id = ${thread.scope.teamId} AND actor_id = ${thread.scope.actorId}
      AND store_id = ${thread.storeId} AND sku = ${thread.sku}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.reverse().map((row) => ({
    id: Number(row.id),
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function appendThreadMessage(
  thread: SkuThread,
  message: { role: "user" | "assistant"; content: string; goal?: string; toolsUsed?: string[]; model?: string },
): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO ppc_sku_ai_chat_messages (team_id, actor_id, store_id, sku, role, content, goal, tools_used, model)
    VALUES (${thread.scope.teamId}, ${thread.scope.actorId}, ${thread.storeId}, ${thread.sku},
            ${message.role}, ${message.content}, ${message.goal ?? null}, ${message.toolsUsed ?? []}, ${message.model ?? null})
  `;
}

export async function clearThread(thread: SkuThread): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    DELETE FROM ppc_sku_ai_chat_messages
    WHERE team_id = ${thread.scope.teamId} AND actor_id = ${thread.scope.actorId}
      AND store_id = ${thread.storeId} AND sku = ${thread.sku}
  `;
}

export async function listSkuNotes(thread: SkuThread): Promise<SkuNote[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; kind: SkuNoteKind; note: string; created_by: string; created_at: string }>>`
    SELECT n.id, n.kind, n.note, COALESCE(u.display_name, n.created_by) AS created_by, n.created_at::text
    FROM ppc_sku_ai_notes n
    LEFT JOIN app_users u ON u.team_id = n.team_id AND u.user_id = n.created_by
    WHERE n.team_id = ${thread.scope.teamId} AND n.store_id = ${thread.storeId} AND n.sku = ${thread.sku}
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
    LIMIT ${MAX_NOTES_PER_SKU}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function addSkuNote(thread: SkuThread, kind: SkuNoteKind, note: string): Promise<SkuNote> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; created_at: string }>>`
    INSERT INTO ppc_sku_ai_notes (team_id, store_id, sku, kind, note, created_by)
    VALUES (${thread.scope.teamId}, ${thread.storeId}, ${thread.sku}, ${kind}, ${note}, ${thread.scope.actorId})
    RETURNING id, created_at::text
  `;
  return { id: Number(rows[0].id), kind, note, createdBy: thread.scope.actorId, createdAt: rows[0].created_at };
}

export async function deleteSkuNote(thread: SkuThread, noteId: number): Promise<boolean> {
  const sql = await getDatabaseClient();
  const rows = await sql`
    UPDATE ppc_sku_ai_notes SET deleted_at = NOW()
    WHERE id = ${noteId} AND team_id = ${thread.scope.teamId}
      AND store_id = ${thread.storeId} AND sku = ${thread.sku} AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}
