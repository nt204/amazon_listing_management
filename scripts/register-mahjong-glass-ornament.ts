import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  if (existsSync(".env")) {
    const lines = readFileSync(".env", "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

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
  console.log("🚀 Bắt đầu thêm sản phẩm Mahjong Glass Ornament...");

  if (!apiKey || !token || !boardIdOrShortLink) {
    console.error("❌ Thiếu TRELLO_API_KEY, TRELLO_TOKEN hoặc TRELLO_BOARD_ID trong file .env");
    process.exit(1);
  }

  // 1. Kết nối Board Trello
  const boardRes = await fetch(trelloUrl(`/boards/${boardIdOrShortLink}`));
  if (!boardRes.ok) throw new Error(`Lỗi kết nối Trello Board: ${await boardRes.text()}`);
  const board = (await boardRes.json()) as { id: string; name: string };
  console.log(`✅ Đã kết nối Trello Board: "${board.name}" (${board.id})`);

  // 2. Tìm hoặc tạo cột "TEAM DUYỆT NỘI BỘ"
  const listsRes = await fetch(trelloUrl(`/boards/${board.id}/lists`));
  const lists = (await listsRes.json()) as Array<{ id: string; name: string }>;

  let reviewList = lists.find(
    (l) => l.name.trim().toLowerCase() === "team duyệt nội bộ" || l.name.toLowerCase().includes("duyệt nội bộ"),
  );

  if (!reviewList) {
    console.log("✨ Tạo danh sách 'TEAM DUYỆT NỘI BỘ' mới...");
    const createRes = await fetch(trelloUrl("/lists", { name: "TEAM DUYỆT NỘI BỘ", idBoard: board.id, pos: "top" }), {
      method: "POST",
    });
    reviewList = (await createRes.json()) as { id: string; name: string };
  }
  console.log(`📌 Danh sách đích: "${reviewList.name}" (${reviewList.id})`);

  // 3. Thông tin thẻ sản phẩm Mahjong Glass Ornament
  const skuName = "MAHJ0814MH01_Mahjong Is My Happy Hour Glass Ornament";
  const desc = `Kích thước 3 chiều: 3.1" x 3.1" x 0.15" (Dài: 3.1 in, Rộng: 3.1 in, Dày: 0.15 in).
Chất liệu: Thủy tinh Bevel đúc viền lấp lánh cao cấp (Glass Ornament).
Artwork: "Mahjong is my happy hour" - Ly cocktail trang trí hoa văn gốm lam xanh, kèm các quân bài Mahjong (Phát/發, Bát Tống...) & họa tiết hoa mẫu đơn xanh.

generic keywords: mahjong glass ornament, mahjong christmas ornament, mahjong is my happy hour, mahjong lover gifts, blue porcelain christmas decor, holiday gift for mahjong players, personalized glass ornament, bevel glass ornament`;

  console.log(`\n📌 Đang tạo thẻ Trello: "${skuName}"...`);
  const cardRes = await fetch(
    trelloUrl("/cards", {
      idList: reviewList.id,
      name: skuName,
      desc: desc,
    }),
    { method: "POST" },
  );

  if (!cardRes.ok) {
    throw new Error(`Lỗi khi tạo thẻ Trello: ${await cardRes.text()}`);
  }

  const createdCard = (await cardRes.json()) as { id: string; name: string; url: string };
  console.log(`✨ Đã tạo thẻ Trello thành công: ID=${createdCard.id} -> ${createdCard.url}`);

  // 4. Đính kèm ảnh thiết kế Mahjong Glass Ornament vào thẻ
  const imagePath = join(process.cwd(), "public/samples/mahjong_happy_hour_glass_ornament.jpg");

  if (existsSync(imagePath)) {
    console.log("📸 Đang đính kèm ảnh thiết kế Glass Ornament vào thẻ Trello...");
    const imgBuffer = readFileSync(imagePath);

    const formData = new FormData();
    formData.append("file", new Blob([imgBuffer], { type: "image/jpeg" }), "MAHJ0814MH01_FullDesign.jpg");
    formData.append("name", "MAHJ0814MH01_FullDesign.jpg");

    const attachRes = await fetch(trelloUrl(`/cards/${createdCard.id}/attachments`), {
      method: "POST",
      body: formData,
    });

    if (attachRes.ok) {
      console.log("🎉 Đã đính kèm ảnh thành công: MAHJ0814MH01_FullDesign.jpg!");
    } else {
      console.warn("⚠️ Lỗi khi đính kèm ảnh:", await attachRes.text());
    }
  } else {
    console.warn(`⚠️ Không tìm thấy ảnh tại: ${imagePath}`);
  }

  console.log("\n🚀 HOÀN THÀNH: Đã thêm content Mahjong Glass Ornament thành công lên Trello!");
}

run().catch((err) => {
  console.error("❌ Lỗi khi chạy script:", err);
  process.exit(1);
});
