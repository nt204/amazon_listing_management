-- Migration 095: Thêm trường feature_name (tên chức năng) cho Kanban Feedback Cards
ALTER TABLE kanban_feedback_cards ADD COLUMN IF NOT EXISTS feature_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_kanban_feedback_feature ON kanban_feedback_cards(feature_name);
