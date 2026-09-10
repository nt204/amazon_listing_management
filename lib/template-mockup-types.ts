export interface ProductTemplateSpec {
  id: string;
  category: string;
  name: string;
  badge: string;
  description: string;
  promptInstruction?: string;
  templateAssetPath?: string;
  templateDataUrl?: string;
  accessories?: string[];
  isCustom?: boolean;
}

export interface GlassOrnamentTemplateSpec {
  id: string;
  name: string;
  badge: string;
  description: string;
  /** Authoritative base image passed to the AI image-edit request. */
  templateAssetPath: string;
  category?: string;
  accessories?: string[];
  promptInstruction?: string;
  templateDataUrl?: string;
  isCustom?: boolean;
}

export const GLASS_ORNAMENT_TEMPLATES: GlassOrnamentTemplateSpec[] = [
  {
    id: "glass_product_size",
    name: "Template 1 - Product Size 3.1\" (Ảnh Infographic Kích Thước)",
    badge: "Infographic",
    description: "Bối cảnh thực tế đường vạch chú thích chuẩn 3.1\" x 3.1\" với tay cầm lụa trắng và nền bokeh ấm áp.",
    templateAssetPath: "public/templates/glass-ornament/glass_product_size.jpg",
    category: "glass-ornament",
  },
  {
    id: "glass_perfect_gift",
    name: "Template 2 - Perfect Gift Idea (Thông Điệp Trao Quà)",
    badge: "Bán Chạy #1",
    description: "Bối cảnh hai bàn tay giữ ornament kèm dải nơ đỏ lụa và chữ thông điệp Perfect Gift Idea.",
    templateAssetPath: "public/templates/glass-ornament/glass_perfect_gift.jpg",
    category: "glass-ornament",
  },
  {
    id: "glass_package_included",
    name: "Template 3 - Package Included (Bộ Hộp Quà Đỏ & Dây Treo)",
    badge: "Bộ Đóng Gói",
    description: "Bối cảnh flat-lay hộp quà đỏ sang trọng, cành thông giáng sinh và chú thích Package Included.",
    templateAssetPath: "public/templates/glass-ornament/glass_package_included.jpg",
    category: "glass-ornament",
  },
  {
    id: "glass_lawyer_flatlay",
    name: "Template 4 - Lawyer Desk Flat-Lay (Bàn Làm Việc Luật Sư)",
    badge: "Specialty / Occupation",
    description: "Bối cảnh bàn gỗ cao cấp gồm Bút máy, Cán búa tòa án, Cân công lý và thiệp chúc mừng ý nghĩa.",
    templateAssetPath: "public/templates/glass-ornament/glass_lawyer_flatlay.jpg",
    category: "glass-ornament",
  },
  {
    id: "glass_tree_hand",
    name: "Template 5 - Christmas Tree Hand (Cận Cảnh Tay Treo Cây Thông)",
    badge: "Lifestyle",
    description: "Bối cảnh bàn tay treo ornament thủy tinh dây nơ đỏ lên nhánh cây thông Noel xanh tươi.",
    templateAssetPath: "public/templates/glass-ornament/glass_tree_hand.jpg",
    category: "glass-ornament",
  },
  {
    id: "glass_camper_flatlay",
    name: "Template 6 - Camper & Map Flat-Lay (Bàn Gỗ & Ô Tô Mô Hình)",
    badge: "Travel / Adventure",
    description: "Bối cảnh bàn gỗ du lịch gồm Ô tô mô hình cắm trại, Bản đồ, Quả thông và thiệp Home is where we park it.",
    templateAssetPath: "public/templates/glass-ornament/glass_camper_flatlay.jpg",
    category: "glass-ornament",
  },
];

export const BOX_MOCKUP_TEMPLATES: ProductTemplateSpec[] = [
  {
    id: "box_main_pure_white",
    category: "box",
    name: "Template 1 - Main Pure White (Hộp Quà Sang Trọng Nền Trắng)",
    badge: "Ảnh Chính #1",
    description: "Hộp quà đóng nắp trên nền trắng tinh khiết Amazon 100%, bóng đổ tự nhiên.",
    promptInstruction: "Place artwork on packaging gift box on pure white background",
    templateAssetPath: "public/templates/box/box_main_pure_white.jpg",
  },
  {
    id: "box_lifestyle",
    category: "box",
    name: "Template 2 - Lifestyle Gift Box (Bối Cảnh Sang Trọng)",
    badge: "Lifestyle",
    description: "Hộp quà đặt trong không gian sống ấm cúng sang trọng.",
    promptInstruction: "Packaging gift box in cozy luxury home lifestyle setting",
    templateAssetPath: "public/templates/box/box_lifestyle.jpg",
  },
  {
    id: "box_open_lid_interior",
    category: "box",
    name: "Template 3 - Open Lid Interior (Hộp Mở Nắp & Khung Cảnh)",
    badge: "Mở Nắp",
    description: "Hộp quà mở hé nắp khoe chi tiết sắc nét bên trong.",
    promptInstruction: "Gift box with open lid showcasing interior",
    templateAssetPath: "public/templates/box/box_open_lid.jpg",
  },
  {
    id: "box_top_down",
    category: "box",
    name: "Template 4 - Top Down Flat Lay (Góc Nhìn Từ Trên Xuống)",
    badge: "Flat Lay",
    description: "Góc chụp từ trên xuống toàn cảnh hộp quà tinh tế.",
    promptInstruction: "Top down flat lay view of elegant packaging gift box",
    templateAssetPath: "public/templates/box/box_top_down.jpg",
  },
  {
    id: "slate_plate_package_included",
    category: "box",
    name: "Template 5 - Slate Plate Package Included (Bộ Sản Phẩm Kèm Phụ Kiện)",
    badge: "Package Included",
    description: "Bối cảnh bộ sản phẩm kèm hộp quà và phụ kiện chân đế.",
    promptInstruction: "Product packaging display set with box and accessories",
    templateAssetPath: "public/templates/box/slate_plate_package_included.png",
    accessories: [
      "Hộp quà nắp cam Bozspacer (16x16x2.7cm)",
      "Chân đế đen (1 Black foot stand)",
    ],
  },
];

export const ALL_BUILTIN_TEMPLATES: ProductTemplateSpec[] = [
  ...GLASS_ORNAMENT_TEMPLATES.map((t) => ({
    ...t,
    category: "glass-ornament",
  })),
  ...BOX_MOCKUP_TEMPLATES,
];

export function buildAccessoriesPromptInjection(accessories?: string[]): string {
  if (!accessories || !Array.isArray(accessories)) return "";
  const cleaned = accessories
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  return ` Package accessories genuinely included as shown in the reference: [${cleaned.join(", ")}]. Maintain product integrity, strictly matching their physical appearance and relative placement.`;
}
