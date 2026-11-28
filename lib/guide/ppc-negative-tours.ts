import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn tab PPC "Negative Keyword" (ST Optimization). Viết theo skill .claude/skills/ppc-guided-tour.
// 6 luồng: từ A-Z, chỉnh ngưỡng lọc, vì sao an toàn, Negative List cho ASIN, xuất file & xác nhận lô, theo dõi Hub.
// Lưu ý logic (đối chiếu code 2026-11-28):
// - Tab con "Đề Xuất Phủ Định ST": "Xuất Bulksheet" ghi term vào Negative Hub NGAY khi xuất (state enabled), không chờ xác nhận.
// - Tab con "Negative List": "Xuất File" tạo lô chờ, phải bấm "Đã upload" mới sang Hub; "Auto Upload" tự sang khi Mac mini xong.

export const PPC_NEGATIVE_GUIDE_PAGE = "ppc-negative";

const wait = (ms: number): GuideAction => ({ type: "wait", ms });
const switchToCandidates: GuideAction[] = [{ type: "click", target: "neg-subtab-candidates", ifPresent: true }, wait(400)];
const switchToNegativeList: GuideAction[] = [{ type: "click", target: "neg-subtab-negative-list", ifPresent: true }, wait(400)];
const switchToRegistry: GuideAction[] = [{ type: "click", target: "neg-subtab-registry", ifPresent: true }, wait(400)];
const openAutoUploadModal: GuideAction[] = [
  ...switchToCandidates,
  { type: "click", target: "neg-auto-upload-btn", ifPresent: true },
  wait(500),
];
const closeAutoUploadModal: GuideAction = { type: "click", target: "neg-modal-cancel", ifPresent: true };
const backToCandidates: GuideAction = { type: "click", target: "neg-subtab-candidates", ifPresent: true };
const closeNlModal: GuideAction = { type: "click", target: "neg-nl-modal-cancel", ifPresent: true };
/** Tick term đầu tiên làm mẫu; kết thúc tour tự bỏ tick. */
const tickFirstTerm: GuideAction[] = [{ type: "click", target: "neg-row-first-checkbox", ifPresent: true, ensure: "on", undo: true }, wait(400)];

const TOURS: GuideTour[] = [
  {
    id: "neg-a-to-z",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "main",
    title: "Phủ định Negative KW",
    summary: "Chọn store → lọc term Orders = 0, Clicks > 20 → chọn term → Auto Upload hoặc Xuất Bulksheet → xem ở Negative Hub.",
    whenToUse: "Người mới, hỏi quy trình phủ định từ đầu tới cuối, cách cắt lỗ search term, bắt đầu từ đâu, tổng quan A-Z.",
    cleanup: [closeAutoUploadModal, backToCandidates],
    steps: [
      {
        title: "Phủ định Negative KW",
        body: "Tour đi từ lọc term tốn tiền mà không ra đơn tới lúc term nằm trong <b>Negative Hub</b>. Cần chọn 1 store cụ thể trước khi bắt đầu.",
        before: switchToCandidates,
      },
      {
        target: "ppc-store-select",
        title: "Chọn 1 store",
        body: "Phủ định chạy trên tài khoản Amazon của từng store. Ở “Tất cả store” thì nút Auto Upload bị khoá.",
        side: "bottom",
      },
      {
        target: "neg-rule-clicks",
        title: "Ngưỡng lọc term lãng phí",
        body: "Bảng chỉ lấy term có <b>Orders = 0 và Clicks &gt; 20</b> trong kỳ đang chọn. Đây là những term tốn tiền nhiều nhất mà chưa bán được đơn nào.",
        side: "bottom",
      },
      {
        target: "neg-metrics",
        title: "Tiền lãng phí ước tính",
        body: "Thẻ “Tiền lãng phí (Cắt lỗ)” là số tiền các term này đã tiêu trong kỳ. Đó là khoản bạn ngừng mất nếu phủ định chúng.",
        side: "bottom",
      },
      {
        target: ["neg-row-first-checkbox", "neg-table"],
        title: "Tick term cần phủ định",
        body: "Tour vừa tick term đầu tiên làm mẫu. Không tick dòng nào thì <b>mọi term đang lọc</b> đều được phủ định.",
        before: tickFirstTerm,
        side: "right",
      },
      {
        target: "neg-export-bulksheet",
        title: "Cách 1: Xuất Bulksheet",
        body: "Tải file rồi tự upload ở Bulk operations của Amazon Ads. Bấm sẽ ghi term vào Negative Hub ngay, nên nhớ upload file.",
        side: "bottom",
      },
      {
        target: "neg-auto-upload-btn",
        title: "Cách 2: Auto Upload AdsPower",
        body: "Nút này chỉ mở hộp kiểm tra, chưa đẩy gì. Tour sẽ mở thử cho bạn xem.",
        side: "bottom",
      },
      {
        target: ["neg-modal-confirm", "neg-auto-upload-btn"],
        title: "Xác nhận đẩy lên Amazon",
        body: "Đọc lại số term và campaign rồi bấm “Xác Nhận & Đẩy Lên Amazon”. Bấm sẽ để Mac mini phủ định thật, tour dừng ở đây để bạn tự quyết.",
        before: openAutoUploadModal,
        side: "top",
      },
      {
        target: "neg-hub-table",
        title: "Kết quả ở Negative Hub",
        body: "Mỗi lần phủ định là một lô trong tab “Negative Hub”. Term đã ở đây sẽ không hiện lại trong bảng đề xuất.",
        before: [closeAutoUploadModal, wait(300), ...switchToRegistry],
        side: "top",
        missingText: "Store này chưa có lô phủ định nào. Lô sẽ hiện ở đây sau lần Auto Upload hoặc Xuất Bulksheet đầu tiên.",
      },
    ],
  },
  {
    id: "neg-chinh-nguong",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "extra",
    title: "Chỉnh ngưỡng lọc lãng phí",
    summary: "Đổi ngưỡng Clicks (> hoặc ≥), ẩn hoặc hiện term đã phủ định, lọc theo campaign nguồn.",
    whenToUse: "Muốn đổi số click lọc, chỉnh ngưỡng 20 click, ẩn từ đã phủ định, chỉ xem 1 campaign.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "ppc-store-select",
        title: "Kiểm tra store",
        body: "Ngưỡng áp dụng cho store đang chọn. Đổi store thì bảng tải lại với cùng ngưỡng.",
        before: switchToCandidates,
        side: "bottom",
      },
      {
        target: "neg-rule-clicks",
        title: "Đổi ngưỡng Clicks",
        body: "Mặc định là <b>Clicks &gt; 20</b>. Hạ xuống 10–15 để bắt term lãng phí sớm hơn, đổi lại có thể chặn nhầm term sắp ra đơn.",
        side: "bottom",
      },
      {
        target: "neg-hide-negated",
        title: "Ẩn từ khóa đã phủ định",
        body: "Tour vừa bỏ tick để hiện cả term đã có trong Negative Hub, kết thúc sẽ tick lại. Bỏ tick khi muốn xem lại toàn bộ.",
        before: [{ type: "click", target: "neg-hide-negated", ensure: "off", undo: true }, wait(600)],
        side: "bottom",
      },
      {
        target: "neg-filter-campaign",
        title: "Lọc theo campaign nguồn",
        body: "Chọn một campaign để chỉ xử lý term của campaign đó.",
        side: "bottom",
      },
      {
        target: "neg-metrics",
        title: "Số liệu đổi theo ngưỡng",
        body: "Số term và “Tiền lãng phí (Cắt lỗ)” tính lại ngay theo ngưỡng mới. Dùng để so sánh trước khi phủ định.",
        side: "bottom",
      },
    ],
  },
  {
    id: "neg-vi-sao-an-toan",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "extra",
    title: "Vì sao phủ định an toàn",
    summary: "Mỗi term chỉ bị phủ định Negative Exact trong đúng campaign nguồn, các campaign khác vẫn chạy term đó.",
    whenToUse: "Hỏi phủ định có ảnh hưởng campaign khác không, an toàn thế nào, Negative Exact hoạt động ra sao.",
    cleanup: [closeAutoUploadModal],
    steps: [
      {
        target: "neg-table",
        title: "Cột Source Campaign",
        body: "Mỗi term gắn với campaign nơi nó tiêu tiền. Phủ định chỉ đặt vào đúng campaign đó.",
        before: switchToCandidates,
        side: "top",
      },
      {
        target: "neg-auto-upload-btn",
        title: "Hộp kiểm tra trước khi đẩy",
        body: "“⚡ Auto Upload AdsPower” không đẩy ngay mà mở hộp xem trước. Bạn đọc lại rồi mới quyết định.",
        side: "bottom",
      },
      {
        target: "neg-modal-safety",
        title: "Chỉ phủ định trong campaign nguồn",
        body: "Hệ thống tạo <b>Negative Exact</b> trong đúng campaign và ad group nguồn của từng term. Ở campaign khác, term vẫn chạy bình thường.",
        before: openAutoUploadModal,
        side: "bottom",
      },
      {
        target: "neg-modal-cancel",
        title: "Huỷ không đổi gì",
        body: "Bấm “Hủy” để đóng hộp. Chưa bấm xác nhận thì Amazon chưa thay đổi gì.",
        side: "top",
      },
    ],
  },
  {
    id: "neg-negative-list",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "main",
    title: "Negative theo list KW",
    summary: "Tìm ASIN → chọn gợi ý → chọn match type → dán list keyword → kiểm tra số dòng → Xuất File hoặc Auto Upload → lô sang Negative Hub.",
    whenToUse: "Muốn phủ định theo list từ ngoài vào, dán keyword từ Google Sheet, Negative Phrase cho cả ASIN, cách dùng tab Negative List.",
    // Kết thúc ngay trên tab Negative List: rời tab thì component bị gỡ, không trả lại được chữ đã gõ mẫu.
    cleanup: [closeNlModal],
    steps: [
      {
        target: "neg-nl-asin-input",
        title: "Tìm ASIN hoặc SKU",
        body: "Tour vừa gõ “B0” (đầu mọi ASIN) để hiện gợi ý. Bạn gõ một phần ASIN hoặc SKU, tối thiểu 2 ký tự.",
        before: [...switchToNegativeList, { type: "type", target: "neg-nl-asin-input", value: "B0" }, wait(1200)],
        side: "bottom",
      },
      {
        target: ["neg-nl-campaign-list", "neg-nl-asin-input"],
        title: "Chọn ASIN, campaign tự chọn",
        body: "Tour vừa chọn gợi ý đầu tiên, kết thúc sẽ bỏ ra. Campaign đang chạy của ASIN được tự tick, campaign SD bị khoá vì không hỗ trợ Negative Keyword.",
        before: [{ type: "click", target: "neg-nl-suggestion-first", ifPresent: true, ensure: "on", undo: "neg-nl-pick-remove-last" }, wait(1800)],
        side: "left",
      },
      {
        target: "neg-nl-match-type",
        title: "Chọn match type",
        body: "<b>Negative Phrase</b> chặn mọi search term chứa cụm đó, <b>Negative Exact</b> chỉ chặn đúng cụm đó. Tour vừa chuyển sang Exact làm mẫu, list keyword rác thường dùng Phrase.",
        before: [{ type: "click", target: "neg-nl-match-exact", ensure: "on", undo: "neg-nl-match-phrase" }, wait(400)],
        side: "bottom",
      },
      {
        target: "neg-nl-keywords-input",
        title: "Dán list keyword",
        body: "Tour vừa dán 3 keyword mẫu, kết thúc sẽ trả lại nội dung cũ. Bạn dán cả cột từ Google Sheet, mỗi dòng một keyword, dòng trùng tự bị bỏ.",
        before: [{ type: "type", target: "neg-nl-keywords-input", value: "free\ncheap\nused" }, wait(500)],
        side: "right",
      },
      {
        target: "neg-nl-stats",
        title: "Kiểm tra số dòng",
        body: "“Tổng dòng phủ định” = số keyword × số campaign đã chọn. Đọc số này trước khi đẩy.",
        side: "bottom",
      },
      {
        target: "neg-nl-export-btn",
        title: "Cách 1: Xuất File",
        body: "Tải file rồi tự upload. Bấm sẽ tạo lô ở “Lô chờ xác nhận”, upload xong phải bấm “Đã upload”.",
        side: "bottom",
      },
      {
        target: ["neg-nl-modal-confirm", "neg-nl-auto-upload-btn"],
        title: "Cách 2: Auto Upload",
        body: "Tour vừa mở hộp xác nhận, chưa đẩy gì. Bấm “Xác nhận Upload” sẽ để Mac mini phủ định thật, lô tự sang Negative Hub khi xong.",
        before: [{ type: "click", target: "neg-nl-auto-upload-btn", ifPresent: true }, wait(700)],
        side: "top",
      },
      {
        target: "neg-subtab-registry",
        title: "Kết quả ở Negative Hub",
        body: "Lô đã xong nằm ở tab “Negative Hub”, kèm số dòng và campaign được phủ định.",
        before: [closeNlModal, wait(300)],
        side: "bottom",
      },
    ],
  },
  {
    id: "neg-xac-nhan-lo",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "extra",
    title: "Xác nhận lô sau Xuất File",
    summary: "Negative List: Xuất File xong phải bấm “Đã upload” thì lô mới sang Negative Hub. Lỡ chưa upload thì bấm Auto Upload trên lô.",
    whenToUse: "Xuất file xong làm gì tiếp, nút Đã upload ở đâu, vì sao lô chưa sang Negative Hub, xác nhận lô, lô chờ.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "neg-nl-export-btn",
        title: "Xuất File tạo lô chờ",
        body: "Mỗi lần bấm “Xuất File” ở Negative List tạo một lô chờ. Hệ thống chưa biết bạn đã upload file hay chưa.",
        before: switchToNegativeList,
        side: "bottom",
      },
      {
        target: ["neg-nl-pending-batches", "neg-nl-export-btn"],
        title: "Lô chờ xác nhận",
        body: "Lô ở đây <b>chưa tính là đã phủ định</b>. Vì vậy term trong lô vẫn có thể hiện lại ở bảng đề xuất.",
        side: "bottom",
      },
      {
        target: ["neg-nl-confirm-uploaded-btn", "neg-nl-pending-batches"],
        title: "Bấm “Đã upload”",
        body: "Upload file lên Amazon xong thì bấm “Đã upload” trên đúng lô đó. Bấm sẽ chuyển lô sang Negative Hub.",
        optional: true,
        side: "left",
      },
      {
        target: ["neg-nl-pending-batches", "neg-nl-export-btn"],
        title: "Lỡ xuất mà chưa upload",
        body: "Bấm “Auto Upload” trên lô để Mac mini upload thay bạn. Không cần xuất file lại.",
        optional: true,
        side: "bottom",
      },
      {
        target: "neg-subtab-registry",
        title: "Kết quả ở Negative Hub",
        body: "Lô đã xác nhận nằm ở tab “Negative Hub”.",
        side: "bottom",
      },
    ],
  },
  {
    id: "neg-theo-doi-hub",
    page: PPC_NEGATIVE_GUIDE_PAGE,
    kind: "extra",
    title: "Theo dõi Negative Hub",
    summary: "Tổng số dòng đã phủ định, tiền lãng phí đã chặn, lịch sử từng lô, và điều cần biết trước khi xoá lô.",
    whenToUse: "Negative Hub, xem lại lịch sử các đợt phủ định, xoá lô có gỡ trên Amazon không, theo dõi kết quả.",
    cleanup: [backToCandidates],
    steps: [
      {
        target: "neg-subtab-registry",
        title: "Mở Negative Hub",
        body: "Tab này chứa mọi lô phủ định đã lên Amazon của store đang chọn.",
        before: switchToRegistry,
        side: "bottom",
      },
      {
        target: "neg-hub-summary",
        title: "Tổng quan đã chặn",
        body: "Tổng dòng phủ định, số campaign được bảo vệ và <b>chi phí lãng phí đã chặn</b>.",
        side: "bottom",
      },
      {
        target: "neg-hub-table",
        title: "Lịch sử từng lô",
        body: "Mỗi dòng là một lô, ghi cách đưa lên (Auto Upload hoặc Xuất File) và người làm. Bấm mũi tên đầu dòng để xem từng keyword.",
        side: "top",
      },
      {
        target: ["neg-hub-delete-btn", "neg-hub-table"],
        title: "Xoá lô không gỡ phủ định",
        body: "“Xoá lô” chỉ xoá lịch sử trong app, phủ định trên Amazon <b>vẫn giữ nguyên</b>. Muốn gỡ thì phải tắt keyword phủ định trên Amazon Ads.",
        side: "left",
      },
    ],
  },
];

export const PPC_NEGATIVE_TOURS: GuideTour[] = TOURS;
