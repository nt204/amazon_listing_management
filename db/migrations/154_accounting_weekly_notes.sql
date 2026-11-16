-- 154_accounting_weekly_notes.sql
-- Báo cáo tuần → thẻ "Đánh giá": kế toán / admin dán nhận xét của tuần (như cột Nhận xét / VII. Kết luận của sheet
-- BÁO CÁO TUẦN TỔNG HỢP). Mỗi đoạn tuần 1 dòng (week_start = ngày đầu đoạn tuần).

CREATE TABLE IF NOT EXISTS accounting_weekly_notes (
  week_start DATE PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
