import { readFileSync, existsSync } from "node:fs";

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

async function createCards() {
  console.log("🚀 Đang khởi tạo và tạo các thẻ Trello test từ 2 file Excel/XLSM...");

  // 1. Get Board info
  const boardRes = await fetch(trelloUrl(`/boards/${boardIdOrShortLink}`));
  if (!boardRes.ok) {
    throw new Error(`Lỗi kết nối Board Trello (${boardRes.status}): ${await boardRes.text()}`);
  }
  const board = (await boardRes.json()) as { id: string; name: string };
  console.log(`✅ Đã kết nối Board Trello: "${board.name}" (${board.id})`);

  // 2. Find target list "TEAM DUYỆT NỘI BỘ"
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

  console.log(`📋 Tạo thẻ vào danh sách: "${reviewList.name}" (${reviewList.id})`);

  const cardsToCreate = [
    {
      sku: "HOTT0803WE05C",
      title: "HOTT0803WE05C_Personalized First Year Married Christmas Ornaments 2026",
      desc: "generic keywords: first year married christmas ornaments 2026 personalized; first christmas married gifts; merry and married ornament; customized ornaments for couples; first christmas married ornament 2026; newly wed christmas ornaments 2026",
      images: [
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a798b64774ab83892c16216/download/HOTT0803WE05C_mk0.png", name: "HOTT0803WE05C_mk0.png" },
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a798b6d222f2aed71fe5c9d/download/HOTT0803WE05C_mk1.png", name: "HOTT0803WE05C_mk1.png" },
      ],
    },
    {
      sku: "HOTT0803WE06C",
      title: "HOTT0803WE06C_Personalized First Year Married Christmas Ornament 2026",
      desc: "generic keywords: first year married christmas ornaments 2026 personalized; first christmas married gifts; merry and married ornament; customized ornaments for couples; first christmas married ornament 2026; newly wed christmas ornaments 2026",
      images: [
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a798b749d499900c10e661b/download/HOTT0803WE06C_mk0.png", name: "HOTT0803WE06C_mk0.png" },
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a798b8815497fc7053b1b8c/download/HOTT0803WE06C_mk3.png", name: "HOTT0803WE06C_mk3.png" },
      ],
    },
    {
      sku: "AOTT0731DL01C",
      title: "AOTT0731DL01C_Personalized Golden Retriever Dog Lover Ornament",
      desc: "generic keywords: golden retriever keepsake | dog owner christmas gift | personalized pet decor | holiday tree ornament",
      images: [
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a74642c9a401d4b8bf125a6/download/AOTT0731DL01C_mk0.png", name: "AOTT0731DL01C_mk0.png" },
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a746432c00e48ec9ec81805/download/AOTT0731DL01C_mk1.png", name: "AOTT0731DL01C_mk1.png" },
        { url: "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a746438c87599438c7d3d14/download/AOTT0731DL01C_mk2.png", name: "AOTT0731DL01C_mk2.png" },
      ],
    },
  ];

  for (const cardItem of cardsToCreate) {
    const cardRes = await fetch(
      trelloUrl("/cards", {
        idList: reviewList.id,
        name: cardItem.title,
        desc: cardItem.desc,
      }),
      { method: "POST" },
    );

    if (!cardRes.ok) {
      console.error(`❌ Không thể tạo thẻ "${cardItem.title}":`, await cardRes.text());
      continue;
    }

    const createdCard = (await cardRes.json()) as { id: string; name: string; url: string };
    console.log(`✨ Đã tạo thẻ Trello: "${createdCard.name}" -> ${createdCard.url}`);

    for (const img of cardItem.images) {
      const attachRes = await fetch(
        trelloUrl(`/cards/${createdCard.id}/attachments`, {
          url: img.url,
          name: img.name,
        }),
        { method: "POST" },
      );

      if (attachRes.ok) {
        console.log(`   📸 Đã đính kèm ảnh: ${img.name}`);
      } else {
        console.warn(`   ⚠️ Lỗi đính kèm ảnh ${img.name}:`, await attachRes.text());
      }
    }
  }

  console.log("\n🎉 HOÀN THÀNH TẠO 3 THẺ TRELLO THỬ NGHIỆM THÀNH CÔNG!");
}

createCards().catch(console.error);
