import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn tab PPC "Lên Camp SKU Mới". Viết theo skill .claude/skills/ppc-guided-tour.
// 6 luồng: từ A-Z qua 5 bước, chọn loại chạy, file keyword, thông tin SB, sửa lỗi khi tạo, chọn đầu ra (zip / upload).
// Logic đối chiếu code 2026-11-28: store tự theo SKU (không chọn store); mỗi lượt chỉ 1 loại hình FBA hoặc FBM;
// budget mặc định $5/campaign; bid Phrase 90% / Broad 80% của Exact (Tùy chỉnh nâng cao); campaign upload lên ở trạng thái enabled.

export const PPC_NEW_CAMP_GUIDE_PAGE = "ppc-new-camp";

const closeConfirmModal: GuideAction = { type: "click", target: "nc-modal-cancel", ifPresent: true };
const wait = (ms: number): GuideAction => ({ type: "wait", ms });
/** Bật thử một thẻ dạng chạy (chỉ khi đang tắt); kết thúc tour tự tắt lại. */
const turnOn = (key: string): GuideAction[] => [{ type: "click", target: key, ensure: "on", undo: true }, wait(500)];
/** Kết quả: bảng tiến độ upload, hoặc thông báo đã tải zip; chưa làm lần nào thì làm sáng thanh nút cuối trang. */
const RESULT_TARGET = ["nc-upload-jobs", "nc-notices", "nc-btn-create-file"];

const TOURS: GuideTour[] = [
  {
    id: "newcamp-a-to-z",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "main",
    title: "Lên camp SKU mới",
    summary: "5 bước đánh số: ① Chọn SKU → ② Cấu hình chung → ③ Loại chạy → ④ File keyword → ⑤ Tên camp → TẠO FILE hoặc Upload lên Amazon.",
    whenToUse: "Người mới, hỏi quy trình lên camp SKU mới từ đầu tới cuối, bắt đầu từ đâu, tổng quan 5 bước A-Z.",
    cleanup: [closeConfirmModal],
    steps: [
      {
        title: "Lên camp SKU mới",
        body: "Tour đi qua 5 bước đánh số trên màn hình tới lúc có file zip hoặc campaign đã lên Amazon. Store tự lấy theo SKU, không cần chọn store.",
      },
      {
        target: "nc-step-1",
        title: "Chọn SKU",
        body: "Tìm hoặc dán danh sách SKU từ Bảng Mã. Mỗi lượt chỉ chạy một loại hình, FBA hoặc FBM, SKU khác loại sẽ bị bỏ ra.",
        side: "right",
      },
      {
        target: "nc-step-2",
        title: "Cấu hình chung",
        body: "Loại hình tự theo SKU. Bạn chọn trạng thái Test / Win và “Ngày lên camp”, cả hai được ghép vào tên campaign.",
        side: "right",
      },
      {
        target: "nc-step-3",
        title: "Chọn loại chạy",
        body: "Tour vừa bật SP03 làm mẫu: mỗi thẻ có budget riêng (mặc định $5/ngày). SP03, SB01, SB05 cần chọn thêm match type.",
        before: turnOn("nc-run-sp03-toggle"),
        side: "left",
      },
      {
        target: "nc-step-4",
        title: "Chuẩn bị file keyword",
        body: "SP03 và SB cần keyword: Upload file, chọn “Từ kho” hoặc “Tạo mới”. SP04 Auto và FL Asin không cần bước này.",
        side: "left",
      },
      {
        target: "nc-step-5",
        title: "Kiểm tra tên camp",
        body: "Đây là tên từng campaign sẽ tạo. Ô đỏ là tên trùng hoặc đã có trên Amazon, phải sửa trước khi tạo.",
        side: "top",
      },
      {
        target: "nc-btn-create-file",
        title: "TẠO FILE",
        body: "Bấm “TẠO FILE” để tải file zip, mỗi dạng chạy một file Excel, rồi tự upload ở Bulk operations của Amazon Ads. Bấm sẽ lưu luôn bộ keyword vào kho.",
        side: "top",
      },
      {
        target: "nc-btn-upload",
        title: "Hoặc Upload lên Amazon",
        body: "Bấm “Upload lên Amazon” rồi xác nhận để Mac mini tạo campaign qua AdsPower. Bấm xác nhận sẽ tạo campaign <b>đang chạy</b> và bắt đầu tiêu budget.",
        side: "top",
      },
      {
        target: RESULT_TARGET,
        title: "Xem kết quả",
        body: "Sau khi bấm, thông báo liệt kê các file đã tải, hoặc bảng “Upload lên Amazon” hiện tiến độ từng store. Chưa có thì bảng chưa xuất hiện.",
        side: "bottom",
      },
    ],
  },
  {
    id: "newcamp-loai-chay",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "extra",
    title: "Chọn loại chạy",
    summary: "SP03 / SB01 / SB05 cần keyword và match type; SP04 Auto cần bid 4 nhóm target; FL Asin cần bid và file ASIN Crawl.",
    whenToUse: "Chọn loại chạy nào, SP03 là gì, SP04 Auto là gì, FL Asin là gì, cài match type và budget, bid Phrase Broad.",
    cleanup: [],
    steps: [
      {
        target: ["nc-run-sp03", "nc-step-3"],
        title: "SP03 KW",
        body: "Sponsored Products chạy theo keyword, tour vừa bật thẻ để hiện cài đặt. Mỗi match type được chọn (Exact / Phrase / Broad) sinh một campaign riêng.",
        before: turnOn("nc-run-sp03-toggle"),
        side: "left",
      },
      {
        target: ["nc-run-sb01", "nc-step-3"],
        title: "SB01 và SB05",
        body: "Sponsored Brands dạng Collection (SB01) và Video (SB05), cũng dùng keyword. Cần Brand Entity ID, logo, video, thiếu thì panel thông tin SB hiện ra.",
        before: turnOn("nc-run-sb01-toggle"),
        side: "left",
      },
      {
        target: ["nc-run-sp04", "nc-step-3"],
        title: "SP04 Auto",
        body: "Campaign tự động, không cần keyword. Bạn đặt bid cho 4 nhóm Close, Loose, Complements, Substitutes.",
        before: turnOn("nc-run-sp04-toggle"),
        side: "left",
      },
      {
        target: ["nc-run-flasin", "nc-step-3"],
        title: "FL Asin",
        body: "Target thẳng vào ASIN trong file ASIN Crawl. Cần budget, bid và file ASIN Crawl.",
        before: turnOn("nc-run-flasin-toggle"),
        side: "left",
      },
      {
        target: ["nc-advanced", "nc-step-3"],
        title: "Tùy chỉnh nâng cao",
        body: "Mặc định bid Phrase = 90% và Broad = 80% bid Exact, kèm bidding strategy. Chỉ đổi khi bạn có lý do rõ ràng.",
        before: turnOn("nc-advanced-toggle"),
        side: "left",
      },
    ],
  },
  {
    id: "newcamp-file-keyword",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "extra",
    title: "Chuẩn bị file keyword",
    summary: "3 cách: Upload / Từ kho / Tạo mới. Điền đủ 4 ô lưu kho, mọi keyword cần bid từ $0.02.",
    whenToUse: "Cách nạp file keyword, lấy từ kho keyword, tạo mới keyword, lỗi bid dưới 0.02, 4 ô lưu kho, tải file keyword về.",
    cleanup: [],
    steps: [
      {
        target: "nc-step-4",
        title: "Khi nào cần keyword",
        body: "Chỉ SP03, SB01, SB05 cần file keyword, tour vừa bật SP03 để mở bước này. Không bật các dạng đó thì bỏ qua bước 4.",
        before: turnOn("nc-run-sp03-toggle"),
        side: "left",
      },
      {
        target: ["nc-kw-mode", "nc-step-4"],
        title: "Chọn một trong ba cách",
        body: "“Upload” lấy file Excel trên máy, “Từ kho” dùng bộ keyword team đã lưu, “Tạo mới” dán list keyword và nhập bid. Mỗi lượt chỉ dùng một cách.",
        side: "left",
      },
      {
        target: ["nc-kw-save-fields", "nc-step-4"],
        title: "Điền 4 ô lưu kho",
        body: "“Người lên camp”, “Ngách”, “Phôi”, “Bộ keyword” tự điền theo Bảng Mã, bạn sửa nếu sai. Bộ keyword được lưu vào kho để lần sau dùng lại.",
        side: "left",
      },
      {
        target: "nc-step-4",
        title: "Bid tối thiểu $0.02",
        body: "Với “Tạo mới”, mọi keyword phải có bid từ <b>$0.02</b>. Thiếu bid thì danh sách “Thiếu” chặn không cho tạo.",
        side: "left",
      },
    ],
  },
  {
    id: "newcamp-thong-tin-sb",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "extra",
    title: "Thông tin Sponsored Brands",
    summary: "SB01 / SB05 cần Brand Entity ID, logo, video. Thiếu thì điền ở panel “Thông tin SB còn thiếu”, vẫn tải zip được nhưng không upload tự động được.",
    whenToUse: "Lên camp SB bị thiếu thông tin, Brand Entity ID, logo video ở đâu, panel thông tin SB còn thiếu, không upload được SB.",
    cleanup: [],
    steps: [
      {
        target: ["nc-run-sb01", "nc-step-3"],
        title: "Bật SB01 hoặc SB05",
        body: "Tour vừa bật SB01 làm mẫu. Hai dạng này cần thông tin brand, đọc từ Bảng Mã của SKU và cài đặt của store.",
        before: turnOn("nc-run-sb01-toggle"),
        side: "left",
      },
      {
        target: ["nc-step-sb", "nc-step-3"],
        title: "Panel thông tin SB",
        body: "Panel hiện khi còn SKU thiếu Brand Entity ID, logo hoặc video. Chưa thấy panel nghĩa là đã đủ thông tin.",
        side: "top",
      },
      {
        target: ["nc-step-sb", "nc-step-3"],
        title: "Điền các ô đỏ",
        body: "Điền ô đỏ cho từng SKU, hoặc dùng “Điền chung” cho mọi SKU đang chọn. Phần này chỉ dùng cho lần tạo này, muốn lưu lâu dài thì sửa trong Bảng Mã.",
        side: "top",
      },
      {
        target: "nc-btn-upload",
        title: "Thiếu thì chỉ tải file",
        body: "Còn SKU thiếu thông tin SB thì “Upload lên Amazon” báo lỗi. “TẠO FILE” vẫn tải zip được.",
        side: "top",
      },
    ],
  },
  {
    id: "newcamp-sua-loi",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "extra",
    title: "Sửa lỗi khi bấm tạo",
    summary: "Đọc danh sách “Thiếu”, bấm “Đi tới” để nhảy về đúng bước; tên camp trùng hoặc đã có trên Amazon thì thêm đuôi tên.",
    whenToUse: "Bị báo lỗi không tạo được file, còn mục cần điền, nút Đi tới, tên camp bị trùng, camp đã có trên Amazon.",
    cleanup: [],
    steps: [
      {
        target: ["nc-issues-panel", "nc-btn-create-file"],
        title: "Danh sách mục còn thiếu",
        body: "Khung đỏ trên thanh nút liệt kê từng mục cần điền trước khi tạo file. Không thấy khung nghĩa là đã đủ.",
        side: "top",
      },
      {
        target: ["nc-issues-panel", "nc-btn-create-file"],
        title: "Bấm “Đi tới”",
        body: "Mỗi lỗi có nút “Đi tới” cuộn thẳng tới bước cần sửa. Sửa xong thì lỗi tự biến mất.",
        side: "top",
      },
      {
        target: "nc-step-5",
        title: "Tên camp đỏ",
        body: "Tên đỏ là trùng nhau hoặc đã có campaign cùng tên trên Amazon. Còn tên đỏ thì hệ thống không cho tạo.",
        side: "top",
      },
      {
        target: ["nc-name-suffix", "nc-step-5"],
        title: "Thêm đuôi tên",
        body: "Gõ đuôi như v2 hoặc 0526 vào ô “Đuôi tên” để mọi tên khác đi. Có thể sửa tay từng tên trong bảng.",
        side: "bottom",
      },
    ],
  },
  {
    id: "newcamp-dau-ra",
    page: PPC_NEW_CAMP_GUIDE_PAGE,
    kind: "extra",
    title: "TẠO FILE hay Upload",
    summary: "TẠO FILE tải zip để tự upload; Upload lên Amazon để Mac mini tạo campaign đang chạy, không hoàn tác được từ app.",
    whenToUse: "Tải file zip, tự upload bulksheet, upload thẳng lên Amazon, Mac mini AdsPower, xác nhận upload, khác nhau giữa tạo file và upload.",
    cleanup: [closeConfirmModal],
    steps: [
      {
        target: "nc-btn-create-file",
        title: "TẠO FILE",
        body: "Tải file zip gồm một file Excel cho mỗi dạng chạy (SP03, SB01, SB05, SP04, FL Asin). Dùng khi muốn xem file trước rồi tự upload.",
        side: "top",
      },
      {
        target: ["nc-notices", "nc-btn-create-file"],
        title: "Upload file zip",
        body: "Giải nén rồi upload từng file ở Bulk operations của Amazon Ads. Thông báo phía trên liệt kê tên và số dòng từng file.",
        side: "bottom",
      },
      {
        target: "nc-btn-upload",
        title: "Upload lên Amazon",
        body: "Mở hộp “Xác nhận upload lên Amazon” với tổng số campaign và budget. Không cần tải file.",
        side: "top",
      },
      {
        target: ["nc-modal-confirm", "nc-btn-upload"],
        title: "Xác nhận upload",
        body: "Campaign lên Amazon ở trạng thái <b>đang chạy</b> và tiêu budget ngay. Bấm sẽ không hoàn tác được từ app, nên kiểm tra tổng campaign và budget trước.",
        side: "top",
      },
      {
        target: RESULT_TARGET,
        title: "Theo dõi tiến độ",
        body: "Bảng “Upload lên Amazon” hiện từng job theo store, số campaign và trạng thái. Chưa upload lần nào thì bảng chưa xuất hiện.",
        side: "bottom",
      },
    ],
  },
];

export const PPC_NEW_CAMP_TOURS: GuideTour[] = TOURS;
