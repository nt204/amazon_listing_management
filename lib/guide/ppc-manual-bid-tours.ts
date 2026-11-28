import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn tab PPC "Chỉnh Bid Tay" (Manual Bid). Viết theo skill .claude/skills/ppc-guided-tour.
// 7 luồng: từ A-Z, tìm SKU, khoanh vùng ACOS, sửa hàng loạt, sửa Excel, dừng target lỗ, kiểm tra & duyệt.
// Logic đối chiếu code 2026-11-28 (lib/ppc/manual-bid.ts): nấc 0–20 / 20–40 / 40–60 / >60% / "0 order >7 click" / Khác;
// bid kẹp trong $0.02 (SB $0.10) – $100. Duyệt chỉ vào Action Queue; đầu ra = Xuất Bulk File hoặc Auto Upload AdsPower.

export const PPC_MANUAL_BID_GUIDE_PAGE = "ppc-manual-bid";

const openFirstSku: GuideAction[] = [
  { type: "click", target: "mb-sku-first-row", ifPresent: true },
  { type: "wait", ms: 600 },
];

// Chọn hết target đang hiện (chỉ khi chưa chọn); kết thúc tour tự bỏ chọn (undo). Chỉ đổi lựa chọn trên màn hình, không đổi bid.
const selectRows: GuideAction[] = [
  { type: "click", target: "mb-target-select-all", ifPresent: true, ensure: "on", undo: true },
  { type: "wait", ms: 500 },
];
// Bấm chip lọc nấc làm mẫu; kết thúc tour bấm "Tất cả" để bỏ lọc.
const pickTier = (key: string): GuideAction[] => [
  { type: "click", target: key, ifPresent: true, ensure: "on", undo: "mb-tier-all" },
  { type: "wait", ms: 500 },
];
const closeTargetDetail: GuideAction = { type: "click", target: "mb-back-btn", ifPresent: true };
const openQueue: GuideAction[] = [{ type: "click", target: "ppc-action-queue-btn" }, { type: "wait", ms: 800 }];
const closeQueue: GuideAction = { type: "click", target: "aq-close", ifPresent: true };

const TOURS: GuideTour[] = [
  {
    id: "mb-a-to-z",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "main",
    title: "Chỉnh bid manual",
    summary: "Chọn store → mở SKU → sửa bid trong lưới target → Duyệt → Action Queue → Xuất Bulk File hoặc Auto Upload AdsPower.",
    whenToUse: "Người mới, hỏi quy trình chỉnh bid tay từ đầu đến cuối, bắt đầu từ đâu, tổng quan A-Z.",
    cleanup: [closeQueue, closeTargetDetail],
    steps: [
      {
        title: "Chỉnh bid manual",
        body: "Tour đi từ chọn SKU, sửa bid trong lưới target, tới lúc bid mới được đẩy lên Amazon. Bấm “Duyệt” thôi thì Amazon <b>chưa đổi gì</b>.",
      },
      {
        target: "ppc-store-select",
        title: "Chọn 1 store",
        body: "Màn này chỉ chạy khi chọn một store cụ thể. Mọi thay đổi đẩy lên đúng tài khoản Amazon của store đó.",
        side: "bottom",
      },
      {
        target: ["mb-sku-table", "mb-sku-search"],
        title: "Mở một SKU",
        body: "Mỗi dòng là một SKU kèm spend, sales, ACOS và tồn. Bấm vào dòng để mở lưới target của SKU.",
        side: "top",
      },
      {
        target: "mb-target-table",
        title: "Lưới target",
        body: "Mọi target của SKU trong các campaign SP, SB, SD, xếp như bảng Excel. Các chip phía trên lọc theo nấc ACOS.",
        before: openFirstSku,
        side: "top",
      },
      {
        target: ["mb-target-first-new-bid", "mb-target-table"],
        title: "Gõ bid mới",
        body: "Gõ số vào ô “Bid mới”, Enter để xuống dòng dưới. Muốn sửa nhiều target cùng lúc thì tick chọn rồi dùng thanh công cụ tím.",
        side: "left",
      },
      {
        target: "mb-approve-btn",
        title: "Bấm Duyệt",
        body: "“Duyệt” đưa các bid đã sửa vào Action Queue của store. Bấm sẽ <b>chưa</b> đổi gì trên Amazon.",
        side: "left",
      },
      {
        target: ["aq-table", "aq-drawer"],
        title: "Kiểm tra Action Queue",
        body: "Mỗi dòng là một thay đổi, Old → New bid. Sửa lại New bid hoặc xoá dòng duyệt nhầm ở đây.",
        before: openQueue,
        side: "left",
      },
      {
        target: ["aq-export-btn", "aq-auto-upload-btn"],
        title: "Đẩy lên Amazon",
        body: "“Xuất Bulk File” tải file để bạn tự upload ở Bulk operations của Amazon Ads. “Auto Upload AdsPower” để Mac mini upload thay bạn, bấm xác nhận sẽ đổi bid thật.",
        side: "top",
      },
      {
        target: ["aq-history", "aq-drawer"],
        title: "Xem kết quả upload",
        body: "Mỗi lượt Auto Upload hiện trạng thái Đang chờ, Đang thực thi, Thành công hoặc Thất bại. Bấm “Chi tiết” để xem phản hồi của Amazon.",
        side: "left",
      },
    ],
  },
  {
    id: "mb-tim-sku",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Tìm SKU cần xử lý",
    summary: "Tìm theo SKU / ASIN, lọc trạng thái, Phôi / Niche / PIC, lọc theo khoảng số, gồm paused, sắp xếp cột.",
    whenToUse: "Hỏi cách tìm SKU, lọc theo phôi / niche / PIC, lọc theo khoảng spend / sales / acos, sắp xếp bảng SKU, xem target đã tắt.",
    cleanup: [closeTargetDetail],
    steps: [
      {
        target: "mb-sku-search",
        title: "Tìm SKU hoặc ASIN",
        body: "Gõ một phần SKU hoặc ASIN rồi Enter. Khớp đúng một SKU thì lưới target của SKU đó tự mở.",
        side: "bottom",
      },
      {
        target: "mb-sku-status",
        title: "Lọc trạng thái SKU",
        body: "Chỉ xem SKU theo trạng thái kinh doanh, ví dụ bỏ qua SKU đã ngừng bán.",
        side: "bottom",
      },
      {
        target: "mb-sku-facets",
        title: "Lọc Phôi, Niche, PIC",
        body: "Lọc theo loại phôi, ngách và người phụ trách marketing. Dữ liệu lấy từ Bảng Mã của store.",
        side: "bottom",
      },
      {
        target: ["mb-sku-metric-filter", "mb-sku-facets"],
        title: "Lọc theo khoảng số",
        body: "Nút “Lọc” giới hạn theo khoảng Spend, Sales, ACOS, Click, Order. Ví dụ Spend ≥ 50 và ACOS ≥ 40 để ra nhóm cần xử lý gấp.",
        side: "bottom",
      },
      {
        target: "mb-sku-paused",
        title: "Gồm paused",
        body: "Mặc định chỉ tính target và campaign đang chạy. Tick để xem cả cái đã tắt, ví dụ khi muốn bật lại.",
        side: "bottom",
      },
      {
        target: "mb-sku-table",
        title: "Sắp xếp theo cột",
        body: "Bấm tiêu đề cột (Spend, Sales, ACOS, Tồn) để sắp xếp. Xếp Spend giảm dần để xử lý SKU tiêu nhiều tiền trước.",
        side: "top",
      },
    ],
  },
  {
    id: "mb-khoanh-vung-acos",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Khoanh vùng target theo ACOS",
    summary: "Nhóm dạng chạy SP03 / SB05 / SB01 / SD, chip nấc ACOS (0–20%, 20–40%, 40–60%, >60%), chip “0 order >7 click”, chip “Đã sửa”.",
    whenToUse: "Hỏi ý nghĩa các nấc ACOS, cách lọc target lỗ, target chưa có đơn, chuyển dạng chạy SP/SB/SD.",
    cleanup: [closeTargetDetail],
    steps: [
      {
        target: ["mb-run-type-group", "mb-target-table"],
        title: "Chọn dạng chạy",
        body: "Target gom theo dạng chạy <b>SP03, SB05, SB01, SD</b>. Bấm một dạng để chỉ xem target của dạng đó.",
        before: openFirstSku,
        side: "bottom",
      },
      {
        target: ["mb-tier-chips", "mb-target-table"],
        title: "Chip nấc ACOS",
        body: "Target chia theo ACOS: “0–20%”, “20–40%”, “40–60%”, “&gt;60%”, và “Khác” cho target chưa có đơn, click còn ít. Tour vừa bấm “&gt;60%” để chỉ xem nấc đó.",
        before: pickTier("mb-tier-a60p"),
        side: "bottom",
      },
      {
        target: ["mb-tier-bleeding", "mb-tier-chips"],
        title: "Chip 0 order >7 click",
        body: "Target có hơn 7 click mà chưa ra đơn nào trong kỳ, tour vừa bấm để lọc. Đây là nhóm nên hạ bid mạnh hoặc dừng trước.",
        before: pickTier("mb-tier-bleeding"),
        side: "bottom",
      },
      {
        target: ["mb-chip-edited", "mb-tier-chips"],
        title: "Chọn nhiều nấc",
        body: "Giữ <b>⌘</b> (Mac) hoặc <b>Ctrl</b> (Windows) khi bấm để chọn nhiều nấc. Chip “Đã sửa” gom mọi target bạn đã đổi bid của SKU này.",
        side: "bottom",
      },
    ],
  },
  {
    id: "mb-sua-hang-loat",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Sửa bid hàng loạt",
    summary: "Chọn nhiều target → Nhân theo %, Cộng / trừ, hoặc Set $. Bid luôn giữ trong khoảng $0.02 (SB $0.10) tới $100.",
    whenToUse: "Hỏi cách chỉnh bid cho nhiều target cùng lúc, giảm đồng loạt theo %, cộng/trừ số tiền, set bid cố định, giới hạn trần sàn.",
    cleanup: [closeTargetDetail],
    steps: [
      {
        target: "mb-target-select-all",
        title: "Chọn target cần sửa",
        body: "Tour vừa tick ô tiêu đề để chọn hết, kết thúc sẽ bỏ chọn. Bạn cũng tick được từng dòng, hoặc giữ chuột kéo dọc như Excel.",
        before: [...openFirstSku, ...selectRows],
        side: "bottom",
      },
      {
        target: ["mb-batch-tools", "mb-target-table"],
        title: "Thanh công cụ hàng loạt",
        body: "Thanh tím hiện khi có target được chọn. Bid mới luôn nằm trong <b>$0.02 (SB $0.10) tới $100</b>, ô xanh là tăng, ô đỏ là giảm.",
        side: "bottom",
      },
      {
        target: ["mb-batch-mul", "mb-batch-tools"],
        title: "Nhân theo %",
        body: "Gõ <b>95%</b> (hoặc 0.95) rồi Enter để hạ 5%, gõ <b>110%</b> để tăng 10%. Áp dụng cho mọi target đang chọn.",
        side: "bottom",
      },
      {
        target: ["mb-batch-add", "mb-batch-tools"],
        title: "Cộng / trừ và Set $",
        body: "“Cộng / trừ”: gõ +0.1 hoặc -0.25 (đơn vị $). “Set $”: gõ 0.75 để mọi target cùng một bid.",
        side: "bottom",
      },
      {
        target: "mb-approve-btn",
        title: "Bấm Duyệt",
        body: "Sửa xong bấm “Duyệt” để đưa vào Action Queue. Bid trên Amazon chỉ đổi sau khi bạn xuất file hoặc Auto Upload.",
        side: "left",
      },
    ],
  },
  {
    id: "mb-sua-tung-o",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Sửa từng ô như Excel",
    summary: "Gõ vào ô Bid mới, Enter / Tab / mũi tên để di chuyển, nhấp đúp lấy bid cũ, dán cả cột từ Excel.",
    whenToUse: "Hỏi cách gõ sửa bid trực tiếp, phím tắt di chuyển ô, nhấp đúp lấy bid cũ, dán cột từ Excel.",
    cleanup: [closeTargetDetail],
    steps: [
      {
        target: ["mb-target-first-bid", "mb-target-first-new-bid"],
        title: "Cột Bid hiện tại",
        body: "Bid đang chạy trên Amazon. Dòng “(chờ: $…)” nghĩa là đã có thay đổi nằm trong Action Queue, chưa đẩy.",
        before: openFirstSku,
        side: "left",
      },
      {
        target: "mb-target-first-new-bid",
        title: "Gõ và di chuyển",
        body: "Gõ số vào ô “Bid mới”. <b>Enter</b>, <b>Tab</b> hoặc <b>↓</b> sang dòng dưới, <b>↑</b> hoặc <b>Shift+Tab</b> lên dòng trên.",
        side: "left",
      },
      {
        target: "mb-target-first-new-bid",
        title: "Nhấp đúp và dán cột",
        body: "Nhấp đúp để chép bid hiện tại sang ô mới rồi chỉnh. Dán một cột số từ Excel vào ô đầu tiên để điền lần lượt xuống dưới.",
        side: "left",
      },
      {
        target: "mb-approve-btn",
        title: "Bấm Duyệt",
        body: "Gõ xong bấm “Duyệt” để đưa vào Action Queue. Chưa duyệt thì bid đã gõ chỉ là bản nháp.",
        side: "left",
      },
    ],
  },
  {
    id: "mb-dung-target-lo",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Dừng target lỗ",
    summary: "Lọc chip “0 order >7 click” hoặc “>60%” → chọn → “Dừng” → Duyệt → đẩy từ Action Queue.",
    whenToUse: "Hỏi cách dừng target, tắt keyword lỗ, xử lý target không ra đơn, pause hàng loạt.",
    cleanup: [closeQueue, closeTargetDetail],
    steps: [
      {
        target: ["mb-tier-bleeding", "mb-tier-chips"],
        title: "Lọc target lỗ",
        body: "Tour vừa bấm chip “0 order &gt;7 click” để chỉ xem nhóm target kém nhất. Chip “&gt;60%” dùng tương tự.",
        before: [...openFirstSku, ...pickTier("mb-tier-bleeding")],
        side: "bottom",
      },
      {
        target: ["mb-batch-pause", "mb-batch-tools", "mb-target-table"],
        title: "Chọn rồi bấm Dừng",
        body: "Tour vừa chọn hết target đang lọc. Bấm “Dừng” trên thanh tím để đánh dấu tạm dừng, Amazon chưa đổi gì.",
        before: selectRows,
        side: "bottom",
      },
      {
        target: "mb-approve-btn",
        title: "Bấm Duyệt",
        body: "“Duyệt” đưa lệnh dừng vào Action Queue cùng các thay đổi bid khác.",
        side: "left",
      },
      {
        target: ["aq-table", "aq-drawer"],
        title: "Đẩy lệnh dừng",
        body: "Lệnh dừng hiện trong Action Queue như mọi thay đổi khác. Xuất Bulk File hoặc Auto Upload thì target mới thật sự tắt trên Amazon.",
        before: openQueue,
        side: "left",
      },
    ],
  },
  {
    id: "mb-kiem-tra-duyet",
    page: PPC_MANUAL_BID_GUIDE_PAGE,
    kind: "extra",
    title: "Kiểm tra, duyệt và đẩy",
    summary: "Chip “Đã sửa” → Huỷ hoặc Duyệt → kiểm tra Action Queue → Xuất Bulk File / Auto Upload AdsPower → xem kết quả.",
    whenToUse: "Hỏi duyệt xong làm gì tiếp, nút Duyệt ở đâu, huỷ nháp thế nào, kiểm tra Action Queue, xuất file bulk hoặc Auto Upload.",
    cleanup: [
      { type: "click", target: "aq-export-cancel", ifPresent: true },
      { type: "click", target: "aq-au-cancel", ifPresent: true },
      closeQueue,
      closeTargetDetail,
    ],
    steps: [
      {
        target: ["mb-chip-edited", "mb-tier-chips"],
        title: "Rà lại chip Đã sửa",
        body: "Bấm chip “Đã sửa” để xem mọi target bạn đã đổi bid của SKU này, ở mọi dạng chạy.",
        before: openFirstSku,
        side: "bottom",
      },
      {
        target: ["mb-cancel-drafts", "mb-approve-btn"],
        title: "Huỷ hoặc Duyệt",
        body: "“Huỷ” bỏ mọi bid đang gõ dở. “Duyệt” đưa chúng vào Action Queue của store.",
        side: "left",
      },
      {
        target: ["aq-table", "aq-drawer"],
        title: "Kiểm tra Action Queue",
        body: "Thay đổi gom theo SKU, Old → New bid. Sửa New bid hoặc xoá dòng nhầm, chưa đẩy thì Amazon chưa đổi gì.",
        before: openQueue,
        side: "left",
      },
      {
        target: "aq-export-btn",
        title: "Xuất Bulk File",
        body: "Tải file để bạn tự upload ở Bulk operations của Amazon Ads. Dùng khi muốn xem file trước khi áp dụng.",
        side: "top",
      },
      {
        target: "aq-auto-upload-btn",
        title: "Auto Upload AdsPower",
        body: "Mở hộp chọn phạm vi, xác nhận xong Mac mini upload qua AdsPower. Bấm xác nhận sẽ đổi bid thật trên Amazon.",
        side: "top",
      },
      {
        target: ["aq-history", "aq-drawer"],
        title: "Xem kết quả upload",
        body: "Mỗi lượt Auto Upload hiện trạng thái Thành công, Thành công một phần hoặc Thất bại. Bấm “Chi tiết” để xem phản hồi của Amazon cho từng thay đổi.",
        side: "left",
      },
    ],
  },
];

const ORDER = [
  "mb-a-to-z",
  "mb-tim-sku",
  "mb-khoanh-vung-acos",
  "mb-sua-hang-loat",
  "mb-sua-tung-o",
  "mb-dung-target-lo",
  "mb-kiem-tra-duyet",
];

if (ORDER.length !== TOURS.length) throw new Error("ORDER phải liệt kê đủ 7 kịch bản hướng dẫn Manual Bid.");

export const PPC_MANUAL_BID_TOURS: GuideTour[] = ORDER.map((id) => {
  const tour = TOURS.find((t) => t.id === id);
  if (!tour) throw new Error(`Thiếu kịch bản ${id}`);
  return tour;
});

export function getPpcManualBidTour(id: string) {
  return PPC_MANUAL_BID_TOURS.find((t) => t.id === id) ?? null;
}
