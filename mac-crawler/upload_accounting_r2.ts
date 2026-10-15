import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function loadEnv() {
  const envPath = path.join(__dirname, "config.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...vals] = line.split("=");
      const val = vals.join("=").trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val.replace("$HOME", os.homedir());
      }
    }
  }
}

async function uploadAccountingFilesToR2() {
  loadEnv();

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.ACCOUNTING_R2_PREFIX || "accounting-reports").replace(/^\/+|\/+$/g, "");

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("[LỖI R2] Thiếu thông tin R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY trong config.env!");
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const baseDir = process.env.ACCOUNTING_DOWNLOAD_DIR || path.join(os.homedir(), "AmazonAccounting", "downloads");
  if (!fs.existsSync(baseDir)) {
    console.log(`[R2] Thư mục ${baseDir} không tồn tại.`);
    return;
  }

  const requestedDate = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error(`--date không hợp lệ: ${requestedDate}. Dùng YYYY-MM-DD.`);
  }
  const dateDirs = (requestedDate ? [requestedDate] : fs.readdirSync(baseDir))
    .filter((d) => !d.startsWith(".") && fs.existsSync(path.join(baseDir, d)) && fs.statSync(path.join(baseDir, d)).isDirectory());
  let uploadedCount = 0;

  for (const dateStr of dateDirs.sort()) {
    const datePath = path.join(baseDir, dateStr);
    const storeDirs = fs.readdirSync(datePath).filter((s) => !s.startsWith(".") && fs.statSync(path.join(datePath, s)).isDirectory());

    for (const storeName of storeDirs.sort()) {
      const storePath = path.join(datePath, storeName);
      const files = fs.readdirSync(storePath).filter((f) => !f.startsWith(".") && f !== "manifest.json" && fs.statSync(path.join(storePath, f)).isFile());

      for (const fileName of files.sort()) {
        const filePath = path.join(storePath, fileName);
        const fileBuffer = fs.readFileSync(filePath);
        const r2Key = `${prefix}/${dateStr}/${storeName}/${fileName}`;
        const sizeMb = (fileBuffer.length / (1024 * 1024)).toFixed(2);

        console.log(`[R2 UPLOAD] Đang tải lên R2: ${r2Key} (${sizeMb} MB)...`);
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: r2Key,
              Body: fileBuffer,
              ContentType: fileName.endsWith(".csv")
                ? "text/csv"
                : fileName.endsWith(".tsv") || fileName.endsWith(".txt")
                ? "text/tab-separated-values"
                : "application/octet-stream",
            }),
          );
          uploadedCount++;
        } catch (err: any) {
          console.error(`[LỖI R2] Không tải được ${fileName}:`, err?.message || err);
        }
      }
    }
  }

  console.log(`\n✅ [HOÀN TẤT R2] Đã đồng bộ thành công ${uploadedCount} file kế toán lên Cloudflare R2 (${bucket}/${prefix}/)!`);
}

uploadAccountingFilesToR2().catch((e) => {
  console.error("[LỖI KHÔNG MONG MUỐN]", e);
  process.exit(1);
});
