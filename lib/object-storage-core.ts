import { createHash } from "node:crypto";

export type ObjectStorageDriver = "database" | "r2";

export type DatabaseObjectStorageConfig = {
  driver: "database";
};

export type R2ObjectStorageConfig = {
  driver: "r2";
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  keyPrefix: string;
};

export type ObjectStorageConfig =
  | DatabaseObjectStorageConfig
  | R2ObjectStorageConfig;

type Environment = Record<string, string | undefined>;

function requiredEnvironmentValue(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required when OBJECT_STORAGE_DRIVER=r2. ` +
        "Add the Cloudflare R2 credentials to .env.",
    );
  }
  return value;
}

export function normalizeObjectKeyPrefix(value: string | undefined) {
  const normalized = (value || "listing-desk")
    .split("/")
    .map((part) => part.trim().replace(/[^A-Za-z0-9._-]+/g, "-"))
    .filter(Boolean)
    .join("/");
  return normalized || "listing-desk";
}

export function readObjectStorageConfig(
  environment: Environment = process.env,
): ObjectStorageConfig {
  const rawDriver = (environment.OBJECT_STORAGE_DRIVER || "database")
    .trim()
    .toLowerCase();
  if (rawDriver !== "database" && rawDriver !== "r2") {
    throw new Error(
      "OBJECT_STORAGE_DRIVER must be either 'database' or 'r2'.",
    );
  }
  if (rawDriver === "database") return { driver: "database" };

  const accountId = environment.R2_ACCOUNT_ID?.trim() || "";
  const configuredEndpoint = environment.R2_ENDPOINT?.trim();
  if (!accountId && !configuredEndpoint) {
    throw new Error(
      "R2_ACCOUNT_ID is required when R2_ENDPOINT is not configured.",
    );
  }

  return {
    driver: "r2",
    accountId,
    bucket: requiredEnvironmentValue(environment, "R2_BUCKET_NAME"),
    accessKeyId: requiredEnvironmentValue(environment, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironmentValue(
      environment,
      "R2_SECRET_ACCESS_KEY",
    ),
    endpoint: (
      configuredEndpoint ||
      `https://${accountId}.r2.cloudflarestorage.com`
    ).replace(/\/+$/, ""),
    keyPrefix: normalizeObjectKeyPrefix(environment.R2_KEY_PREFIX),
  };
}

export function retainDatabaseObjectBytes(
  environment: Environment = process.env,
) {
  return (environment.OBJECT_STORAGE_RETAIN_DATABASE_BYTES || "true")
    .trim()
    .toLowerCase() !== "false";
}

function opaqueTeamSegment(teamId: string) {
  return createHash("sha256").update(teamId).digest("hex").slice(0, 24);
}

function safeIdSegment(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (normalized) return normalized.slice(0, 160);
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function objectExtension(mimeType: string, fallback = "bin") {
  const normalized = mimeType.toLowerCase().split(";", 1)[0].trim();
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/vnd.ms-excel.sheet.macroenabled.12": "xlsm",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "xlsx",
  };
  return extensions[normalized] || fallback.replace(/^\./, "") || "bin";
}

function contentIdentity(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function teamRoot(prefix: string, teamId: string) {
  return `${normalizeObjectKeyPrefix(prefix)}/teams/${opaqueTeamSegment(teamId)}`;
}

export function listingImageObjectKey(input: {
  prefix: string;
  teamId: string;
  listingId: string;
  imageIndex: number;
  variant: "original" | "ai" | "preview";
  mimeType: string;
  bytes: Uint8Array;
  objectId?: string;
}) {
  const digest = contentIdentity(input.bytes);
  const objectPath = input.objectId
    ? `/${safeIdSegment(input.objectId)}`
    : "";
  return `${teamRoot(input.prefix, input.teamId)}/listings/${safeIdSegment(
    input.listingId,
  )}/images/${input.imageIndex}${objectPath}/${input.variant}-${digest}.${objectExtension(
    input.mimeType,
  )}`;
}

export function trelloPreviewObjectKey(input: {
  prefix: string;
  teamId: string;
  cardId: string;
  attachmentId: string;
  variant: "preview" | "thumbnail";
  mimeType: string;
  bytes: Uint8Array;
  objectId?: string;
}) {
  const digest = contentIdentity(input.bytes);
  const objectPath = input.objectId
    ? `/${safeIdSegment(input.objectId)}`
    : "";
  return `${teamRoot(input.prefix, input.teamId)}/trello/${safeIdSegment(
    input.cardId,
  )}/${safeIdSegment(input.attachmentId)}${objectPath}/${input.variant}-${digest}.${objectExtension(
    input.mimeType,
  )}`;
}

export function listingTemplateObjectKey(input: {
  prefix: string;
  teamId: string;
  templateName: string;
  fileExtension: string;
  bytes: Uint8Array;
  objectId?: string;
}) {
  const digest = contentIdentity(input.bytes);
  const nameDigest = createHash("sha256")
    .update(input.templateName.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  const extension = input.fileExtension.toLowerCase().replace(/[^a-z0-9]/g, "");
  const objectPath = input.objectId
    ? `${safeIdSegment(input.objectId)}/`
    : "";
  return `${teamRoot(input.prefix, input.teamId)}/templates/${nameDigest}/${objectPath}${digest}.${
    extension || "xlsx"
  }`;
}
