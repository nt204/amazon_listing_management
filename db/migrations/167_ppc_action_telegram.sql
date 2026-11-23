-- Bot Telegram riêng cho action PPC (@nce_ppc_action_bot, lib/telegram-action-bot.ts).
-- Mỗi user liên kết Telegram cá nhân bằng link t.me/<bot>?start=<mã một lần> tạo trong modal Auto giảm Bid.

CREATE TABLE IF NOT EXISTS ppc_telegram_links (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  telegram_username TEXT,
  telegram_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id)
);

-- Một Telegram chỉ gắn với một tài khoản (bấm nút trên Telegram → biết chắc là ai).
CREATE UNIQUE INDEX IF NOT EXISTS ppc_telegram_links_chat_idx ON ppc_telegram_links (chat_id);

CREATE TABLE IF NOT EXISTS ppc_telegram_link_codes (
  code TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tin nhắn Telegram đã gửi cho mỗi lô (để sửa tin sau khi có người xử lý).
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_telegram_messages (
  batch_id UUID NOT NULL REFERENCES ppc_auto_decrease_batches(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, chat_id)
);
