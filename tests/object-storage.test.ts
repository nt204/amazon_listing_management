import test from "node:test";
import assert from "node:assert/strict";
import {
  listingImageObjectKey,
  listingTemplateObjectKey,
  normalizeObjectKeyPrefix,
  objectExtension,
  readObjectStorageConfig,
  retainDatabaseObjectBytes,
  trelloPreviewObjectKey,
} from "../lib/object-storage-core";

test("object storage defaults to database without requiring R2 secrets", () => {
  assert.deepEqual(readObjectStorageConfig({}), { driver: "database" });
});

test("R2 configuration builds the Cloudflare endpoint and normalizes prefix", () => {
  assert.deepEqual(
    readObjectStorageConfig({
      OBJECT_STORAGE_DRIVER: "r2",
      R2_ACCOUNT_ID: "account-id",
      R2_BUCKET_NAME: "listing-private",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_KEY_PREFIX: " production / listing desk ",
    }),
    {
      driver: "r2",
      accountId: "account-id",
      bucket: "listing-private",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      keyPrefix: "production/listing-desk",
    },
  );
});

test("R2 mode rejects incomplete credentials before making a request", () => {
  assert.throws(
    () =>
      readObjectStorageConfig({
        OBJECT_STORAGE_DRIVER: "r2",
        R2_ACCOUNT_ID: "account-id",
      }),
    /R2_BUCKET_NAME is required/,
  );
});

test("database byte retention is opt-out during the R2 rollout", () => {
  assert.equal(retainDatabaseObjectBytes({}), true);
  assert.equal(
    retainDatabaseObjectBytes({ OBJECT_STORAGE_RETAIN_DATABASE_BYTES: "false" }),
    false,
  );
});

test("object keys are deterministic, content-addressed, and hide team IDs", () => {
  const bytes = Buffer.from("same-content");
  const listingKey = listingImageObjectKey({
    prefix: "listing-desk",
    teamId: "private-team-name",
    listingId: "a4f5377f-bf74-47d3-95ae-fdd09ca95131",
    imageIndex: 2,
    variant: "preview",
    mimeType: "image/webp",
    bytes,
  });
  assert.equal(
    listingKey,
    listingImageObjectKey({
      prefix: "listing-desk",
      teamId: "private-team-name",
      listingId: "a4f5377f-bf74-47d3-95ae-fdd09ca95131",
      imageIndex: 2,
      variant: "preview",
      mimeType: "image/webp",
      bytes,
    }),
  );
  assert.match(listingKey, /\/listings\/a4f5377f-bf74-47d3-95ae-fdd09ca95131\/images\/2\/preview-[a-f0-9]{64}\.webp$/);
  assert.doesNotMatch(listingKey, /private-team-name/);
});

test("Trello and workbook keys preserve their storage type", () => {
  const bytes = Buffer.from("content");
  assert.match(
    trelloPreviewObjectKey({
      prefix: "listing-desk",
      teamId: "team",
      cardId: "card/unsafe",
      attachmentId: "attachment id",
      variant: "thumbnail",
      mimeType: "image/webp",
      bytes,
    }),
    /\/trello\/card-unsafe\/attachment-id\/thumbnail-[a-f0-9]{64}\.webp$/,
  );
  assert.match(
    listingTemplateObjectKey({
      prefix: "listing-desk",
      teamId: "team",
      templateName: "Glass Ornament",
      fileExtension: ".xlsm",
      bytes,
    }),
    /\/templates\/[a-f0-9]{24}\/[a-f0-9]{64}\.xlsm$/,
  );
});

test("known MIME types map to stable object extensions", () => {
  assert.equal(objectExtension("image/jpeg"), "jpg");
  assert.equal(objectExtension("image/webp; charset=binary"), "webp");
  assert.equal(
    objectExtension(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "xlsx",
  );
  assert.equal(normalizeObjectKeyPrefix("///"), "listing-desk");
});
