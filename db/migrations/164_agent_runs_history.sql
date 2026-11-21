-- Lịch sử hội thoại agent hiển thị lại khi mở khung chat (lib/agent-core/run-store.ts):
--   user_message — câu người dùng gõ (input còn kèm khối bối cảnh màn hình gửi cho model);
--   cleared_at   — người dùng bấm "Xóa hội thoại": ẩn khỏi khung chat và khỏi ngữ cảnh model, vẫn giữ để chấm điểm.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS user_message TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;

-- Tìm hội thoại gần nhất chưa xóa của người dùng với 1 agent
CREATE INDEX IF NOT EXISTS agent_runs_actor_recent_idx
  ON agent_runs (team_id, actor_id, agent, created_at DESC)
  WHERE cleared_at IS NULL;
