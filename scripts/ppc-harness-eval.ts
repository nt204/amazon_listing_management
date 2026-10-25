import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeDatabaseConnection } from "../lib/db";
import { buildAiReviewerSystemPrompt, invokeAiReviewer } from "../lib/ppc/ai-reviewer";
import { BASELINE_HARNESS } from "../lib/ppc/ai-reviewer-harness";
import {
  buildReplayDataset,
  loadReplaySourceRows,
  type ReplayCase,
  type ReplayDataset,
  type ReplaySplit,
} from "../lib/ppc/ai-reviewer-replay-dataset";
import { scoreReviewerRun, type ScoredCase } from "../lib/ppc/ai-reviewer-scorer";
import { runWithConcurrency } from "../lib/run-with-concurrency";

// Offline evaluation of a reviewer harness on the replay dataset (P2 + P3). Read-only on the database;
// writes datasets, a response cache and reports under output/ppc-harness/.
//
//   npm run ppc:harness-eval -- --build-only
//   npm run ppc:harness-eval -- --split=dev [--limit=50] [--model=...] [--concurrency=3]
//   npm run ppc:harness-eval -- --split=test --release-test   (held-out window, see ledger below)

const OUTPUT_DIR = path.join(process.cwd(), "output", "ppc-harness");
// Per held-out test window: the baseline plus one release candidate. A new window is needed after that.
const MAX_TEST_RUNS_PER_WINDOW = 2;

function argValue(name: string): string | null {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).trim() : null;
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : null;
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function testWindow(cases: ReplayCase[]): string {
  const dates = cases.map((item) => item.dataAsOf).sort();
  return `${dates[0]}..${dates[dates.length - 1]}`;
}

function guardTestSplit(cases: ReplayCase[], harnessVersion: string) {
  if (!process.argv.includes("--release-test")) {
    throw new Error("Tập test là tập giữ lại cho lần phát hành. Thêm --release-test nếu đây là đánh giá phát hành đã chốt.");
  }
  const ledgerFile = path.join(OUTPUT_DIR, "test-ledger.json");
  const ledger = readJson<{ window: string; harnessVersion: string; usedAt: string }[]>(ledgerFile) || [];
  const window = testWindow(cases);
  const uses = ledger.filter((entry) => entry.window === window);
  if (uses.some((entry) => entry.harnessVersion === harnessVersion)) return;
  if (uses.length >= MAX_TEST_RUNS_PER_WINDOW) {
    throw new Error(`Cửa sổ test ${window} đã dùng cho ${uses.map((entry) => entry.harnessVersion).join(", ")}. Cần dữ liệu mới để có cửa sổ test mới.`);
  }
  writeJson(ledgerFile, [...ledger, { window, harnessVersion, usedAt: new Date().toISOString() }]);
}

async function main() {
  const split = (argValue("split") || "dev") as ReplaySplit;
  if (!["train", "dev", "test"].includes(split)) throw new Error("--split phải là train, dev hoặc test.");
  const limit = Number(argValue("limit") || 0);
  const concurrency = Number(argValue("concurrency") || 3);
  const model = argValue("model") || undefined;
  const datasetArg = argValue("dataset");
  const harness = BASELINE_HARNESS;
  const today = new Date().toISOString().slice(0, 10);

  const dataset = datasetArg
    ? readJson<ReplayDataset>(datasetArg)
    : buildReplayDataset(await loadReplaySourceRows({ storeId: argValue("store-id") }));
  if (!dataset) throw new Error(`Không đọc được dataset ${datasetArg}.`);
  if (!datasetArg) writeJson(path.join(OUTPUT_DIR, `dataset-${today}.json`), dataset);

  const exclusions = dataset.excluded.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`${JSON.stringify({ dataset: dataset.version, splitCounts: dataset.splitCounts, exclusions }, null, 2)}\n`);
  if (process.argv.includes("--build-only")) return;

  let cases = dataset.cases.filter((item) => item.split === split);
  if (cases.length === 0) {
    process.stdout.write(`Không có case nào trong tập ${split}. Chờ thêm outcome 30D MATURE.\n`);
    return;
  }
  if (split === "test") guardTestSplit(cases, harness.version);
  if (limit > 0) cases = cases.slice(0, limit);

  // Cache by prompt content, so an edited prompt without a version bump is never served stale answers.
  const promptHash = createHash("sha256").update(buildAiReviewerSystemPrompt(harness)).digest("hex").slice(0, 12);
  const cacheDir = path.join(OUTPUT_DIR, "cache", `${harness.version}-${promptHash}`, model || "default-model");
  const scored: ScoredCase[] = new Array(cases.length);

  await runWithConcurrency(cases, concurrency, async (replayCase, index) => {
    const cacheFile = path.join(cacheDir, `${replayCase.actionId}.json`);
    const cached = readJson<Omit<ScoredCase, "replayCase">>(cacheFile);
    if (cached) {
      scored[index] = { replayCase, ...cached };
      return;
    }
    const result = await invokeAiReviewer(replayCase.payload, { harness, model });
    const entry = { raw: result.raw_response, validation: result.validation };
    // Invocation errors are not cached so a rerun retries them.
    if (!String(result.validation.fallback_reason || "").startsWith("INVOCATION_ERROR")) writeJson(cacheFile, entry);
    scored[index] = { replayCase, ...entry };
  });

  const report = scoreReviewerRun(scored, { harnessVersion: harness.version, split });
  const reportFile = path.join(OUTPUT_DIR, `report-${harness.version}-${split}-${today}.json`);
  writeJson(reportFile, report);
  process.stdout.write(`${JSON.stringify({ ...report, bySegment: Object.keys(report.bySegment) }, null, 2)}\nReport: ${reportFile}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
