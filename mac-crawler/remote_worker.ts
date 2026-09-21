import { acquireCrawlerLock, loadEnv, getStoreList, crawlStore, type StoreTarget } from "./crawler";

loadEnv();

const WEB_APP_URL = (process.env.WEB_APP_URL || "http://localhost:2411").replace(/\/+$/, "");
const AUTH_TOKEN = process.env.WEB_APP_AUTH_TOKEN || "";
const POLL_INTERVAL_MS = 5000; // 5 giây hỏi 1 lần

console.log("============================================================");

if (!AUTH_TOKEN) throw new Error("Thiếu WEB_APP_AUTH_TOKEN trong config.env.");
console.log("[MAC REMOTE WORKER] KHỞI ĐỘNG TIẾN TRÌNH LẮNG NGHE LỆNH TỪ SERVER");
console.log(`Server URL: ${WEB_APP_URL}`);
console.log(`Chu kỳ thăm dò: ${POLL_INTERVAL_MS / 1000}s`);
console.log("============================================================");

function getHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
    Origin: WEB_APP_URL,
  };
}

async function updateJob(
  jobId: string,
  data: {
    status?: "RUNNING" | "COMPLETED" | "FAILED";
    progress_pct?: number;
    current_step?: string;
    error_message?: string;
    processed_files?: number;
  },
) {
  const response = await fetch(`${WEB_APP_URL}/api/ppc/crawler/job`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ jobId, ...data }),
  });
  if (!response.ok) throw new Error(`Server từ chối cập nhật job (${response.status}): ${await response.text()}`);
}

async function triggerServerSync(): Promise<string> {
  try {
    const res = await fetch(`${WEB_APP_URL}/api/ppc/sync-r2`, {
      method: "POST",
      headers: getHeaders(),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Server sync thất bại (${res.status}): ${body}`);
    const data = JSON.parse(body);
    if (data.success === false || data.result?.failed > 0) {
      throw new Error(data.message || `Server báo ${data.result?.failed || 0} file ingest lỗi.`);
    }
    return data.message || "Đã đồng bộ R2 thành công.";
  } catch (err) {
    throw new Error(`Lỗi gọi sync-r2: ${(err as Error).message}`);
  }
}

async function processJob(job: { id: string; store_name: string }) {
  const jobId = job.id;
  const targetStoreName = job.store_name;

  console.log(`\n============================================================`);
  console.log(`[Worker] NHẬN LỆNH CRAWL TỪ SERVER! Job ID: ${jobId}`);
  console.log(`Mục tiêu Store: [${targetStoreName}]`);
  console.log(`============================================================`);

  let releaseLock: (() => void) | undefined;
  try {
    const allConfiguredStores = getStoreList();
    let storesToCrawl: StoreTarget[] = [];
    if (targetStoreName === "ALL") {
      storesToCrawl = allConfiguredStores;
    } else {
      const match = allConfiguredStores.find((s) => s.store_name.toLowerCase() === targetStoreName.toLowerCase());
      if (!match) throw new Error(`Store "${targetStoreName}" chưa được map trong stores.json; từ chối fallback để tránh lẫn dữ liệu.`);
      storesToCrawl = [match];
    }
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    releaseLock = acquireCrawlerLock();
    await updateJob(jobId, { progress_pct: 5, current_step: "Máy Mac đã khóa pipeline, chuẩn bị mở AdsPower..." });
    let totalFilesCrawled = 0;

    for (let i = 0; i < storesToCrawl.length; i++) {
      const store = storesToCrawl[i];
      const basePct = Math.round((i / storesToCrawl.length) * 80) + 5;
      const stepPctRange = Math.round(80 / storesToCrawl.length);

      console.log(`[Worker] Đang xử lý store ${i + 1}/${storesToCrawl.length}: [${store.store_name}]`);

      const files = await crawlStore(store, todayStr, async (stepDesc, percentWithinStore) => {
        const currentTotalPct = basePct + Math.round((percentWithinStore / 100) * stepPctRange);
        await updateJob(jobId, {
          progress_pct: Math.min(85, currentTotalPct),
          current_step: `[${store.store_name}] ${stepDesc}`,
        });
      });

      totalFilesCrawled += files.length;
    }

    // Bước đồng bộ Server từ R2
    await updateJob(jobId, {
      progress_pct: 90,
      current_step: "Đã tải & đẩy R2 xong! Đang kích hoạt Server nạp vào Database...",
      processed_files: totalFilesCrawled,
    });

    const syncMsg = await triggerServerSync();
    console.log(`[Worker] Kết quả đồng bộ Server: ${syncMsg}`);

    // Báo cáo hoàn tất
    await updateJob(jobId, {
      status: "COMPLETED",
      progress_pct: 100,
      current_step: `Hoàn tất xuất sắc! Đã tải ${totalFilesCrawled} file và đồng bộ vào DB.`,
      processed_files: totalFilesCrawled,
    });

    console.log(`\n[Worker] => JOB ${jobId} ĐÃ HOÀN TẤT THÀNH CÔNG!`);
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[Worker] => JOB ${jobId} THẤT BẠI: ${errorMsg}`);
    await updateJob(jobId, {
      status: "FAILED",
      error_message: errorMsg,
      current_step: `Lỗi: ${errorMsg}`,
    }).catch((updateError) => console.error(`[Worker] Không thể báo lỗi về server: ${(updateError as Error).message}`));
  } finally {
    releaseLock?.();
  }
}

async function startLoop() {
  let isProcessing = false;

  setInterval(async () => {
    if (isProcessing) return;

    try {
      const res = await fetch(`${WEB_APP_URL}/api/ppc/crawler/job?action=poll`, {
        headers: getHeaders(),
      });

      if (!res.ok) {
        return;
      }

      const data = await res.json();
      if (data.hasJob && data.job) {
        isProcessing = true;
        try { await processJob(data.job); } finally { isProcessing = false; }
      }
    } catch {
      // Server offline hoặc chưa khởi động, tiếp tục thăm dò
    }
  }, POLL_INTERVAL_MS);
}

startLoop();
