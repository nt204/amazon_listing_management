import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";

const apply = process.argv.includes("--apply");
const keepDays = Math.max(1, Number(process.env.PPC_R2_KEEP_DAYS || 3));
const archiveRoot = process.env.PPC_ARCHIVE_ROOT || path.join(process.env.HOME || "", "AmazonPpcCrawler", "downloads");
const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
const prefixRoot = (process.env.PPC_R2_PREFIX || "ppc-reports").split("/").filter(Boolean).join("/");
const inputPrefix = `${prefixRoot}/input/`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function listObjects(client: S3Client, prefix: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1_000,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function localFilesByName(directory: string): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && /\.(xlsx|csv)$/i.test(entry.name)) {
        files.set(entry.name, (await stat(fullPath)).size);
      }
    }
  };
  await walk(directory);
  return files;
}

async function main() {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  const objects = await listObjects(client, inputPrefix);
  const byDay = new Map<string, _Object[]>();
  for (const object of objects) {
    const relative = (object.Key || "").slice(inputPrefix.length);
    const day = relative.split("/")[0];
    if (!/^\d{8}$/.test(day)) continue;
    const items = byDay.get(day) || [];
    items.push(object);
    byDay.set(day, items);
  }

  const days = [...byDay.keys()].sort().reverse();
  const retained = days.slice(0, keepDays);
  const candidates = days.slice(keepDays);
  console.log(`[Retention] Keeping newest ${keepDays} R2 days: ${retained.join(", ") || "none"}`);

  for (const day of candidates) {
    const localDay = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const localDirectory = path.join(archiveRoot, localDay);
    let localFiles: Map<string, number>;
    try {
      localFiles = await localFilesByName(localDirectory);
    } catch {
      console.warn(`[Retention] KEEP ${day}: local archive directory is missing (${localDirectory}).`);
      continue;
    }

    const dayObjects = byDay.get(day) || [];
    const reports = dayObjects.filter((object) => /\.(xlsx|csv)$/i.test(object.Key || ""));
    const missing = reports.filter((object) => {
      const name = path.basename(object.Key || "");
      return localFiles.get(name) !== Number(object.Size || 0);
    });
    if (!reports.length) {
      const markerOnly = dayObjects.every((object) => (object.Key || "").endsWith("/_COMPLETE.json"));
      if (!markerOnly) {
        console.warn(`[Retention] KEEP ${day}: no report files and non-marker objects are present.`);
        continue;
      }
      console.log(`[Retention] ${apply ? "DELETE" : "DRY RUN"} ${day}: orphan completion marker(s) only.`);
    } else if (missing.length) {
      console.warn(`[Retention] KEEP ${day}: ${missing.length} report file(s) missing or size-mismatched on Mac mini.`);
      continue;
    }

    const bytes = dayObjects.reduce((sum, object) => sum + Number(object.Size || 0), 0);
    if (!apply) {
      console.log(`[Retention] DRY RUN ${day}: verified ${reports.length} reports; would delete ${dayObjects.length} objects (${(bytes / 1_073_741_824).toFixed(2)} GiB).`);
      continue;
    }

    for (let index = 0; index < dayObjects.length; index += 1_000) {
      const chunk = dayObjects.slice(index, index + 1_000).filter((object) => object.Key);
      const response = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((object) => ({ Key: object.Key! })), Quiet: true },
      }));
      if (response.Errors?.length) {
        throw new Error(`R2 deletion failed for ${day}: ${response.Errors.map((item) => item.Key).join(", ")}`);
      }
    }
    console.log(`[Retention] DELETED ${day}: ${dayObjects.length} objects, ${(bytes / 1_073_741_824).toFixed(2)} GiB; Mac archive verified.`);
  }
}

main().catch((error) => {
  console.error(`[Retention] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
