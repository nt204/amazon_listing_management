-- Nhật ký mỗi lượt chạy agent (lib/agent-core/run-store.ts): dùng chung cho mọi agent.
-- Một lượt = 1 câu hỏi của người dùng + câu trả lời + các tool đã gọi. session_id gom các lượt thành 1 hội thoại.
-- Dùng để: dựng lịch sử hội thoại, xem lại agent trả lời sai ở đâu, đo chi phí / độ trễ, và
-- lấy câu hỏi thật + đánh giá 👍/👎 làm bộ chấm điểm (eval) khi đổi prompt / model.
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  agent TEXT NOT NULL,
  session_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web',
  input TEXT NOT NULL,
  context JSONB,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  error TEXT,
  model TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage JSONB,
  latency_ms INTEGER,
  feedback SMALLINT CHECK (feedback IN (-1, 1)),
  feedback_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_session_idx
  ON agent_runs (team_id, actor_id, agent, session_id, created_at);

CREATE INDEX IF NOT EXISTS agent_runs_agent_created_idx
  ON agent_runs (agent, created_at DESC);
