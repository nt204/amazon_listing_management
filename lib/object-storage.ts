import "server-only";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  readObjectStorageConfig,
  type R2ObjectStorageConfig,
} from "@/lib/object-storage-core";

type StoredObject = {
  bytes: Buffer;
  contentType: string | undefined;
  contentLength: number;
  metadata: Record<string, string>;
  etag: string | undefined;
};

const globalForObjectStorage = globalThis as unknown as {
  r2Client?: S3Client;
  r2ClientFingerprint?: string;
};

function r2Configuration() {
  const config = readObjectStorageConfig();
  if (config.driver !== "r2") {
    throw new Error(
      "Cloudflare R2 is disabled. Set OBJECT_STORAGE_DRIVER=r2 after configuring R2 credentials.",
    );
  }
  return config;
}

function r2Client(config: R2ObjectStorageConfig) {
  const fingerprint = [
    config.endpoint,
    config.accessKeyId,
    config.bucket,
  ].join("|");
  if (
    !globalForObjectStorage.r2Client ||
    globalForObjectStorage.r2ClientFingerprint !== fingerprint
  ) {
    globalForObjectStorage.r2Client?.destroy();
    globalForObjectStorage.r2Client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    globalForObjectStorage.r2ClientFingerprint = fingerprint;
  }
  return globalForObjectStorage.r2Client;
}

export function objectStorageDriver() {
  return readObjectStorageConfig().driver;
}

export function r2KeyPrefix() {
  return r2Configuration().keyPrefix;
}

export async function putStoredObject(input: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  metadata?: Record<string, string>;
}) {
  const config = r2Configuration();
  const client = r2Client(config);
  const response = await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.bytes,
      ContentType: input.contentType,
      ContentLength: input.bytes.byteLength,
      Metadata: {
        sha256: input.sha256,
        ...input.metadata,
      },
    }),
  );
  return {
    key: input.key,
    size: input.bytes.byteLength,
    etag: response.ETag,
  };
}

function isMissingObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound"
  );
}

export async function getStoredObject(key: string): Promise<StoredObject | null> {
  const config = r2Configuration();
  try {
    const response = await r2Client(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`R2 object '${key}' returned an empty response body.`);
    }
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    return {
      bytes,
      contentType: response.ContentType,
      contentLength: response.ContentLength ?? bytes.byteLength,
      metadata: response.Metadata || {},
      etag: response.ETag,
    };
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

export async function headStoredObject(key: string) {
  const config = r2Configuration();
  try {
    const response = await r2Client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      metadata: response.Metadata || {},
      etag: response.ETag,
    };
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

export async function deleteStoredObjects(keys: readonly string[]) {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (uniqueKeys.length === 0) return;
  const config = r2Configuration();
  const client = r2Client(config);
  for (let start = 0; start < uniqueKeys.length; start += 1_000) {
    const batch = uniqueKeys.slice(start, start + 1_000);
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: {
          Quiet: true,
          Objects: batch.map((Key) => ({ Key })),
        },
      }),
    );
    if (response.Errors?.length) {
      throw new Error(
        `R2 failed to delete ${response.Errors.length} object(s): ${response.Errors.map(
          (error) => error.Key || error.Code || "unknown",
        ).join(", ")}`,
      );
    }
  }
}

export async function checkObjectStorageHealth() {
  const config = readObjectStorageConfig();
  if (config.driver === "database") {
    return { driver: "database" as const, status: "ready" as const };
  }
  await r2Client(config).send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: `${config.keyPrefix}/`,
      MaxKeys: 1,
    }),
  );
  return {
    driver: "r2" as const,
    status: "ready" as const,
    bucket: config.bucket,
    prefix: config.keyPrefix,
  };
}

export async function runObjectStorageProbe() {
  const config = r2Configuration();
  const key = `${config.keyPrefix}/.health/probe-${crypto.randomUUID()}.txt`;
  const bytes = Buffer.from(`listing-desk-r2-probe:${Date.now()}`, "utf8");
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    await putStoredObject({
      key,
      bytes,
      contentType: "text/plain; charset=utf-8",
      sha256,
      metadata: { purpose: "health-check" },
    });
    const downloaded = await getStoredObject(key);
    if (!downloaded || !downloaded.bytes.equals(bytes)) {
      throw new Error("R2 probe upload succeeded but downloaded bytes did not match.");
    }
    return {
      driver: "r2" as const,
      bucket: config.bucket,
      prefix: config.keyPrefix,
      bytes: bytes.byteLength,
      sha256,
    };
  } finally {
    await deleteStoredObjects([key]).catch((error) => {
      console.warn("[R2] Could not remove the storage probe object:", error);
    });
  }
}

