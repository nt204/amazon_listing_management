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

const mock1a = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/cowgirl_glass_ornament_mockup_1786373290179.png";
const mock1b = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/cowgirl_glass_ornament_detail_mockup_1786373729311.png";

const mock2aReal = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/nurse_mug_mockup_1786373484880.png";
const mock2b = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/nurse_mug_gift_mockup_1786373752202.png";

const mock3a = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/cat_dad_ornament_mockup_1786373505606.png";
const mock3b = "/Users/macbook/.gemini/antigravity-ide/brain/eab92aab-919d-49d8-86dd-983c8603de80/cat_dad_ornament_lifestyle_mockup_1786373769033.png";

export async function resetAndCreateCards() {
  console.log("🧹 1. Lấy danh sách thẻ hiện tại trên Board Trello...");

  const boardRes = await fetch(trelloUrl(`/boards/${boardIdOrShortLink}`));
  if (!boardRes.ok) {
    throw new Error(`Lỗi kết nối Board Trello (${boardRes.status}): ${await boardRes.text()}`);
  }
  const board = (await boardRes.json()) as { id: string; name: string };
  console.log(`✅ Đã kết nối Board: "${board.name}" (ID: ${board.id})`);

  // Fetch all cards on the board
  const allCardsRes = await fetch(trelloUrl(`/boards/${board.id}/cards`));
  const existingCards = (await allCardsRes.json()) as Array<{ id: string; name: string }>;

  console.log(`🗑️ 2. Xóa sạch ${existingCards.length} thẻ cũ trên Board Trello...`);
  for (const card of existingCards) {
    const delRes = await fetch(trelloUrl(`/cards/${card.id}`), { method: "DELETE" });
    if (delRes.ok) {
      console.log(`   ❌ Đã xóa thẻ cũ: "${card.name}" (${card.id})`);
    } else {
      console.warn(`   ⚠️ Không xóa được thẻ ${card.id}: ${await delRes.text()}`);
    }
  }

  // 3. Find or Create "TEAM DUYỆT NỘI BỘ" list
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

  console.log(`\n✨ 3. Tạo lại 3 thẻ mẫu mới tinh chuẩn 3 Templates vào cột "${reviewList.name}"...`);

  const sampleCards = [
    {
      title: "HOTT0803WE05C_Glass Ornament Cowgirl 3D",
      desc: "generic keywords: glass ornament, cowgirl ornament, 3d christmas tree decoration, holiday gift for cowgirl, personalized ornament",
      mockups: [
        { file: mock1a, name: "HOTT0803WE05C_mockup_main.png" },
        { file: mock1b, name: "HOTT0803WE05C_mockup_detail.png" },
      ],
    },
    {
      title: "3CVT0708MUG02_Funny Nurse Coffee Mug",
      desc: "generic keywords: nurse coffee mug, registered nurse gift, funny nurse present, healthcare worker appreciation, graduation gift",
      mockups: [
        { file: mock2aReal, name: "3CVT0708MUG02_mockup_main.png" },
        { file: mock2b, name: "3CVT0708MUG02_mockup_scene.png" },
      ],
    },
    {
      title: "ORN0809CAT01_Cat Dad Hanging Ornament",
      desc: "generic keywords: cat dad ornament, christmas tree ornament, cat lover gift, pet holiday decor, custom ornament",
      mockups: [
        { file: mock3a, name: "ORN0809CAT01_mockup_main.png" },
        { file: mock3b, name: "ORN0809CAT01_mockup_detail.png" },
      ],
    },
  ];

  for (const item of sampleCards) {
    const cardRes = await fetch(
      trelloUrl("/cards", {
        idList: reviewList.id,
        name: item.title,
        desc: item.desc,
      }),
      { method: "POST" },
    );

    if (!cardRes.ok) {
      console.error(`❌ Không tạo được thẻ "${item.title}": ${await cardRes.text()}`);
      continue;
    }

    const card = (await cardRes.json()) as { id: string; name: string; url: string };
    console.log(`✅ Đã tạo thẻ mới: "${card.name}" -> ${card.url}`);

    for (const mock of item.mockups) {
      if (existsSync(mock.file)) {
        const buffer = readFileSync(mock.file);
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
        formData.append("file", blob, mock.name);
        formData.append("name", mock.name);

        const attachRes = await fetch(trelloUrl(`/cards/${card.id}/attachments`), {
          method: "POST",
          body: formData,
        });

        if (attachRes.ok) {
          console.log(`   📸 Đã đính kèm ảnh mockup: ${mock.name}`);
        } else {
          console.warn(`   ⚠️ Lỗi đính kèm ảnh: ${await attachRes.text()}`);
        }
      }
    }
  }

  console.log("\n🎉 HOÀN THÀNH XÓA SẠCH VÀ TẠO LẠI 3 THẺ MẪU MỚI TINH TRÊN TRELLO!");
  return true;
}

if (require.main === module) {
  resetAndCreateCards().catch(console.error);
}
