-- 124_ppc_sku_ai_chat.sql
-- Bộ nhớ riêng của AI chat theo SKU (tách khỏi bộ nhớ Lark agent).
-- 1. Hội thoại: theo từng người dùng + SKU.
-- 2. Ghi nhớ: sự kiện / quyết định / kế hoạch của SKU, dùng chung cả team, AI đọc lại mỗi lần chat.

CREATE TABLE IF NOT EXISTS ppc_sku_ai_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  goal TEXT,
  tools_used TEXT[] NOT NULL DEFAULT '{}',
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_sku_ai_chat_messages_thread_idx
  ON ppc_sku_ai_chat_messages(team_id, actor_id, store_id, sku, id);

CREATE TABLE IF NOT EXISTS ppc_sku_ai_notes (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('FACT', 'DECISION', 'PLAN')),
  note TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ppc_sku_ai_notes_sku_idx
  ON ppc_sku_ai_notes(team_id, store_id, sku, created_at DESC)
  WHERE deleted_at IS NULL;
