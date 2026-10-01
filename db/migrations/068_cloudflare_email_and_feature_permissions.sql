-- 068_cloudflare_email_and_feature_permissions.sql
-- Ho tro xac thuc qua Cloudflare Access Email, bo bat buoc mat khau va them phan quyen chuc nang (features)

ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS allowed_features TEXT[] NOT NULL DEFAULT ARRAY['listing', 'mockups', 'sellersprite', 'ppc']::TEXT[];

-- Dam bao tai khoan admin ban dau ndtrince@gmail.com luon ton tai va co full quyen
INSERT INTO app_users (
  team_id,
  user_id,
  username,
  display_name,
  password_hash,
  role,
  status,
  allowed_features,
  approved_by,
  approved_at,
  created_at,
  updated_at
) VALUES (
  'default',
  'admin-ndtrince',
  'ndtrince@gmail.com',
  'Admin (ndtrince)',
  NULL,
  'admin',
  'approved',
  ARRAY['listing', 'mockups', 'sellersprite', 'ppc']::TEXT[],
  'system',
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (team_id, LOWER(username)) DO UPDATE SET
  role = 'admin',
  status = 'approved',
  allowed_features = ARRAY['listing', 'mockups', 'sellersprite', 'ppc']::TEXT[],
  updated_at = NOW();

-- Cap nhat cho bat ky tai khoan admin hien tai co day du tat ca features
UPDATE app_users
SET allowed_features = ARRAY['listing', 'mockups', 'sellersprite', 'ppc']::TEXT[]
WHERE role = 'admin';
