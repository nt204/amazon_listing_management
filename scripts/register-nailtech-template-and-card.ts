import { readFileSync } from "node:fs";
import { inspectListingTemplate } from "../lib/excel-automation";
import { saveListingTemplate, checkDatabaseHealth } from "../lib/db";

const apiKey = process.env.TRELLO_API_KEY || "";
const token = process.env.TRELLO_TOKEN || "";
const boardIdOrShortLink = process.env.TRELLO_BOARD_ID || "";
const TRELLO_BASE = "https://api.trello.com/1";

function trelloUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TRELLO_BASE}${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function run() {
  console.log("🚀 Bắt đầu khởi tạo Template và Thẻ sản phẩm ONVT0607NT01...");

  // 1. Save Template into DB
  const templatePath = "examples/GlassOrnament-ONVT0607NT01_TEST.xlsm";
  const buffer = readFileSync(templatePath);
  const metadata = await inspectListingTemplate(buffer, "GlassOrnament-ONVT0607NT01_TEST.xlsm");

  try {
    await checkDatabaseHealth();
    const savedTemplate = await saveListingTemplate({ teamId: "default", actorId: "system" }, {
      name: "ONVT0607NT01: Nail Tech Ornament Template",
      originalFilename: "GlassOrnament-ONVT0607NT01_TEST.xlsm",
      fileExtension: "xlsm",
      productType: metadata.product_type,
      metadata,
      workbook: buffer,
    });
    console.log("✅ Đã đăng ký Template thành công vào CSDL:", savedTemplate.id, savedTemplate.name);
  } catch {
    console.warn("⚠️ PostgreSQL database không thể kết nối. Tiến hành tạo thẻ Trello trực tiếp.");
  }

  // 2. Connect to Trello Board & List
  const boardRes = await fetch(trelloUrl(`/boards/${boardIdOrShortLink}`));
  if (!boardRes.ok) throw new Error(`Lỗi kết nối Trello Board: ${await boardRes.text()}`);
  const board = (await boardRes.json()) as { id: string; name: string };

  const listsRes = await fetch(trelloUrl(`/boards/${board.id}/lists`));
  const lists = (await listsRes.json()) as Array<{ id: string; name: string }>;

  let reviewList = lists.find(
    (l) => l.name.trim().toLowerCase() === "team duyệt nội bộ" || l.name.toLowerCase().includes("duyệt nội bộ"),
  );

  if (!reviewList) {
    const createRes = await fetch(trelloUrl("/lists", { name: "TEAM DUYỆT NỘI BỘ", idBoard: board.id, pos: "top" }), {
      method: "POST",
    });
    reviewList = (await createRes.json()) as { id: string; name: string };
  }

  // 3. Create Trello Card for ONVT0607NT01
  const cardTitle = "ONVT0607NT01_Nail Tech Ornament";
  const cardDesc = "generic keywords: nail tech ornaments chrismas";

  const cardRes = await fetch(
    trelloUrl("/cards", {
      idList: reviewList.id,
      name: cardTitle,
      desc: cardDesc,
    }),
    { method: "POST" },
  );

  if (!cardRes.ok) {
    throw new Error(`Lỗi khi tạo thẻ Trello: ${await cardRes.text()}`);
  }

  const createdCard = (await cardRes.json()) as { id: string; name: string; url: string };
  console.log(`✨ Đã tạo thành công thẻ Trello: "${createdCard.name}" -> ${createdCard.url}`);

  // 4. Attach mockup image to Trello Card using multipart/form-data
  const imagePath = "/Users/macbook/.gemini/antigravity-ide/brain/bac23083-0fec-469b-b19a-ee7f752999ee/media__1786416571846.jpg";
  const imgBuffer = readFileSync(imagePath);

  const formData = new FormData();
  formData.append("file", new Blob([imgBuffer], { type: "image/jpeg" }), "ONVT0607NT01_mk0.jpg");
  formData.append("name", "ONVT0607NT01_mk0.jpg");

  const attachRes = await fetch(trelloUrl(`/cards/${createdCard.id}/attachments`), {
    method: "POST",
    body: formData,
  });

  if (attachRes.ok) {
    console.log("📸 Đã đính kèm ảnh mockup ONVT0607NT01_mk0.jpg vào thẻ Trello!");
  } else {
    console.warn("⚠️ Lỗi đính kèm ảnh mockup:", await attachRes.text());
  }

  console.log("\n🎉 HOÀN THÀNH TẠO THẺ VÀ TEMPLATE CHO ONVT0607NT01!");
}

run().catch(console.error);
