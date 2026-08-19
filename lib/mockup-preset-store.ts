import type {
  MockupContentItem,
  ProductCategoryPreset,
  PresetExportPayload,
} from "../types/mockup-preset";

export const CUSTOM_PRESETS_STORAGE_KEY = "listing_desk_custom_presets_v1";

export const SYSTEM_PRESETS: ProductCategoryPreset[] = [
  {
    id: "universal_standard",
    label: "Hanging Ornament",
    icon: "🎄",
    isSystem: true,
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng CTR", checked: true, promptKey: "universal_main_white" },
      { id: 2, label: "Ảnh 2: Bối Cảnh Thực Tế", checked: true, promptKey: "universal_lifestyle" },
      { id: 3, label: "Ảnh 3: Kích Thước 3D", checked: true, promptKey: "universal_dimensions" },
      { id: 4, label: "Ảnh 4: Chất Liệu & Độ Dày", checked: true, promptKey: "universal_features_zoom" },
      { id: 5, label: "Ảnh 5: Trao Quà Tay Trao Tay", checked: true, promptKey: "universal_gifting" },
      { id: 6, label: "Ảnh 6: Hộp Quà & Phụ Kiện", checked: true, promptKey: "universal_packaging" },
      { id: 7, label: "Ảnh 7: Card Thiệp Theo Chủ Đề", checked: true, promptKey: "universal_artwork_macro" },
    ],
  },
  {
    id: "bullet_tumbler",
    label: "Bullet Tumbler",
    icon: "🍾",
    isSystem: true,
    contents: [
      { id: 1, label: "Ảnh 1: Thiết Kế Nền Trắng", checked: true, promptKey: "full_design" },
      { id: 2, label: "Ảnh 2: Cách Nhiệt & Hộp Quà", checked: true, promptKey: "bullet_insulation_box" },
      { id: 3, label: "Ảnh 3: Kích Thước 17oz", checked: true, promptKey: "bullet_capacity_size" },
      { id: 4, label: "Ảnh 4: Nắp Bấm & Rót Cốc", checked: true, promptKey: "bullet_press_lid_pour" },
      { id: 5, label: "Ảnh 5: Cắm Trại Dã Ngoại", checked: true, promptKey: "bullet_outdoor_camping" },
      { id: 6, label: "Ảnh 6: Hộc Để Cốc Ô Tô", checked: true, promptKey: "bullet_car_cupholder" },
      { id: 7, label: "Ảnh 7: Quà Tặng Cho Nam", checked: true, promptKey: "bullet_men_gifting" },
    ],
  },
  {
    id: "slate_plate",
    label: "Slate Plate",
    icon: "🪨",
    isSystem: true,
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng Chân Đế", checked: true, promptKey: "slate_main_white" },
      { id: 2, label: "Ảnh 2: Đá Tự Nhiên & Kháng Nước", checked: true, promptKey: "slate_features_infographic" },
      { id: 3, label: "Ảnh 3: Kích Thước & Chân Đế", checked: true, promptKey: "slate_dimensions_size" },
      { id: 4, label: "Ảnh 4: Mặt Trước & Sau Đá Đen", checked: true, promptKey: "slate_front_back_stack" },
      { id: 5, label: "Ảnh 5: Trang Trí Nổi Bật (Home Decor)", checked: true, promptKey: "slate_home_decor_lifestyle" },
      { id: 6, label: "Ảnh 6: Quà Tặng Tri Ơn & Ý Nghĩa", checked: true, promptKey: "slate_gifting_emotion" },
      { id: 7, label: "Ảnh 7: Hộp Quà Retail & Phụ Kiện", checked: true, promptKey: "slate_packaging_box" },
    ],
  },
];

export const MATERIAL_STARTERS: Array<{
  id: string;
  label: string;
  icon: string;
  description: string;
  contents: MockupContentItem[];
}> = [
  {
    id: "starter_glass",
    label: "Phôi Kính / Acrylic Trong Suốt",
    icon: "🔮",
    description: "Kính crystal trong suốt, vát cạnh kim cương, phản xạ ánh sáng cao cấp.",
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng CTR Gốc", checked: true, promptKey: "universal_main_white" },
      { id: 2, label: "Ảnh 2: Bối Cảnh Thực Tế Lifestyle", checked: true, promptKey: "universal_lifestyle" },
      { id: 3, label: "Ảnh 3: Kích Thước Sản Phẩm 3D", checked: true, promptKey: "universal_dimensions" },
      { id: 4, label: "Ảnh 4: Viền Kính Vát Cạnh & Độ Dày", checked: true, promptKey: "universal_features_zoom" },
      { id: 5, label: "Ảnh 5: Trao Quà Tay Trao Tay", checked: true, promptKey: "universal_gifting" },
      { id: 6, label: "Ảnh 6: Hộp Quà & Dây Treo", checked: true, promptKey: "universal_packaging" },
      { id: 7, label: "Ảnh 7: Thiệp Cursive Theo Niche", checked: true, promptKey: "universal_artwork_macro" },
    ],
  },
  {
    id: "starter_wood",
    label: "Phôi Gỗ Tự Nhiên / Plywood",
    icon: "🪵",
    description: "Giữ 100% vân gỗ tự nhiên, viền đục sẫm màu, bối cảnh ấm cúng.",
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng CTR Gốc", checked: true, promptKey: "universal_main_white" },
      { id: 2, label: "Ảnh 2: Bối Cảnh Phòng Khách Ấm Cúng", checked: true, promptKey: "universal_lifestyle" },
      { id: 3, label: "Ảnh 3: Kích Thước Sản Phẩm 3D", checked: true, promptKey: "universal_dimensions" },
      { id: 4, label: "Ảnh 4: Vân Gỗ Cận Cảnh & Độ Dày 6mm", checked: true, promptKey: "universal_features_zoom" },
      { id: 5, label: "Ảnh 5: Cầm Trên Tay Quà Tặng", checked: true, promptKey: "universal_gifting" },
      { id: 6, label: "Ảnh 6: Hộp Quà Retail Đóng Gói", checked: true, promptKey: "universal_packaging" },
      { id: 7, label: "Ảnh 7: Card Thiệp Kỷ Niệm Gỗ", checked: true, promptKey: "universal_artwork_macro" },
    ],
  },
  {
    id: "starter_tumbler",
    label: "Phôi Cốc / Tumbler / Bình Giữ Nhiệt",
    icon: "🍾",
    description: "Cốc inox/thép không gỉ, giữ nhiệt nóng lạnh, nắp chống tràn.",
    contents: [
      { id: 1, label: "Ảnh 1: Thiết Kế Nền Trắng", checked: true, promptKey: "full_design" },
      { id: 2, label: "Ảnh 2: Cách Nhiệt & Hộp Quà", checked: true, promptKey: "bullet_insulation_box" },
      { id: 3, label: "Ảnh 3: Kích Thước Dung Tích 3D", checked: true, promptKey: "bullet_capacity_size" },
      { id: 4, label: "Ảnh 4: Nắp Rót & Chi Tiết Cận Cảnh", checked: true, promptKey: "bullet_press_lid_pour" },
      { id: 5, label: "Ảnh 5: Bối Cảnh Ô Tô / Dã Ngoại", checked: true, promptKey: "bullet_outdoor_camping" },
      { id: 6, label: "Ảnh 6: Hộc Để Cốc Ô Tô", checked: true, promptKey: "bullet_car_cupholder" },
      { id: 7, label: "Ảnh 7: Quà Tặng Ý Nghĩa", checked: true, promptKey: "bullet_men_gifting" },
    ],
  },
  {
    id: "starter_slate",
    label: "Phôi Đá Tự Nhiên (Slate Plate)",
    icon: "🪨",
    description: "Đá vỡ viền tự nhiên sẫm màu, chân đế đỡ, trang trí nội thất.",
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng Chân Đế", checked: true, promptKey: "slate_main_white" },
      { id: 2, label: "Ảnh 2: Đá Tự Nhiên & Chống Nước", checked: true, promptKey: "slate_features_infographic" },
      { id: 3, label: "Ảnh 3: Kích Thước & Chân Đế 3D", checked: true, promptKey: "slate_dimensions_size" },
      { id: 4, label: "Ảnh 4: Mặt Trước & Sau Đá Đen", checked: true, promptKey: "slate_front_back_stack" },
      { id: 5, label: "Ảnh 5: Trang Trí Nổi Bật Phòng Khách", checked: true, promptKey: "slate_home_decor_lifestyle" },
      { id: 6, label: "Ảnh 6: Quà Tặng Tri Ơn", checked: true, promptKey: "slate_gifting_emotion" },
      { id: 7, label: "Ảnh 7: Hộp Quà Retail Đóng Gói", checked: true, promptKey: "slate_packaging_box" },
    ],
  },
  {
    id: "starter_fabric",
    label: "Phôi Vải / Áo T-Shirt / Vỏ Gối",
    icon: "👕",
    description: "Chất liệu cotton/linn đục, nếp gấp vải tự nhiên, bảng size chuẩn.",
    contents: [
      { id: 1, label: "Ảnh 1: Nền Trắng CTR Gốc", checked: true, promptKey: "universal_main_white" },
      { id: 2, label: "Ảnh 2: Model Mặc / Bối Cảnh Thực Tế", checked: true, promptKey: "universal_lifestyle" },
      { id: 3, label: "Ảnh 3: Bảng Kích Thước Size Chart", checked: true, promptKey: "universal_dimensions" },
      { id: 4, label: "Ảnh 4: Sợi Vải & Đường Mũi Chỉ Cận Cảnh", checked: true, promptKey: "universal_features_zoom" },
      { id: 5, label: "Ảnh 5: Cầm Trên Tay Quà Tặng", checked: true, promptKey: "universal_gifting" },
      { id: 6, label: "Ảnh 6: Đóng Gói Túi Retail", checked: true, promptKey: "universal_packaging" },
      { id: 7, label: "Ảnh 7: Bối Cảnh Trang Trí Theme", checked: true, promptKey: "universal_artwork_macro" },
    ],
  },
];

export function getStoredCustomPresets(): ProductCategoryPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ProductCategoryPreset =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        Array.isArray(item.contents),
    );
  } catch {
    return [];
  }
}

export function saveStoredCustomPresets(presets: ProductCategoryPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    // This is only an offline cache. PostgreSQL remains the shared source of truth.
    // Keep system overrides too so a temporary network outage does not restore
    // stale built-in prompts in this browser.
    localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage errors
  }
}

export function getAllPresets(): ProductCategoryPreset[] {
  const custom = getStoredCustomPresets();
  const customMap = new Map(custom.map((p) => [p.id, p]));

  // System presets can have user modifications saved in local storage
  const mergedSystem = SYSTEM_PRESETS.map((sys) => {
    const override = customMap.get(sys.id);
    if (override) {
      customMap.delete(sys.id);
      return {
        ...sys,
        ...override,
        isSystem: true,
      };
    }
    return sys;
  });

  return [...mergedSystem, ...Array.from(customMap.values())];
}

export async function fetchPresetsFromServer(): Promise<ProductCategoryPreset[]> {
  try {
    const res = await fetch("/api/presets", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.presets) && data.presets.length > 0) {
        saveStoredCustomPresets(data.presets);
        return data.presets;
      }
    }
  } catch {
    // Fallback to local storage
  }
  return getAllPresets();
}

export async function syncPresetsToServer(presets: ProductCategoryPreset[]): Promise<ProductCategoryPreset[]> {
  saveStoredCustomPresets(presets);
  const data = await presetApiRequest("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presets }),
  });
  saveStoredCustomPresets(data.presets);
  return data.presets;
}

export async function savePresetToServer(
  preset: ProductCategoryPreset,
): Promise<ProductCategoryPreset[]> {
  const data = await presetApiRequest("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset }),
  });
  saveStoredCustomPresets(data.presets);
  return data.presets;
}

export async function deletePresetFromServer(
  presetId: string,
): Promise<ProductCategoryPreset[]> {
  const data = await presetApiRequest(
    `/api/presets?id=${encodeURIComponent(presetId)}`,
    { method: "DELETE" },
  );
  saveStoredCustomPresets(data.presets);
  return data.presets;
}

async function presetApiRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ presets: ProductCategoryPreset[] }> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    presets?: ProductCategoryPreset[];
  };
  if (!response.ok) {
    throw new Error(data.error || `Không thể đồng bộ phôi (HTTP ${response.status}).`);
  }
  if (!Array.isArray(data.presets)) {
    throw new Error("Server không trả về danh sách phôi dùng chung hợp lệ.");
  }
  return { presets: data.presets };
}

export function createNewPreset(
  label: string,
  icon: string = "📦",
  baseContents?: MockupContentItem[],
): ProductCategoryPreset {
  const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const defaultContents: MockupContentItem[] = baseContents
    ? baseContents.map((c, idx) => ({ ...c, id: idx + 1 }))
    : [
        { id: 1, label: "Ảnh 1: Nền Trắng CTR Gốc", checked: true, promptKey: "universal_main_white" },
        { id: 2, label: "Ảnh 2: Bối Cảnh Thực Tế Lifestyle", checked: true, promptKey: "universal_lifestyle" },
        { id: 3, label: "Ảnh 3: Kích Thước Sản Phẩm 3D", checked: true, promptKey: "universal_dimensions" },
        { id: 4, label: "Ảnh 4: Chất Liệu & Chi Tiết Cận Cảnh", checked: true, promptKey: "universal_features_zoom" },
        { id: 5, label: "Ảnh 5: Trao Quà Ý Nghĩa", checked: true, promptKey: "universal_gifting" },
        { id: 6, label: "Ảnh 6: Hộp Quà Đóng Gói Retail", checked: true, promptKey: "universal_packaging" },
        { id: 7, label: "Ảnh 7: Card Thiệp Đồ Họa Độc Đáo", checked: true, promptKey: "universal_artwork_macro" },
      ];

  return {
    id,
    label: label.trim() || "Sản phẩm mới",
    icon: icon.trim() || "📦",
    isSystem: false,
    contents: defaultContents,
  };
}

export function clonePreset(
  sourcePreset: ProductCategoryPreset,
  newLabel?: string,
): ProductCategoryPreset {
  const cloned = createNewPreset(
    newLabel || `${sourcePreset.label} (Bản sao)`,
    sourcePreset.icon,
    sourcePreset.contents,
  );
  return cloned;
}

export function exportPresetsPayload(allPresets: ProductCategoryPreset[]): PresetExportPayload {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    presets: allPresets,
  };
}

export function importPresetsPayload(jsonString: string): ProductCategoryPreset[] {
  const parsed = JSON.parse(jsonString);
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.presets)
      ? parsed.presets
      : [];

  const importedList: ProductCategoryPreset[] = [];
  for (const item of rawList) {
    if (
      typeof item === "object" &&
      item !== null &&
      "label" in item &&
      typeof (item as ProductCategoryPreset).label === "string" &&
      "contents" in item &&
      Array.isArray((item as ProductCategoryPreset).contents)
    ) {
      const validItem = item as ProductCategoryPreset;
      const isSys = SYSTEM_PRESETS.some((s) => s.id === validItem.id);
      importedList.push({
        id: validItem.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: validItem.label.trim(),
        icon: validItem.icon?.trim() || "📦",
        isSystem: isSys,
        contents: validItem.contents.map((c, idx) => ({
          id: c.id || idx + 1,
          label: c.label || `Content ${idx + 1}`,
          checked: typeof c.checked === "boolean" ? c.checked : true,
          promptKey: c.promptKey,
          customPrompt: c.customPrompt,
        })),
      });
    }
  }

  if (importedList.length === 0) {
    throw new Error("File JSON không chứa dữ liệu Preset hợp lệ.");
  }

  return importedList;
}

export const CHATGPT_PROMPT_TEMPLATE = `Tôi vừa tải lên ảnh phôi sản phẩm POD mới (Product Blank).
Hãy phân tích ảnh phôi sản phẩm này và lập bộ 7 Content tổng quát cho dòng phôi sản phẩm (dùng chung cho TẤT CẢ các mẫu thiết kế in POD khác nhau sau này). 
Hãy tự viết mô tả bối cảnh chụp AI bằng tiếng Anh chi tiết cho từng bức ảnh.

BẮT BUỘC GIỮ NGUYÊN ĐỊNH DẠNG TỪNG DÒNG BÊN DƯỚI ĐỂ HỆ THỐNG CỦA TÔI TỰ ĐỘNG BÓC TÁCH:

Loại Sản Phẩm: [Emoji] [Tên phôi sản phẩm, ví dụ: 🍽️ Square Ceramic Keepsake Plate]
Content 1 | Ảnh 1: Ảnh Chính Sản Phẩm | [Mô tả tiếng Anh chụp sản phẩm góc thẳng nền trắng tinh #FFFFFF, giữ 100% hình dáng vật lý, chất liệu và mẫu in từ Ảnh 1]
Content 2 | Ảnh 2: Ảnh Bối Cảnh Sử Dụng | [Mô tả tiếng Anh bối cảnh lifestyle cao cấp. Yêu cầu AI Vision tự động quét hình in trên Ảnh 1 để chọn đạo cụ phù hợp chủ đề Đám cưới, Mẹ con, Thú cưng, Cắm trại...]
Content 3 | Ảnh 3: Ảnh Kích Thước | [Mô tả tiếng Anh infographic đo kích thước sản phẩm rõ nét, hiển thị các chiều kích thước kèm mũi tên chỉ dẫn]
Content 4 | Ảnh 4: Ảnh Mô Tả Tính Năng & Chi Tiết | [Mô tả tiếng Anh cận cảnh macro chi tiết tính năng đặc trưng, chất liệu, góc nghiêng hoặc điểm nổi bật của phôi sản phẩm]
Content 5 | Ảnh 5: Ảnh Quà Tặng Ý Nghĩa | [Mô tả tiếng Anh khoảnh khắc quà tặng cảm xúc: AI Vision tự động quét hình in trên Ảnh 1 để nhận diện chủ đề/dịp tặng (Tốt nghiệp, Đám cưới, Mẹ con, Y tá, Giáo viên...). Đặt phôi sản phẩm nổi bật ở góc bên phải, kết hợp hình ảnh cảm xúc con người phù hợp chủ đề ở phía sau (như ôm nhau hạnh phúc, trao quà), kèm banner câu chúc chữ nghệ thuật ở góc dưới]
Content 6 | Ảnh 6: Ảnh Đóng Gói (Nếu Có) | [Mô tả tiếng Anh flat-lay 1:1 từ trên xuống gồm phôi sản phẩm, hộp quà/bao bì đóng gói và phụ kiện đi kèm nếu có]
Content 7 | Ảnh 7: Ảnh Cận Chi Tiết Thiết Kế | [Mô tả tiếng Anh flat-lay cận cảnh thiết kế in sắc nét kèm thiệp chúc mừng, AI Vision đọc chủ đề hình in trên Ảnh 1 để viết câu chúc tương ứng]`;

export function parseChatGPTBatchInput(
  text: string,
  startingId: number = 1,
): {
  categoryMeta?: { label?: string; icon?: string };
  items: MockupContentItem[];
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let categoryMeta: { label?: string; icon?: string } | undefined;
  const items: MockupContentItem[] = [];
  let currentId = startingId;

  for (const line of lines) {
    // Detect category header line e.g. "Loại Sản Phẩm: 🍺 Beer Mug (Cốc Bia)"
    const catMatch = line.match(/^(?:Loại Sản Phẩm|Category|Sản phẩm)\s*[:|-]\s*(.+)$/i);
    if (catMatch) {
      const rawCat = catMatch[1].trim();
      const emojiMatch = rawCat.match(/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\s*(.+)$/u);
      if (emojiMatch) {
        categoryMeta = { icon: emojiMatch[1], label: emojiMatch[2].trim() };
      } else {
        categoryMeta = { label: rawCat };
      }
      continue;
    }

    // Split line by '|', tab, or '::'
    const parts = line.split(/\||\t|::/).map((p) => p.trim()).filter(Boolean);

    let rawLabel = "";
    let rawPrompt = "";

    if (parts.length >= 3) {
      // Content X | Label | Custom Prompt
      rawLabel = parts[1];
      rawPrompt = parts.slice(2).join(" | ");
    } else if (parts.length === 2) {
      if (/^Content\s*\d+/i.test(parts[0])) {
        rawLabel = parts[1];
      } else {
        rawLabel = parts[0];
        rawPrompt = parts[1];
      }
    } else {
      rawLabel = line;
    }

    // Clean label prefix
    let cleanLabel = rawLabel.replace(/^Content\s*\d+\s*[:|-]?\s*/i, "").trim();
    if (!cleanLabel) cleanLabel = line;

    // Check for explicit Content number in line e.g. "Content 1"
    const contentNumMatch = line.match(/^Content\s*(\d+)/i);
    const itemExplicitId = contentNumMatch ? parseInt(contentNumMatch[1], 10) : currentId;

    const itemLabel = cleanLabel.startsWith("Content")
      ? cleanLabel
      : `Content ${itemExplicitId}: ${cleanLabel}`;

    items.push({
      id: itemExplicitId,
      label: itemLabel,
      checked: true,
      customPrompt: rawPrompt || undefined,
    });

    currentId = itemExplicitId + 1;
  }

  return { categoryMeta, items };
}
