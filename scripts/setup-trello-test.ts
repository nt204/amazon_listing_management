export {};

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

const samplePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

async function run() {
  console.log("🔍 Đang kết nối tới Trello...");

  // 1. Get Board info
  const boardRes = await fetch(trelloUrl(`/boards/${boardIdOrShortLink}`));
  if (!boardRes.ok) {
    throw new Error(`Không lấy được thông tin Board Trello (${boardRes.status}): ${await boardRes.text()}`);
  }
  const board = (await boardRes.json()) as { id: string; name: string; url: string };
  console.log(`✅ Đã kết nối Board: "${board.name}" (ID: ${board.id})`);

  // 2. Get Lists in Board
  const listsRes = await fetch(trelloUrl(`/boards/${board.id}/lists`));
  const lists = (await listsRes.json()) as Array<{ id: string; name: string }>;
  console.log(`📋 Danh sách các cột hiện có: ${lists.map((l) => `"${l.name}"`).join(", ")}`);

  let reviewList = lists.find((l) => l.name.trim().toLowerCase() === "team duyệt nội bộ");
  let listingList = lists.find((l) => l.name.trim().toLowerCase() === "listing");

  // Find or fallback to existing lists
  if (!reviewList) {
    reviewList = lists.find((l) => l.name.toLowerCase().includes("to-do") || l.name.toLowerCase().includes("doing")) || lists[0];
    console.log(`ℹ️ Sử dụng cột hiện có cho duyệt nội bộ: "${reviewList.name}" (ID: ${reviewList.id})`);
  }

  if (!listingList) {
    listingList = lists.find((l) => l.name.toLowerCase().includes("done")) || lists[lists.length - 1];
    console.log(`ℹ️ Sử dụng cột hiện có cho Listing: "${listingList.name}" (ID: ${listingList.id})`);
  }

  // Sample cards matching user requirements
  const testCardsData = [
    {
      title: "3CVT0708COW01_Cowgirl 3D Card",
      desc: "generic keywords: cowgirl card, 3d pop up card, birthday gift for cowgirl, western greeting card, handmade pop-up card",
      mockupName: "3CVT0708COW01_mockup.png",
    },
    {
      title: "3CVT0708MUG02_Funny Nurse Coffee Mug",
      desc: "generic keywords: nurse mug, registered nurse gift, funny nurse coffee cup, graduation gift for nurse, healthcare worker appreciation",
      mockupName: "3CVT0708MUG02_mockup.png",
    },
    {
      title: "ORN0809CAT01_Cat Dad Hanging Ornament",
      desc: "generic keywords: cat dad ornament, christmas tree ornament, cat lover gift, pet holiday decor, wooden hanging ornament",
      mockupName: "ORN0809CAT01_mockup.png",
    },
  ];

  console.log("\n📇 Đang tạo các thẻ test mẫu trong cột TEAM DUYỆT NỘI BỘ...");

  for (const item of testCardsData) {
    const cardRes = await fetch(
      trelloUrl("/cards", {
        idList: reviewList.id,
        name: item.title,
        desc: item.desc,
      }),
      { method: "POST" },
    );
    const card = (await cardRes.json()) as { id: string; name: string; url: string };
    console.log(`  ➕ Đã tạo thẻ: "${card.name}" -> ${card.url}`);

    // Attach sample mockup image file
    const formData = new FormData();
    const bytes = Buffer.from(samplePngBase64, "base64");
    const blob = new Blob([bytes], { type: "image/png" });
    formData.append("file", blob, item.mockupName);
    formData.append("name", item.mockupName);

    const attachRes = await fetch(trelloUrl(`/cards/${card.id}/attachments`), {
      method: "POST",
      body: formData,
    });
    if (attachRes.ok) {
      console.log(`     🖼️ Đã đính kèm ảnh mockup: ${item.mockupName}`);
    }
  }

  console.log("\n🎉 HOÀN THÀNH TẠO THẺ TEST VÀ CẤU HÌNH TRELLO!");
}

run().catch((err) => {
  console.error("❌ Lỗi khi khởi tạo thẻ Trello:", err);
  process.exit(1);
});
