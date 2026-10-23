-- Migration 100: Allow configuring notification categories per channel
ALTER TABLE lark_team_notification_rules DROP CONSTRAINT IF EXISTS lark_team_notification_rules_pkey;
DELETE FROM lark_team_notification_rules WHERE channel_id IS NULL;
ALTER TABLE lark_team_notification_rules ALTER COLUMN channel_id SET NOT NULL;
ALTER TABLE lark_team_notification_rules DROP CONSTRAINT IF EXISTS lark_team_notification_rules_channel_id_fkey;
ALTER TABLE lark_team_notification_rules ADD CONSTRAINT lark_team_notification_rules_channel_id_fkey 
  FOREIGN KEY (channel_id) REFERENCES lark_team_channels(id) ON DELETE CASCADE;
ALTER TABLE lark_team_notification_rules ADD CONSTRAINT lark_team_notification_rules_pkey 
  PRIMARY KEY (team_id, channel_id, category);
