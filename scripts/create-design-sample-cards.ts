import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  fetchTrelloBoards,
  fetchTrelloLists,
  createTrelloList,
  createTrelloCard,
  attachFileToTrelloCard,
  extractTrelloBoardId,
} from "../lib/trello";

async function main() {
  const apiKey = process.env.TRELLO_API_KEY || "";
  const token = process.env.TRELLO_TOKEN || "";
  let boardId = extractTrelloBoardId(process.env.TRELLO_BOARD_ID || "");

  if (!apiKey || !token) {
    console.error("❌ Thiếu TRELLO_API_KEY hoặc TRELLO_TOKEN trong môi trường (.env).");
    process.exit(1);
  }

  if (!boardId) {
    console.log("🔍 Chưa có TRELLO_BOARD_ID, đang lấy danh sách Board của bạn...");
    const boards = await fetchTrelloBoards(apiKey, token);
    if (!boards.length) {
      console.error("❌ Không tìm thấy Board Trello nào cho tài khoản này.");
      process.exit(1);
    }
    boardId = boards[0].id;
    console.log(`📌 Sử dụng Board mặc định: "${boards[0].name}" (${boardId})`);
  }

  console.log(`📡 Đang truy vấn các danh sách cột trong Board (${boardId})...`);
  const lists = await fetchTrelloLists(boardId, apiKey, token);

  let designList = lists.find(
    (l) => l.name.trim().toUpperCase() === "DESIGN" || l.name.trim().toLowerCase().includes("design"),
  );

  if (!designList) {
    console.log("✨ Chưa tìm thấy cột 'DESIGN', đang tạo cột 'DESIGN' mới...");
    designList = await createTrelloList(boardId, "DESIGN", apiKey, token);
    console.log(`✅ Đã tạo thành công cột 'DESIGN' (ID: ${designList.id})`);
  } else {
    console.log(`✅ Tìm thấy cột 'DESIGN' (ID: ${designList.id})`);
  }

  const sampleDesigns = [
    {
      skuName: "ONVT0607NT01_Nail Tech Tribute Glass Ornament",
      desc: "Kích thước 3 chiều: 3.1\" x 3.1\" x 0.15\" (Dài: 3.1 in, Rộng: 3.1 in, Dày: 0.15 in).\nChất liệu: Thủy tinh Bevel đúc viền lấp lánh cao cấp.",
      imagePath: join(process.cwd(), "public/samples/nail_tech_glass_ornament.jpg"),
      fileName: "ONVT0607NT01_FullDesign.jpg",
    },
    {
      skuName: "CONSTR2026_Construction Christmas Glass Ornament",
      desc: "Kích thước 3 chiều: 3.5\" x 3.5\" x 0.15\" (Dài: 3.5 in, Rộng: 3.5 in, Dày: 0.15 in).\nChất liệu: Thủy tinh Bevel đúc viền trong suốt.",
      imagePath: join(process.cwd(), "public/samples/construction_vehicles_glass_ornament.jpg"),
      fileName: "CONSTR2026_FullDesign.jpg",
    },
  ];

  for (const item of sampleDesigns) {
    console.log(`\n📌 Đang tạo thẻ Trello DESIGN: "${item.skuName}"...`);
    const card = await createTrelloCard(designList.id, item.skuName, item.desc, apiKey, token);
    console.log(`   ✅ Đã tạo thẻ: ID=${card.id}`);

    if (existsSync(item.imagePath)) {
      console.log(`   🖼️ Đang đính kèm ảnh full design vào thẻ...`);
      const fileBuf = readFileSync(item.imagePath);
      await attachFileToTrelloCard(card.id, fileBuf, item.fileName, "image/jpeg", apiKey, token);
      console.log(`   🎉 Đính kèm thành công: ${item.fileName}`);
    } else {
      console.warn(`   ⚠️ Không tìm thấy file ảnh tại: ${item.imagePath}`);
    }
  }

  console.log("\n🚀 HOÀN THÀNH: Đã tạo 2 thẻ DESIGN mẫu thành công trên Trello!");
}

main().catch((err) => {
  console.error("❌ Lỗi khi khởi tạo thẻ DESIGN:", err);
  process.exit(1);
});
