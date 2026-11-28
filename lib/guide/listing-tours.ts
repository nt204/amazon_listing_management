import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn màn "Bảng Trello Kanban & Listing". Viết theo skill .claude/skills/ppc-guided-tour.
// Phần tử trỏ tới bằng data-tour "lst-*" trong components/trello-board-view.tsx và components/listing-workspace.tsx.
// Logic đối chiếu code 2026-11-28:
// - Thẻ Trello ở cột đầu (chứa SKU, tên, ảnh, generic keywords) → AI tạo listing → đính kèm file Excel lên thẻ → chuyển thẻ sang cột đích.
// - Người dùng cần chọn AI Model, Thương hiệu (Brand), và Template (phải ở trạng thái "Sẵn sàng" mới chạy được).
// - Có 2 cách tạo listing:
//   1. Chạy lẻ từng thẻ: bấm "Tạo Listing" trên thẻ (hoặc kéo thả thẻ từ cột đầu sang cột đích).
//   2. Chạy Batch: tick chọn các thẻ → thanh bar nổi hiện lên → bấm "Batch Tạo Listing Cho N Thẻ" (chạy song song tối đa 2 thẻ).
// - Kết quả cuối: thẻ chuyển sang Cột đích kèm file `.xlsx` được đính kèm. Bấm "Tải Excel" để lấy file, hoặc vào "Lịch Sử Batch" để tải ZIP cả lô.
// KHÔNG tự bấm: Tạo Listing lẻ, Chạy Batch, Tải Excel, Lưu cấu hình. Nút nguy hiểm chỉ được làm sáng.

export const LISTING_GUIDE_PAGE = "listing";

const wait = (ms: number): GuideAction => ({ type: "wait", ms });

const openTrelloConfigModal: GuideAction[] = [{ type: "click", target: "lst-btn-trello-config" }, wait(700)];
const closeTrelloConfigModal: GuideAction = { type: "click", target: "lst-trello-modal-close", ifPresent: true };

const openBatchHistoryModal: GuideAction[] = [{ type: "click", target: "lst-btn-batch-history" }, wait(700)];
const closeBatchHistoryModal: GuideAction = { type: "click", target: "lst-history-modal-close", ifPresent: true };

const openTemplateModal: GuideAction[] = [{ type: "click", target: "lst-btn-add-template" }, wait(700)];
const closeTemplateModal: GuideAction = { type: "click", target: "lst-template-modal-close", ifPresent: true };

export const LISTING_TOURS: GuideTour[] = [
  {
    id: "lst-a-to-z",
    page: LISTING_GUIDE_PAGE,
    kind: "main",
    title: "Quy trình tạo Listing từ đầu tới cuối",
    summary: "Đi hết luồng: Chọn Model & Brand → Chọn Template sẵn sàng → Chọn thẻ Trello → Chạy AI tạo Listing → Cột đích & Tải file Excel.",
    whenToUse: "Người mới bắt đầu, hỏi quy trình tạo listing từ đầu đến cuối, cách xuất file listing cho sản phẩm Trello.",
    cleanup: [closeTrelloConfigModal, closeBatchHistoryModal, closeTemplateModal],
    steps: [
      {
        target: "lst-model-dropdown",
        title: "Chọn Model AI",
        body: "Chọn model AI phù hợp để sinh nội dung. Mặc định là <b>Gemini Flash</b> vừa nhanh vừa tiết kiệm chi phí.",
        side: "bottom",
      },
      {
        target: "lst-brand-dropdown",
        title: "Chọn Thương hiệu",
        body: "Chọn đúng Brand của shop để AI nạp đúng giọng văn và các mẫu câu thương hiệu chuẩn.",
        side: "bottom",
      },
      {
        target: "lst-template-dropdown",
        title: "Chọn Template Listing",
        body: "Template phải có nhãn <b>Sẵn sàng</b> (màu xanh). Nếu báo “Cần cấu hình”, hãy bấm nút <b>+</b> bên cạnh để bổ sung trường bắt buộc.",
        side: "bottom",
      },
      {
        target: "lst-source-col",
        title: "Cột đầu chờ duyệt",
        body: "Danh sách sản phẩm từ Trello chứa ảnh, tên phôi và SKU. Bạn duyệt thông tin tại đây trước khi tạo.",
        side: "right",
      },
      {
        target: "lst-card-item",
        title: "Thẻ sản phẩm cần lên Listing",
        body: "Mỗi thẻ thể hiện SKU, số lượng ảnh đính kèm và từ khóa gợi ý. Bạn có thể kéo thả thẻ sang cột đích để xử lý.",
        side: "right",
      },
      {
        target: "lst-btn-process-single",
        title: "Tạo Listing cho thẻ",
        body: "Bấm “Tạo Listing” để AI đọc ảnh, viết bullet points, mô tả và điền template. <b>Bấm sẽ gọi AI và đính kèm file</b> lên Trello.",
        side: "left",
      },
      {
        target: "lst-target-col",
        title: "Cột đích: Listing hoàn thành",
        body: "Thẻ sau khi xử lý thành công sẽ tự động chuyển sang đây. Bạn có thể kiểm tra danh sách sản phẩm đã xong.",
        side: "left",
      },
      {
        target: "lst-btn-download-excel",
        title: "Tải file Excel Listing",
        body: "Bấm “Tải Excel” để nhận file <b>.xlsx hoàn chỉnh</b> sẵn sàng upload lên Amazon Seller Central.",
        side: "left",
      },
    ],
  },
  {
    id: "lst-chon-template",
    page: LISTING_GUIDE_PAGE,
    kind: "extra",
    title: "Kiểm tra và cấu hình Template",
    summary: "Phân biệt Template “Sẵn sàng” vs “Cần cấu hình”, cách thêm và điền trường bắt buộc cho file Excel.",
    whenToUse: "Bị lỗi không tạo được listing do template, hỏi về template sẵn sàng hoặc cần cấu hình, thêm template mới.",
    cleanup: [closeTemplateModal],
    steps: [
      {
        target: "lst-template-dropdown",
        title: "Trạng thái Template",
        body: "Template có huy hiệu xanh <b>Sẵn sàng</b> mới dùng được để xuất file. Huy hiệu vàng “Cần cấu hình” là còn thiếu trường.",
        side: "bottom",
      },
      {
        target: "lst-btn-add-template",
        title: "Quản lý và Thêm Template",
        body: "Bấm nút “+” để mở hộp thoại quản lý template, tải file mẫu mới hoặc điền giá trị mặc định cho các cột.",
        side: "bottom",
      },
      {
        target: "lst-btn-add-template",
        title: "Điền đủ trường bắt buộc",
        before: openTemplateModal,
        body: "File Excel mẫu cần ánh xạ đủ các trường bắt buộc của ngành hàng. Điền xong bấm Lưu để chuyển sang trạng thái <b>Sẵn sàng</b>.",
        side: "left",
      },
      {
        target: "lst-template-dropdown",
        title: "Chọn lại Template đã sửa",
        body: "Sau khi cấu hình đủ, mở lại danh sách dropdown và chọn template vừa hoàn thiện để bắt đầu chạy.",
        side: "bottom",
      },
    ],
  },
  {
    id: "lst-chay-batch",
    page: LISTING_GUIDE_PAGE,
    kind: "main",
    title: "Chạy Batch tạo Listing nhiều thẻ",
    summary: "Tick chọn hàng loạt thẻ → Thanh bar nổi hiện lên → Chạy batch song song 2 thẻ → Theo dõi tiến độ.",
    whenToUse: "Có nhiều thẻ cần xử lý cùng lúc, hỏi cách chạy batch listing, cách tạo listing hàng loạt.",
    cleanup: [closeBatchHistoryModal],
    steps: [
      {
        target: "lst-select-all",
        title: "Chọn nhanh nhiều thẻ",
        body: "Bấm checkbox đầu cột để chọn tất cả các thẻ trong trang, hoặc tick vào từng thẻ sản phẩm bạn muốn tạo.",
        side: "bottom",
      },
      {
        target: "lst-card-item",
        title: "Chọn lọc từng thẻ",
        body: "Có thể tick chọn riêng các SKU cần ưu tiên lên listing trước. Số lượng thẻ đã chọn sẽ hiện ở thanh bên dưới.",
        side: "right",
      },
      {
        target: "lst-batch-bar",
        title: "Thanh công cụ Batch nổi",
        body: "Khi có ít nhất 1 thẻ được tick, thanh thao tác màu xanh sẽ xuất hiện để bạn điều khiển đợt chạy hàng loạt.",
        side: "top",
      },
      {
        target: "lst-btn-batch-run",
        title: "Bắt đầu chạy Batch",
        body: "Hệ thống tự động chạy tối đa 2 thẻ song song để đảm bảo ổn định. <b>Bấm sẽ gọi AI và tạo file cho tất cả thẻ đã tick</b>.",
        side: "top",
      },
      {
        target: "lst-btn-batch-history",
        title: "Xem Lịch sử Batch",
        body: "Mở mục “Lịch Sử Batch” để theo dõi các mẻ đang chạy, tỉ lệ thành công và tải trọn gói file ZIP về máy.",
        side: "bottom",
      },
    ],
  },
  {
    id: "lst-tai-excel",
    page: LISTING_GUIDE_PAGE,
    kind: "extra",
    title: "Tải file Excel và kiểm tra kết quả",
    summary: "Tải file lẻ ở Cột đích hoặc tải file ZIP trọn gói cả lô từ Lịch Sử Batch.",
    whenToUse: "Tìm file excel ở đâu, cách tải file listing về máy, tải trọn gói zip của cả mẻ chạy.",
    cleanup: [closeBatchHistoryModal],
    steps: [
      {
        target: "lst-target-col",
        title: "Cột đích đã xong",
        body: "Mọi thẻ sau khi tạo file Excel thành công đều nằm ở cột này kèm ngày giờ và SKU.",
        side: "left",
      },
      {
        target: "lst-btn-download-excel",
        title: "Tải file Excel của từng thẻ",
        body: "Bấm “Tải Excel” trên thẻ để tải trực tiếp file <b>.xlsx</b> của sản phẩm đó về máy tính.",
        side: "left",
      },
      {
        target: "lst-btn-batch-history",
        title: "Mở Lịch Sử Batch",
        body: "Nếu vừa chạy batch nhiều thẻ, hãy mở “Lịch Sử Batch” để gom tất cả file vào một nơi.",
        side: "bottom",
      },
      {
        target: "lst-btn-batch-history",
        title: "Tải trọn gói 1 File ZIP",
        before: openBatchHistoryModal,
        body: "Mỗi đợt chạy batch có nút <b>Tải 1 File ZIP</b> giúp bạn tải nhanh toàn bộ file Excel của đợt đó chỉ trong một click.",
        side: "bottom",
      },
    ],
  },
  {
    id: "lst-cau-hinh-trello",
    page: LISTING_GUIDE_PAGE,
    kind: "extra",
    title: "Cấu hình Board và Cột Trello",
    summary: "Kết nối Board ID Trello, chọn Cột đầu nhận việc và Cột đích trả file hoàn thành.",
    whenToUse: "Đổi bảng Trello, không thấy thẻ nào hiển thị, cấu hình lại cột đầu hoặc cột đích cho Listing.",
    cleanup: [closeTrelloConfigModal],
    steps: [
      {
        target: "lst-btn-trello-config",
        title: "Nút Cấu hình Trello",
        body: "Nằm ở góc trên bên phải màn hình. Bấm vào đây để mở hộp thoại cài đặt kết nối Trello.",
        side: "bottom",
      },
      {
        target: "lst-trello-board-input",
        title: "Nhập Board ID hoặc URL",
        before: openTrelloConfigModal,
        body: "Dán đường dẫn bảng Trello của team bạn. Hệ thống sẽ tự trích xuất mã Board hợp lệ.",
        side: "bottom",
      },
      {
        target: "lst-trello-columns-grid",
        title: "Chọn hai Cột làm việc",
        body: "Chọn đúng <b>Cột đầu</b> (nơi chứa ảnh thiết kế chờ tạo) và <b>Cột đích</b> (nơi chứa listing đã có file Excel).",
        side: "top",
      },
      {
        target: "lst-trello-columns-grid",
        title: "Lưu cấu hình",
        body: "Bấm “Lưu Cấu Hình Listing” để hoàn tất. Hệ thống sẽ tự động quét và hiển thị các thẻ tương ứng.",
        side: "top",
      },
    ],
  },
];
