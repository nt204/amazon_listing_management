-- Migration 101: Add 'mockups' to Lark notification categories
ALTER TABLE lark_notification_preferences DROP CONSTRAINT IF EXISTS lark_notification_preferences_category_check;
ALTER TABLE lark_notification_preferences ADD CONSTRAINT lark_notification_preferences_category_check
  CHECK (category IN ('listing', 'mockups', 'ppc', 'accounting'));

ALTER TABLE lark_team_notification_rules DROP CONSTRAINT IF EXISTS lark_team_notification_rules_category_check;
ALTER TABLE lark_team_notification_rules ADD CONSTRAINT lark_team_notification_rules_category_check
  CHECK (category IN ('listing', 'mockups', 'ppc', 'accounting'));
