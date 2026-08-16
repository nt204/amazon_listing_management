export interface GlassOrnamentTemplateSpec {
  id: string;
  name: string;
  badge: string;
  description: string;
  /** Authoritative base image passed to the AI image-edit request. */
  templateAssetPath: string;
}

export const GLASS_ORNAMENT_TEMPLATES: GlassOrnamentTemplateSpec[] = [
  {
    id: "glass_product_size",
    name: "Template 1 - Product Size 3.1\" (Ảnh Infographic Kích Thước)",
    badge: "Infographic",
    description: "Bối cảnh thực tế đường vạch chú thích chuẩn 3.1\" x 3.1\" với tay cầm lụa trắng và nền bokeh ấm áp.",
    templateAssetPath: "public/templates/glass-ornament/glass_product_size.jpg",
  },
  {
    id: "glass_perfect_gift",
    name: "Template 2 - Perfect Gift Idea (Thông Điệp Trao Quà)",
    badge: "Bán Chạy #1",
    description: "Bối cảnh hai bàn tay giữ ornament kèm dải nơ đỏ lụa và chữ thông điệp Perfect Gift Idea.",
    templateAssetPath: "public/templates/glass-ornament/glass_perfect_gift.jpg",
  },
  {
    id: "glass_package_included",
    name: "Template 3 - Package Included (Bộ Hộp Quà Đỏ & Dây Treo)",
    badge: "Bộ Đóng Gói",
    description: "Bối cảnh flat-lay hộp quà đỏ sang trọng, cành thông giáng sinh và chú thích Package Included.",
    templateAssetPath: "public/templates/glass-ornament/glass_package_included.jpg",
  },
  {
    id: "glass_lawyer_flatlay",
    name: "Template 4 - Lawyer Desk Flat-Lay (Bàn Làm Việc Luật Sư)",
    badge: "Specialty / Occupation",
    description: "Bối cảnh bàn gỗ cao cấp gồm Bút máy, Cán búa tòa án, Cân công lý và thiệp chúc mừng ý nghĩa.",
    templateAssetPath: "public/templates/glass-ornament/glass_lawyer_flatlay.jpg",
  },
  {
    id: "glass_tree_hand",
    name: "Template 5 - Christmas Tree Hand (Cận Cảnh Tay Treo Cây Thông)",
    badge: "Lifestyle",
    description: "Bối cảnh bàn tay treo ornament thủy tinh dây nơ đỏ lên nhánh cây thông Noel xanh tươi.",
    templateAssetPath: "public/templates/glass-ornament/glass_tree_hand.jpg",
  },
  {
    id: "glass_camper_flatlay",
    name: "Template 6 - Camper & Map Flat-Lay (Bàn Gỗ & Ô Tô Mô Hình)",
    badge: "Travel / Adventure",
    description: "Bối cảnh bàn gỗ du lịch gồm Ô tô mô hình cắm trại, Bản đồ, Quả thông và thiệp Home is where we park it.",
    templateAssetPath: "public/templates/glass-ornament/glass_camper_flatlay.jpg",
  },
];
