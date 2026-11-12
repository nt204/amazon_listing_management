-- 147_accounting_payout_disbursements.sql
-- Bảng lưu lịch sử tiền về (Payouts / Disbursements) từ Amazon Seller Central

CREATE TABLE IF NOT EXISTS accounting_payout_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL DEFAULT 'default',
  store_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payout_amount NUMERIC(14, 2) NOT NULL,
  payout_status TEXT NOT NULL DEFAULT 'Done',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_date DATE,
  trace_id TEXT,
  settlement_group TEXT,
  period_start DATE,
  period_end DATE,
  period_raw TEXT,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_payouts_store_date 
  ON accounting_payout_disbursements(store_name, acknowledged_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_payouts_store_trace 
  ON accounting_payout_disbursements(store_name, trace_id) 
  WHERE trace_id IS NOT NULL AND trace_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_payouts_store_group_ack 
  ON accounting_payout_disbursements(store_name, settlement_group, acknowledged_at)
  WHERE (trace_id IS NULL OR trace_id = '') AND settlement_group IS NOT NULL;
