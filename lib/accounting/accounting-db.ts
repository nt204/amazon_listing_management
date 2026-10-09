import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type {
  CreateLegalEntityInput,
  CreateStoreInput,
  LegalEntity,
  Store,
  UpdateStoreInput,
} from "./types";

export async function listStores(): Promise<Store[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<Store[]>`
    SELECT
      s.id,
      s.name,
      s.marketplace,
      COALESCE(s.team, 'NCE') AS team,
      s.legal_entity_id,
      COALESCE(s.legal_entity, le.name) AS legal_entity,
      s.seller_id,
      s.status,
      s.created_at::text,
      s.updated_at::text,
      COALESCE(s.legal_entity, le.name) AS legal_entity_name
    FROM stores s
    LEFT JOIN legal_entities le ON s.legal_entity_id = le.id
    ORDER BY s.name ASC
  `;
  return rows;
}

export async function getStoreById(id: string): Promise<Store | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Store[]>`
    SELECT
      s.id,
      s.name,
      s.marketplace,
      COALESCE(s.team, 'NCE') AS team,
      s.legal_entity_id,
      COALESCE(s.legal_entity, le.name) AS legal_entity,
      s.seller_id,
      s.status,
      s.created_at::text,
      s.updated_at::text,
      COALESCE(s.legal_entity, le.name) AS legal_entity_name
    FROM stores s
    LEFT JOIN legal_entities le ON s.legal_entity_id = le.id
    WHERE s.id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function createStore(input: CreateStoreInput): Promise<Store> {
  const sql = await getDatabaseClient();
  const rows = await sql<Store[]>`
    INSERT INTO stores (
      name,
      marketplace,
      team,
      legal_entity_id,
      legal_entity,
      seller_id,
      status
    ) VALUES (
      ${input.name.trim()},
      ${input.marketplace.trim()},
      ${input.team ? input.team.trim() : "NCE"},
      ${input.legal_entity_id || null},
      ${input.legal_entity ? input.legal_entity.trim() : null},
      ${input.seller_id ? input.seller_id.trim() : null},
      ${input.status || "active"}
    )
    RETURNING
      id,
      name,
      marketplace,
      team,
      legal_entity_id,
      legal_entity,
      seller_id,
      status,
      created_at::text,
      updated_at::text
  `;
  const created = rows[0];
  if (created.legal_entity_id && !created.legal_entity) {
    const le = await sql<{ name: string }[]>`
      SELECT name FROM legal_entities WHERE id = ${created.legal_entity_id} LIMIT 1
    `;
    created.legal_entity_name = le[0]?.name || null;
  } else {
    created.legal_entity_name = created.legal_entity || null;
  }
  return created;
}

export async function updateStore(id: string, input: UpdateStoreInput): Promise<Store | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Store[]>`
    UPDATE stores
    SET
      name = COALESCE(${input.name ? input.name.trim() : null}, name),
      marketplace = COALESCE(${input.marketplace ? input.marketplace.trim() : null}, marketplace),
      team = COALESCE(${input.team ? input.team.trim() : null}, team),
      legal_entity = ${input.legal_entity !== undefined ? (input.legal_entity ? input.legal_entity.trim() : null) : sql`legal_entity`},
      legal_entity_id = ${input.legal_entity_id !== undefined ? input.legal_entity_id : sql`legal_entity_id`},
      seller_id = ${input.seller_id !== undefined ? (input.seller_id ? input.seller_id.trim() : null) : sql`seller_id`},
      status = COALESCE(${input.status || null}, status),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
      name,
      marketplace,
      team,
      legal_entity_id,
      legal_entity,
      seller_id,
      status,
      created_at::text,
      updated_at::text
  `;
  if (!rows[0]) return null;
  const updated = rows[0];
  if (updated.legal_entity_id && !updated.legal_entity) {
    const le = await sql<{ name: string }[]>`
      SELECT name FROM legal_entities WHERE id = ${updated.legal_entity_id} LIMIT 1
    `;
    updated.legal_entity_name = le[0]?.name || null;
  } else {
    updated.legal_entity_name = updated.legal_entity || null;
  }
  return updated;
}

export async function deleteStore(id: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const result = await sql`
    DELETE FROM stores WHERE id = ${id}
  `;
  return result.count > 0;
}

export async function listLegalEntities(): Promise<LegalEntity[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<LegalEntity[]>`
    SELECT
      id,
      name,
      country,
      status,
      created_at::text,
      updated_at::text
    FROM legal_entities
    ORDER BY name ASC
  `;
  return rows;
}

export async function createLegalEntity(input: CreateLegalEntityInput): Promise<LegalEntity> {
  const sql = await getDatabaseClient();
  const rows = await sql<LegalEntity[]>`
    INSERT INTO legal_entities (
      name,
      country,
      status
    ) VALUES (
      ${input.name.trim()},
      ${input.country ? input.country.trim() : "United States"},
      ${input.status || "active"}
    )
    ON CONFLICT (name) DO UPDATE SET
      country = EXCLUDED.country,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING
      id,
      name,
      country,
      status,
      created_at::text,
      updated_at::text
  `;
  return rows[0];
}

export async function updateLegalEntity(
  id: string,
  input: { name?: string; country?: string; status?: "active" | "inactive" },
): Promise<LegalEntity | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<LegalEntity[]>`
    UPDATE legal_entities
    SET
      name = COALESCE(${input.name ? input.name.trim() : null}, name),
      country = COALESCE(${input.country ? input.country.trim() : null}, country),
      status = COALESCE(${input.status || null}, status),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
      name,
      country,
      status,
      created_at::text,
      updated_at::text
  `;
  return rows[0] || null;
}

export async function deleteLegalEntity(id: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const result = await sql`
    DELETE FROM legal_entities WHERE id = ${id}
  `;
  return result.count > 0;
}
