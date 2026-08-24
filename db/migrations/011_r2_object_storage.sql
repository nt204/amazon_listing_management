ALTER TABLE listing_images
  ADD COLUMN IF NOT EXISTS original_object_key TEXT,
  ADD COLUMN IF NOT EXISTS original_byte_size INTEGER,
  ADD COLUMN IF NOT EXISTS ai_object_key TEXT,
  ADD COLUMN IF NOT EXISTS ai_byte_size INTEGER,
  ADD COLUMN IF NOT EXISTS preview_object_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_byte_size INTEGER;

UPDATE listing_images
SET
  original_byte_size = COALESCE(original_byte_size, OCTET_LENGTH(image_bytes)),
  ai_byte_size = COALESCE(ai_byte_size, OCTET_LENGTH(ai_image_bytes)),
  preview_byte_size = COALESCE(preview_byte_size, OCTET_LENGTH(preview_image_bytes));

ALTER TABLE listing_images ALTER COLUMN image_bytes DROP NOT NULL;

ALTER TABLE listing_images
  DROP CONSTRAINT IF EXISTS listing_images_original_storage_check;
ALTER TABLE listing_images
  ADD CONSTRAINT listing_images_original_storage_check
  CHECK (image_bytes IS NOT NULL OR original_object_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS listing_images_original_object_idx
  ON listing_images(original_object_key)
  WHERE original_object_key IS NOT NULL;

ALTER TABLE trello_image_previews
  ADD COLUMN IF NOT EXISTS object_key TEXT,
  ADD COLUMN IF NOT EXISTS image_byte_size INTEGER;

UPDATE trello_image_previews
SET image_byte_size = COALESCE(image_byte_size, OCTET_LENGTH(image_bytes));

ALTER TABLE trello_image_previews ALTER COLUMN image_bytes DROP NOT NULL;

ALTER TABLE trello_image_previews
  DROP CONSTRAINT IF EXISTS trello_image_previews_storage_check;
ALTER TABLE trello_image_previews
  ADD CONSTRAINT trello_image_previews_storage_check
  CHECK (image_bytes IS NOT NULL OR object_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS trello_image_previews_object_idx
  ON trello_image_previews(object_key)
  WHERE object_key IS NOT NULL;

ALTER TABLE listing_templates
  ADD COLUMN IF NOT EXISTS workbook_object_key TEXT,
  ADD COLUMN IF NOT EXISTS workbook_byte_size INTEGER;

UPDATE listing_templates
SET workbook_byte_size = COALESCE(workbook_byte_size, OCTET_LENGTH(workbook_bytes));

ALTER TABLE listing_templates ALTER COLUMN workbook_bytes DROP NOT NULL;

ALTER TABLE listing_templates
  DROP CONSTRAINT IF EXISTS listing_templates_workbook_storage_check;
ALTER TABLE listing_templates
  ADD CONSTRAINT listing_templates_workbook_storage_check
  CHECK (workbook_bytes IS NOT NULL OR workbook_object_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS listing_templates_workbook_object_idx
  ON listing_templates(workbook_object_key)
  WHERE workbook_object_key IS NOT NULL;
