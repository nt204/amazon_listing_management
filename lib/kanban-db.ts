import "server-only";

import { getDatabaseClient } from "@/lib/db";

export type KanbanUrgency = "low" | "medium" | "high" | "urgent";
export type KanbanStatus = "todo" | "in_progress" | "done";

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  urgency: KanbanUrgency;
  status: KanbanStatus;
  featureName: string;
  images: string[];
  authorName: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanComment {
  id: string;
  cardId: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

interface KanbanCardRow {
  id: string;
  title: string;
  description: string;
  urgency: KanbanUrgency;
  status: KanbanStatus;
  feature_name?: string | null;
  images: string[] | string | null;
  author_name: string;
  position: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface KanbanCommentRow {
  id: string;
  card_id: string;
  body: string;
  author_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseImages(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((item): item is string => typeof item === "string");
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      if (val.trim()) return [val];
    }
  }
  return [];
}

function rowToCard(row: KanbanCardRow): KanbanCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    urgency: row.urgency,
    status: row.status,
    featureName: row.feature_name || "",
    images: parseImages(row.images),
    authorName: row.author_name || "",
    position: Number(row.position) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToComment(row: KanbanCommentRow): KanbanComment {
  return {
    id: row.id,
    cardId: row.card_id,
    body: row.body,
    authorName: row.author_name || "Thành viên",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listKanbanComments(cardId: string): Promise<KanbanComment[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<KanbanCommentRow[]>`
    SELECT id, card_id, body, author_name, created_at, updated_at
    FROM kanban_feedback_comments
    WHERE card_id = ${cardId}::uuid
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map(rowToComment);
}

export async function createKanbanComment(input: {
  cardId: string;
  body: string;
  authorName?: string;
}): Promise<KanbanComment | null> {
  const sql = await getDatabaseClient();
  const body = input.body.trim();
  if (!body) return null;

  const rows = await sql<KanbanCommentRow[]>`
    INSERT INTO kanban_feedback_comments (card_id, body, author_name)
    SELECT ${input.cardId}::uuid, ${body}, ${input.authorName?.trim() || "Thành viên"}
    WHERE EXISTS (SELECT 1 FROM kanban_feedback_cards WHERE id = ${input.cardId}::uuid)
    RETURNING id, card_id, body, author_name, created_at, updated_at
  `;
  return rows[0] ? rowToComment(rows[0]) : null;
}

export async function listKanbanCards(filters?: {
  status?: KanbanStatus;
  urgency?: KanbanUrgency;
  featureName?: string;
  search?: string;
}): Promise<KanbanCard[]> {
  const sql = await getDatabaseClient();

  const rows = await sql<KanbanCardRow[]>`
    SELECT id, title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
    FROM kanban_feedback_cards
    WHERE
      (${filters?.status ? filters.status : null}::text IS NULL OR status = ${filters?.status || null})
      AND (${filters?.urgency ? filters.urgency : null}::text IS NULL OR urgency = ${filters?.urgency || null})
      AND (${filters?.featureName ? filters.featureName : null}::text IS NULL OR feature_name = ${filters?.featureName || null})
      AND (
        ${filters?.search ? `%${filters.search}%` : null}::text IS NULL
        OR title ILIKE ${filters?.search ? `%${filters.search}%` : null}
        OR description ILIKE ${filters?.search ? `%${filters.search}%` : null}
        OR author_name ILIKE ${filters?.search ? `%${filters.search}%` : null}
        OR feature_name ILIKE ${filters?.search ? `%${filters.search}%` : null}
      )
    ORDER BY position ASC, created_at DESC
  `;

  return rows.map(rowToCard);
}

/** Badge sidebar chỉ cần số thẻ chưa xong; không tải ảnh base64 của cả bảng. */
export async function countPendingKanbanCards(): Promise<number> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM kanban_feedback_cards WHERE status <> 'done'
  `;
  return rows[0]?.count ?? 0;
}

export async function getKanbanCardById(id: string): Promise<KanbanCard | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<KanbanCardRow[]>`
    SELECT id, title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
    FROM kanban_feedback_cards
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return rowToCard(rows[0]);
}

export async function createKanbanCard(input: {
  title: string;
  description?: string;
  urgency?: KanbanUrgency;
  status?: KanbanStatus;
  featureName?: string;
  images?: string[];
  authorName?: string;
}): Promise<KanbanCard> {
  const sql = await getDatabaseClient();
  const title = input.title.trim();
  const description = (input.description || "").trim();
  const urgency: KanbanUrgency = input.urgency || "medium";
  const status: KanbanStatus = input.status || "todo";
  const featureName = (input.featureName || "").trim();
  const imagesJson = JSON.stringify(input.images || []);
  const authorName = (input.authorName || "").trim();

  // Get next position in the target status column
  const posResult = await sql<{ max_pos: number | null }[]>`
    SELECT MAX(position) as max_pos
    FROM kanban_feedback_cards
    WHERE status = ${status}
  `;
  const nextPos = (posResult[0]?.max_pos ?? -1) + 1;

  const rows = await sql<KanbanCardRow[]>`
    INSERT INTO kanban_feedback_cards (
      title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
    ) VALUES (
      ${title}, ${description}, ${urgency}, ${status}, ${featureName}, ${imagesJson}::jsonb, ${authorName}, ${nextPos}, NOW(), NOW()
    )
    RETURNING id, title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
  `;

  return rowToCard(rows[0]);
}

export async function updateKanbanCard(
  id: string,
  updates: {
    title?: string;
    description?: string;
    urgency?: KanbanUrgency;
    status?: KanbanStatus;
    featureName?: string;
    images?: string[];
    authorName?: string;
    position?: number;
  },
): Promise<KanbanCard | null> {
  const sql = await getDatabaseClient();

  // Build dynamic update safely
  const existing = await getKanbanCardById(id);
  if (!existing) return null;

  const title = updates.title !== undefined ? updates.title.trim() : existing.title;
  const description = updates.description !== undefined ? updates.description.trim() : existing.description;
  const urgency = updates.urgency !== undefined ? updates.urgency : existing.urgency;
  const status = updates.status !== undefined ? updates.status : existing.status;
  const featureName = updates.featureName !== undefined ? updates.featureName.trim() : existing.featureName;
  const imagesJson = updates.images !== undefined ? JSON.stringify(updates.images) : JSON.stringify(existing.images);
  const authorName = updates.authorName !== undefined ? updates.authorName.trim() : existing.authorName;
  const position = updates.position !== undefined ? updates.position : existing.position;

  const rows = await sql<KanbanCardRow[]>`
    UPDATE kanban_feedback_cards
    SET
      title = ${title},
      description = ${description},
      urgency = ${urgency},
      status = ${status},
      feature_name = ${featureName},
      images = ${imagesJson}::jsonb,
      author_name = ${authorName},
      position = ${position},
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
  `;

  if (!rows[0]) return null;
  return rowToCard(rows[0]);
}

export async function moveKanbanCard(
  id: string,
  targetStatus: KanbanStatus,
  targetPosition?: number,
): Promise<KanbanCard | null> {
  const sql = await getDatabaseClient();
  const existing = await getKanbanCardById(id);
  if (!existing) return null;

  let newPosition = targetPosition;
  if (newPosition === undefined) {
    const posResult = await sql<{ max_pos: number | null }[]>`
      SELECT MAX(position) as max_pos
      FROM kanban_feedback_cards
      WHERE status = ${targetStatus}
    `;
    newPosition = (posResult[0]?.max_pos ?? -1) + 1;
  }

  const rows = await sql<KanbanCardRow[]>`
    UPDATE kanban_feedback_cards
    SET
      status = ${targetStatus},
      position = ${newPosition},
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, title, description, urgency, status, feature_name, images, author_name, position, created_at, updated_at
  `;

  if (!rows[0]) return null;
  return rowToCard(rows[0]);
}

export async function deleteKanbanCard(id: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM kanban_feedback_cards
    WHERE id = ${id}::uuid
  `;
  return res.count > 0;
}
