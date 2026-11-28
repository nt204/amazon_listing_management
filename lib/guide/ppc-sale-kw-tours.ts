import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn tab PPC "Lên Camp Sale KW". Viết theo skill .claude/skills/ppc-guided-tour.
// 7 luồng: từ A-Z, lọc tiềm năng, cấu hình camp, tính bid, phủ định ở camp cũ, lên camp SB, theo dõi Registry.
// Logic đối chiếu code 2026-11-28: Orders > 2, budget $5/campaign, bid "CPC TB từng term", % bid SB01 80% / SB05 90%;
// "Phủ định Exact ở Camp cũ" MẶC ĐỊNH TẮT; không tick term nào = lấy mọi term đang lọc (trừ term đã lên camp);
// cả "Xuất Bulksheet" lẫn "Auto Upload" đều ghi vào Registry ngay khi bấm.

export const PPC_SALE_KW_GUIDE_PAGE = "ppc-sale-kw";

const wait = (ms: number): GuideAction => ({ type: "wait", ms });
const switchToCandidates: GuideAction[] = [{ type: "click", target: "sale-subtab-candidates", ifPresent: true }, wait(400)];
const switchToRegistry: GuideAction[] = [{ type: "click", target: "sale-subtab-registry", ifPresent: true }, wait(400)];
const closeAutoUploadModal: GuideAction = { type: "click", target: "sale-modal-cancel", ifPresent: true };
const backToCandidates: GuideAction = { type: "click", target: "sale-subtab-candidates", ifPresent: true };
// Thao tác tick / bật làm mẫu: chỉ bấm khi đang tắt, kết thúc tour tự trả lại (undo).
const tickFirstTerm: GuideAction[] = [{ type: "click", target: "sale-row-first-checkbox", ifPresent: true, ensure: "on", undo: true }, wait(400)];
const tickNegateSource: GuideAction[] = [{ type: "click", target: "sale-negate-source", ensure: "on", undo: true }, wait(400)];
const turnOnSb01: GuideAction[] = [{ type: "click", target: "sale-run-sb01", ensure: "on", undo: true }, wait(500)];
const openAutoUpload: GuideAction[] = [{ type: "click", target: "sale-btn-auto-upload", ifPresent: true }, wait(900)];

const TOURS: GuideTour[] = [
  {
    id: "sale-a-to-z",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "main",
    title: "Lên camp Sale KW",
    summary: "Chọn store → lọc term Orders > 2 → chọn term và match type → budget, bid → phủ định ở camp cũ → Auto Upload hoặc Xuất Bulksheet → Registry.",
    whenToUse: "Người mới, hỏi quy trình lên camp sale kw từ đầu tới cuối, bắt đầu từ đâu, tổng quan A-Z.",
    cleanup: [closeAutoUploadModal, backToCandidates],
    steps: [
      {
        title: "Lên camp Sale KW",
        body: "Tour đi từ lọc search term đã bán được tới lúc campaign mới nằm trong <b>Registry</b>. Mỗi SKU được tách campaign riêng theo từng match type.",
        before: switchToCandidates,
      },
      {
        target: "ppc-store-select",
        title: "Chọn 1 store",
        body: "Màn này trống khi đang ở “Tất cả store”. Campaign mới luôn lên đúng tài khoản Amazon của store đã chọn.",
        side: "bottom",
      },
      {
        target: "sale-filter-orders",
        title: "Ngưỡng Orders",
        body: "Bảng chỉ lấy search term có <b>Orders &gt; 2</b> trong kỳ đang chọn. Đây là những term đã chứng minh bán được hàng.",
        side: "bottom",
      },
      {
        target: ["sale-row-first-checkbox", "sale-sku-group", "sale-metrics"],
        title: "Tick term muốn lên camp",
        body: "Mỗi thẻ là một SKU, tour vừa tick term đầu tiên làm mẫu. Không tick term nào thì lấy hết, match type không cần thì tắt ở đầu thẻ.",
        before: tickFirstTerm,
        side: "right",
      },
      {
        target: "sale-config-budget",
        title: "Budget và bid",
        body: "Mặc định $5 mỗi campaign, bid lấy theo “CPC TB từng term”. Giữ mặc định nếu chưa chắc.",
        side: "bottom",
      },
      {
        target: "sale-negate-source",
        title: "Tick phủ định ở camp cũ",
        body: "Ô này <b>mặc định tắt</b>, tour vừa tick làm mẫu. Nên tick để campaign cũ không tranh term với campaign mới.",
        before: tickNegateSource,
        side: "bottom",
      },
      {
        target: "sale-btn-export",
        title: "Cách 1: Xuất Bulksheet",
        body: "Tải file rồi tự upload ở Bulk operations của Amazon Ads. Bấm sẽ ghi term vào Registry ngay, nên nhớ upload file.",
        side: "bottom",
      },
      {
        target: ["sale-modal-confirm", "sale-btn-auto-upload"],
        title: "Cách 2: Auto Upload",
        body: "Tour vừa mở hộp xác nhận, chưa đẩy gì. Bấm xác nhận sẽ để Mac mini tạo campaign thật và bắt đầu tiêu budget.",
        before: openAutoUpload,
        side: "top",
      },
      {
        target: "sale-reg-table",
        title: "Kết quả ở Registry",
        body: "Mỗi dòng là một keyword đã lên camp, kèm campaign mới và campaign nguồn. Term ở đây sẽ không hiện lại trong bảng lên camp.",
        before: [closeAutoUploadModal, wait(300), ...switchToRegistry],
        side: "top",
      },
    ],
  },
  {
    id: "sale-loc-tiem-nang",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Lọc search term tiềm năng",
    summary: "Đổi ngưỡng Orders, ẩn term đã lên camp, tìm theo keyword, lọc theo SKU.",
    whenToUse: "Tìm search term tiềm năng, đổi ngưỡng orders, lọc theo SKU, ẩn từ khóa đã lên camp, không thấy term nào.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-filter-orders",
        title: "Đổi ngưỡng Orders",
        body: "Mặc định <b>Orders &gt; 2</b>. SKU mới launch có thể hạ xuống ≥ 1 để có thêm term, đổi lại term ít dữ liệu hơn.",
        before: switchToCandidates,
        side: "bottom",
      },
      {
        target: "sale-hide-launched",
        title: "Ẩn ST đã lên Camp",
        body: "Đang bật thì term đã có trong Registry bị ẩn. Nhờ vậy không ai lên trùng campaign.",
        side: "bottom",
      },
      {
        target: "sale-search",
        title: "Tìm keyword hoặc SKU",
        body: "Gõ một phần keyword hoặc SKU để thu hẹp bảng.",
        side: "bottom",
      },
      {
        target: "sale-filter-sku",
        title: "Lọc theo SKU",
        body: "Chọn một SKU để chỉ lên camp cho SKU đó.",
        side: "bottom",
      },
      {
        target: "sale-metrics",
        title: "Kiểm tra số lượng",
        body: "“ST Tiềm năng”, “SKU đủ chuẩn” và “Số Camp sẽ lên” tính lại theo bộ lọc. Đọc “Số Camp sẽ lên” trước khi đẩy.",
        side: "bottom",
      },
    ],
  },
  {
    id: "sale-cau-hinh-camp",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Cấu hình campaign mới",
    summary: "Người dùng (gắn vào tên campaign), dạng chạy SP03 / SB01 / SB05, budget, bid, match type theo từng SKU.",
    whenToUse: "Đổi tên campaign, đổi người dùng, cài budget, chọn dạng chạy SP03 hay SB, tắt match type.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-config-user",
        title: "Điền người dùng",
        body: "Tên ở ô “Người dùng” được ghép vào tên campaign theo quy chuẩn. Nhờ vậy biết ai đã lên campaign.",
        before: switchToCandidates,
        side: "bottom",
      },
      {
        target: "sale-config-run-type",
        title: "Chọn dạng chạy",
        body: "<b>SP03 KW</b>, <b>SB01 Collection</b>, <b>SB05 Video</b>, chọn được nhiều dạng cùng lúc. Dạng SB cần thêm thông tin brand trong Bảng Mã.",
        side: "bottom",
      },
      {
        target: "sale-config-budget",
        title: "Đặt budget",
        body: "Budget áp dụng cho <b>mỗi</b> campaign, mặc định $5/ngày. Tổng tiền mỗi ngày = budget × “Số Camp sẽ lên”.",
        side: "bottom",
      },
      {
        target: "sale-config-bid",
        title: "Chọn cách tính bid",
        body: "“CPC TB từng term” lấy đúng giá term đã từng trả, nên dùng mặc định này. Chọn bid cố định khi muốn một mức chung.",
        side: "bottom",
      },
      {
        target: ["sale-mt-broad-first", "sale-sku-group", "sale-metrics"],
        title: "Tắt match type theo SKU",
        body: "Mỗi match type sinh một campaign riêng, tour vừa tắt Broad của SKU đầu làm mẫu. “Số Camp sẽ lên” giảm theo.",
        before: [{ type: "click", target: "sale-mt-broad-first", ifPresent: true, ensure: "off", undo: true }, wait(500)],
        side: "right",
      },
    ],
  },
  {
    id: "sale-tinh-bid",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Bid được tính thế nào",
    summary: "Bid nạp = CPC trung bình của chính search term đó. Campaign SB lấy % của CPC này (mặc định SB01 80%, SB05 90%).",
    whenToUse: "Hỏi bid tính thế nào, vì sao lấy CPC TB, % CPC của SB01 / SB05, bid cố định.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-config-bid",
        title: "CPC TB từng term",
        body: "Bid mỗi keyword lấy theo <b>CPC trung bình</b> mà search term đó đã trả trong kỳ. Đó là giá đã từng mang về đơn.",
        before: switchToCandidates,
        side: "bottom",
      },
      {
        target: ["sale-sku-group", "sale-metrics"],
        title: "Cột CPC TB (Bid nạp)",
        body: "Cột này trong thẻ SKU là bid sẽ nạp cho từng keyword. Kiểm tra ở đây trước khi đẩy.",
        side: "top",
      },
      {
        target: ["sale-config-sb-bids", "sale-config-run-type"],
        title: "% CPC cho campaign SB",
        body: "Tour vừa bật SB01 để hiện ô này. CPC lịch sử chủ yếu từ SP, nên SB lấy một phần: mặc định <b>SB01 80%, SB05 90%</b>.",
        before: turnOnSb01,
        side: "bottom",
      },
      {
        target: "sale-config-bid",
        title: "Bid cố định",
        body: "Chọn chế độ cố định để mọi keyword cùng một bid. Dùng khi CPC lịch sử quá cao hoặc quá thấp.",
        side: "bottom",
      },
    ],
  },
  {
    id: "sale-phu-dinh-camp-cu",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Phủ định ở camp cũ",
    summary: "Ô “Phủ định Exact ở Camp cũ” mặc định tắt. Tick để thêm Negative Exact cho term ở campaign nguồn, tránh hai campaign tự tranh nhau.",
    whenToUse: "Phủ định exact ở camp cũ để làm gì, có tự bật không, tránh tự cạnh tranh, camp nguồn và camp đích.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-negate-source",
        title: "Ô phủ định ở camp cũ",
        body: "Ô này <b>mặc định tắt</b>, tour vừa tick làm mẫu. Tick thì mỗi term lên camp mới được thêm Negative Exact ở campaign nguồn.",
        before: [...switchToCandidates, ...tickNegateSource],
        side: "bottom",
      },
      {
        target: ["sale-sku-group", "sale-metrics"],
        title: "Vì sao cần",
        body: "Không phủ định thì campaign cũ và mới cùng đấu giá một term, đẩy CPC của chính bạn lên. Phủ định dồn term đó về campaign mới.",
        side: "top",
      },
      {
        target: "sale-btn-export",
        title: "Áp dụng cả hai đầu ra",
        body: "Đã tick thì cả “Xuất Bulksheet” và “Auto Upload” đều kèm dòng phủ định ở campaign cũ.",
        side: "bottom",
      },
      {
        target: "sale-reg-table",
        title: "Campaign nguồn trong Registry",
        body: "Cột “Campaign nguồn (Cũ)” ghi campaign đã bị phủ định term. Dùng khi cần tra lại.",
        before: switchToRegistry,
        side: "top",
      },
    ],
  },
  {
    id: "sale-sb-setup",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Lên campaign Sponsored Brands",
    summary: "Bật SB01 / SB05, chỉnh % CPC, điền đủ Brand Entity ID, logo, video trong Bảng Mã. Thiếu thì vẫn xuất file được nhưng không Auto Upload được.",
    whenToUse: "Lên camp SB01, SB05, lỗi thiếu thông tin SB, brand entity id, logo, video, nút Auto Upload bị khoá.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-config-run-type",
        title: "Bật SB01 hoặc SB05",
        body: "Tour vừa bật “SB01 Collection” làm mẫu, “SB05 Video” bật cùng cách. Có thể chạy cùng SP03.",
        before: [...switchToCandidates, ...turnOnSb01],
        side: "bottom",
      },
      {
        target: ["sale-config-sb-bids", "sale-config-run-type"],
        title: "Chỉnh % CPC",
        body: "Bid SB = % × CPC TB của term, mặc định SB01 80%, SB05 90%.",
        side: "bottom",
      },
      {
        target: ["sale-sku-group", "sale-metrics"],
        title: "Khung thông tin SB",
        body: "Thẻ SKU có khung viền đỏ khi thiếu Brand Entity ID, logo hoặc video. Điền bổ sung trong Bảng Mã của SKU hoặc store.",
        side: "top",
      },
      {
        target: "sale-btn-auto-upload",
        title: "Thiếu thông tin thì sao",
        body: "Còn SKU thiếu thông tin SB thì “Auto Upload” bị khoá. “Xuất Bulksheet” vẫn dùng được.",
        side: "bottom",
      },
    ],
  },
  {
    id: "sale-theo-doi-registry",
    page: PPC_SALE_KW_GUIDE_PAGE,
    kind: "extra",
    title: "Theo dõi Registry",
    summary: "Registry ghi mọi keyword đã lên camp (campaign mới, campaign nguồn, SKU). Xoá mục chỉ xoá lịch sử, không tắt campaign trên Amazon.",
    whenToUse: "Quản trị Registry, xem lại các camp đã lên, xoá mục trong Registry, vì sao term không hiện lại, mã job Mac mini.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "sale-subtab-registry",
        title: "Mở Registry",
        body: "Tab “Quản trị Camp Sale KW (Registry)” ghi mọi keyword đã Xuất Bulksheet hoặc Auto Upload.",
        before: switchToRegistry,
        side: "bottom",
      },
      {
        target: "sale-reg-table",
        title: "Đọc bảng Registry",
        body: "Mỗi dòng gồm campaign đích (mới), kênh FBA / FBM, match type, SKU, keyword và campaign nguồn (cũ).",
        side: "top",
      },
      {
        target: ["sale-reg-delete-btn", "sale-reg-table"],
        title: "Xoá mục không tắt campaign",
        body: "“Xóa mục đã chọn” chỉ xoá lịch sử để term hiện lại ở bảng lên camp. Campaign trên Amazon <b>vẫn chạy</b>, muốn tắt thì tắt trên Amazon Ads.",
        side: "left",
      },
      {
        target: "sale-hide-launched",
        title: "Registry chặn lên trùng",
        body: "“Ẩn ST đã lên Camp” dựa vào Registry để giấu term đã lên. Xoá nhầm mục thì term đó có thể bị lên camp lần nữa.",
        before: switchToCandidates,
        side: "bottom",
      },
    ],
  },
];

export const PPC_SALE_KW_TOURS: GuideTour[] = TOURS;
