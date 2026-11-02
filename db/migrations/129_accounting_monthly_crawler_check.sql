-- Migration 129: Allow accounting_monthly in accounting_crawler_jobs CHECK constraint
ALTER TABLE accounting_crawler_jobs DROP CONSTRAINT IF EXISTS accounting_crawler_jobs_crawler_check;
ALTER TABLE accounting_crawler_jobs ADD CONSTRAINT accounting_crawler_jobs_crawler_check
  CHECK (crawler IN ('accounting_daily', 'accounting_monthly', 'inventory_ledger', 'awd_ledger'));
