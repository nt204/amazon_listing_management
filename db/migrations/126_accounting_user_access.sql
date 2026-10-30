-- 126_accounting_user_access.sql
-- Vai trò "accountant" (Kế toán): thấy mọi store kế toán và phân quyền cho người khác.
-- Phân quyền kế toán theo Team của store (cột stores.team, vd "FBA 2" / "FBM"):
--   team FBA x → phần FBA của các store có team đó; team FBM → phần FBM của mọi store có FBM.
--   can_edit = FALSE: chỉ xem; TRUE: nhập / sửa dữ liệu và sửa thông tin store.

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check CHECK (role IN ('editor', 'reviewer', 'admin', 'accountant'));

CREATE TABLE IF NOT EXISTS accounting_user_access (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  store_team TEXT NOT NULL,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id, store_team),
  FOREIGN KEY (team_id, actor_id) REFERENCES app_users(team_id, user_id) ON DELETE CASCADE
);
