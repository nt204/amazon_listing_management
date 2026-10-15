import { readFileSync, existsSync } from "node:fs";
import { saveHelium10PlaywrightCookies, validateHelium10Session } from "../lib/helium10-playwright";

async function main() {
  const customPath = process.argv[2];
  const fallbackPath = "./config/helium10-cookies.json";
  const path = customPath && existsSync(customPath) ? customPath : fallbackPath;

  if (!existsSync(path)) {
    console.error("Cookie file not found at", path);
    process.exit(1);
  }

  const raw = readFileSync(path, "utf8");
  console.log("Read cookie file from:", path, "size:", raw.length);

  const check = await validateHelium10Session(raw);
  console.log("Validation check:", check);

  if (!check.valid) {
    console.error("Cookie validation failed:", check.error);
    process.exit(1);
  }

  const saved = await saveHelium10PlaywrightCookies(raw);
  console.log("Successfully saved Helium 10 Diamond config:", {
    status: saved.status,
    plan: saved.plan,
    accountId: saved.accountId,
    updatedAt: saved.updatedAt,
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
