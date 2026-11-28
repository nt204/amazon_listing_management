import type { GuideAction, GuideTour } from "@/lib/guide/types";

// Kịch bản hướng dẫn màn "Auto Mockup Generator" (Mockup design). Viết theo skill .claude/skills/ppc-guided-tour.
// Phần tử trỏ tới bằng data-tour "mk-*" trong components/auto-mockup-generator.tsx.
// Logic đối chiếu code 2026-11-28:
// - Thẻ Trello ở cột đầu (ảnh thiết kế gốc) → tạo mockup (gọi AI, đính kèm ảnh lên thẻ) → đủ 7 ảnh thì server tự chuyển thẻ sang cột đích.
// - Content 1 bắt buộc, tối đa 6 content AI (MAX_AI_MOCKUPS_PER_PRODUCT). Chọn mục sản phẩm đặt lại danh sách content về mẫu.
// - Prompt ban đầu: Quản Lý Mẫu SP & Content → Thêm Hàng Loạt → Copy Prompt ChatGPT → dán kết quả (tự lưu cho team).
//   Nút "Thêm Hàng Loạt" chỉ mở hộp (đã sửa lỗi cũ: trước đây bấm là nạp luôn chữ còn sót). X của hộp = áp dụng & đóng.
// - Studio: prompt chung theo (mục sản phẩm, content) dùng cho cả team; sửa chữ = prompt tạm cho 1 lần gen; "Lưu prompt chung"
//   mới đổi cho team; ảnh paste vào ô prompt chung lưu ngay. Gen lại = xoá ảnh cũ trên thẻ, đính kèm ảnh mới.
// - "Duyệt 💚 / Chưa ưng 🔴" chỉ là đánh dấu trong phiên (state), tải lại trang là mất.
// KHÔNG bấm: Tạo / Batch / Gen lại / Lưu prompt chung / Xoá / Tải / Duyệt, không kéo thẻ, không chọn mục sản phẩm.

export const AUTO_MOCKUP_GUIDE_PAGE = "auto-mockup";

const wait = (ms: number): GuideAction => ({ type: "wait", ms });
/** Mở Studio ở ảnh đầu của thẻ đầu tiên trong cột đích. */
const openStudio: GuideAction[] = [{ type: "click", target: "mk-mockup-thumb-first" }, wait(900)];
const closeStudio: GuideAction = { type: "click", target: "mk-studio-close", ifPresent: true };
/** Mở khung prompt của ảnh (chỉ khi đang đóng); kết thúc tour tự đóng lại. */
const openPrompt: GuideAction[] = [{ type: "click", target: "mk-prompt-toggle", ifPresent: true, ensure: "on", undo: true }, wait(900)];
/** Lớp nền trong suốt đóng mọi dropdown ở thanh đầu (Model / Chất lượng). */
const closeDropdown: GuideAction = { type: "click", target: "mk-dropdown-close", ifPresent: true };
const openPresets: GuideAction[] = [{ type: "click", target: "mk-presets-btn" }, wait(900)];
const openBatchModal: GuideAction[] = [{ type: "click", target: "mk-preset-batch-btn", ifPresent: true }, wait(500)];
const closeBatchModal: GuideAction = { type: "click", target: "mk-batch-cancel", ifPresent: true };
const NO_MOCKUP_CARD = "Cột đích chưa có thẻ nào có ảnh. Tạo mockup cho một thẻ trước rồi chạy lại hướng dẫn này.";

const TOURS: GuideTour[] = [
  {
    id: "mk-tao-prompt",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "main",
    title: "Tạo prompt ban đầu",
    summary: "Quản Lý Mẫu SP & Content → Tạo Mới (hoặc Nhân bản) → Thêm Hàng Loạt → Copy Prompt ChatGPT → dán kết quả → mỗi content có prompt riêng.",
    whenToUse: "Sản phẩm / phôi mới chưa có mục, tạo prompt ban đầu, viết prompt cho content, dùng ChatGPT tạo prompt, thêm mục sản phẩm mới.",
    // Hộp Quản Lý Mẫu tự lưu cho cả team khi sửa → tour chỉ mở hộp và làm sáng. Nút X của hộp là "áp dụng & đóng"
    // (đặt lại content đang chọn) nên tour KHÔNG tự đóng hộp, chỉ đóng hộp con "Thêm Hàng Loạt".
    cleanup: [closeBatchModal],
    steps: [
      {
        title: "Tạo prompt ban đầu",
        body: "Mỗi content cần một mô tả bối cảnh tiếng Anh, gọi là prompt. Cách nhanh nhất là nhờ ChatGPT viết từ ảnh phôi rồi dán vào.",
      },
      {
        target: "mk-presets-btn",
        title: "Mở Quản Lý Mẫu",
        body: "Mọi mục sản phẩm, content và prompt chung nằm ở đây. Sửa trong hộp này là lưu cho cả team.",
        side: "bottom",
      },
      {
        target: "mk-preset-create-btn",
        title: "Tạo mục sản phẩm mới",
        body: "Bấm “Tạo Mới” để thêm mục (tên và icon). Phôi gần giống mục có sẵn thì bấm “Nhân bản” ở mục đó rồi sửa cho nhanh.",
        before: openPresets,
        side: "right",
      },
      {
        target: "mk-preset-batch-btn",
        title: "Mở Thêm Hàng Loạt",
        body: "Nơi tạo cả bộ content kèm prompt trong một lần dán. Tour sẽ mở thử.",
        side: "bottom",
      },
      {
        target: "mk-chatgpt-copy-btn",
        title: "Copy Prompt ChatGPT",
        body: "Bấm để chép câu lệnh mẫu, dán vào ChatGPT kèm ảnh phôi sản phẩm. ChatGPT trả về đủ 7 content, mỗi dòng có mô tả bối cảnh tiếng Anh.",
        before: openBatchModal,
        side: "bottom",
      },
      {
        target: "mk-batch-input",
        title: "Dán kết quả ChatGPT",
        body: "Dán nguyên câu trả lời, giữ dạng “Content N | Tên | Mô tả”. Có dòng Content 1 thì cả bộ content cũ được thay mới.",
        side: "top",
      },
      {
        target: "mk-batch-submit-btn",
        title: "Phân tích và thêm",
        body: "Bấm “Tự Động Phân Tích & Thêm Ngay” để tạo content từ đoạn đã dán. Bấm sẽ lưu cho cả team ngay.",
        side: "top",
      },
      {
        target: ["mk-preset-prompt-first", "mk-preset-batch-btn"],
        title: "Sửa prompt từng content",
        body: "Ô “🤖 Mô tả Bối Cảnh AI” là prompt chung của content đó, để trống thì dùng prompt mặc định. Viết {{length}}, {{width}}, {{capacity}} để tự chèn kích thước từng thẻ.",
        before: [closeBatchModal, wait(400)],
        side: "top",
      },
      {
        target: ["mk-preset-done-apply-btn", "mk-preset-apply-btn"],
        title: "Hoàn Tất & Áp Dụng",
        body: "Prompt đã tự lưu cho team, bấm “Hoàn Tất & Áp Dụng” để đóng hộp và dùng ngay mục này. Tạo thử 1 thẻ rồi tinh chỉnh theo “Vòng lặp tối ưu prompt”.",
        side: "top",
      },
    ],
  },
  {
    id: "mk-a-to-z",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "main",
    title: "Tạo mockup cho thẻ thiết kế",
    summary: "Chọn mục sản phẩm → chọn content → model → tạo cho 1 thẻ hoặc Batch nhiều thẻ → thẻ đủ ảnh tự sang cột đích.",
    whenToUse: "Người mới, hỏi quy trình tạo mockup từ đầu tới cuối, cách dùng Auto Mockup, tạo bộ 7 ảnh từ ảnh thiết kế, tạo hàng loạt.",
    steps: [
      {
        title: "Tạo mockup cho thẻ thiết kế",
        body: "Tour đi từ ảnh thiết kế gốc trên thẻ Trello tới lúc thẻ có đủ bộ mockup. Ảnh nào chưa ưng thì sửa theo “Vòng lặp tối ưu prompt”.",
      },
      {
        target: "mk-category-list",
        title: "Chọn mục sản phẩm",
        body: "Mỗi mục (Mouse Pad, Mug 11oz…) có bộ content và prompt riêng. Chọn đúng mục của thẻ, đổi mục sẽ đặt lại danh sách content.",
        side: "bottom",
      },
      {
        target: "mk-content-list",
        title: "Chọn mockup content",
        body: "Mỗi content là một ảnh sẽ tạo. Content 1 (ảnh chính) luôn có, chọn thêm tối đa 6 content AI.",
        side: "bottom",
      },
      {
        target: "mk-model-btn",
        title: "Chọn model và chất lượng",
        body: "Model và chất lượng ở đây áp dụng cho mọi lần tạo. Chất lượng “low” nhanh và rẻ để thử, “high” cho bản đăng bán.",
        side: "bottom",
      },
      {
        target: ["mk-design-card-first", "mk-design-column"],
        title: "Thẻ thiết kế ở cột đầu",
        body: "Mỗi thẻ là một SKU trên Trello, kèm ảnh thiết kế gốc và kích thước lấy từ description. Thiếu kích thước thì ảnh kích thước sẽ sai số.",
        side: "right",
        missingText: "Cột đầu đang trống: chưa có thẻ thiết kế nào cần tạo mockup.",
      },
      {
        target: ["mk-create-mockup-first", "mk-design-column"],
        title: "Tạo mockup cho 1 thẻ",
        body: "Bấm “⚡ Tạo N Mockup AI Đã Chọn” để tạo bộ ảnh cho thẻ đó, kéo thẻ sang cột đích cũng vậy. Bấm sẽ gọi AI (tốn phí) và đính kèm ảnh lên thẻ Trello.",
        side: "top",
      },
      {
        target: ["mk-batch-create-btn", "mk-batch-bar", "mk-design-column"],
        title: "Hoặc Batch nhiều thẻ",
        body: "Tour vừa chọn tất cả thẻ làm mẫu, kết thúc sẽ bỏ chọn. Bấm “⚡ Batch” sẽ tạo lần lượt cho mọi thẻ đã chọn.",
        before: [{ type: "click", target: "mk-select-all", ifPresent: true, ensure: "on", undo: true }, wait(500)],
        side: "bottom",
      },
      {
        target: "mk-mockup-column",
        title: "Kết quả ở cột đích",
        body: "Thẻ đủ 7 ảnh tự chuyển sang cột này trên Trello. Bấm vào ảnh nhỏ để xem lớn, duyệt hoặc gen lại.",
        side: "left",
      },
    ],
  },
  {
    id: "mk-toi-uu-prompt",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "main",
    title: "Vòng lặp tối ưu prompt",
    summary: "Tạo thử 1 thẻ → rà ảnh → ghi chú hoặc sửa prompt tạm → gen lại, so sánh → lặp tới khi ưng → Lưu prompt chung (ghi vào mẫu cho lần sau).",
    whenToUse: "Ảnh mockup chưa đẹp, tối ưu prompt, sửa prompt, gen lại 1 ảnh, thêm ghi chú hay ảnh tham khảo, prompt tạm khác prompt chung, lưu prompt cho team.",
    cleanup: [closeStudio],
    steps: [
      {
        title: "Vòng lặp tối ưu prompt",
        body: "Tạo thử → xem → sửa → gen lại, lặp tới khi ưng, rồi “Lưu prompt chung” ngay trong Studio để lần sau dùng luôn. Sửa bằng prompt tạm trước để không ảnh hưởng ai.",
      },
      {
        target: ["mk-create-mockup-first", "mk-design-column"],
        title: "1. Tạo thử 1 thẻ",
        body: "Tạo cho đúng 1 thẻ, chưa Batch. Prompt mới chưa chắc đẹp, tạo nhiều thẻ một lúc dễ tốn phí vô ích.",
        side: "top",
      },
      {
        target: "mk-studio-image",
        title: "2. Rà từng ảnh",
        body: "Tour vừa mở Studio, mũi tên trái / phải để xem lần lượt. Lỗi lặp lại ở nhiều thẻ là do prompt, lỗi lẻ thường do thiết kế.",
        before: openStudio,
        side: "right",
        missingText: NO_MOCKUP_CARD,
      },
      {
        target: "mk-regen-note",
        title: "3. Thử ghi chú trước",
        body: "Tour vừa gõ ghi chú mẫu, kết thúc sẽ xoá. Lỗi nhỏ (ánh sáng, đạo cụ) thì ghi chú hoặc paste ảnh tham khảo là đủ.",
        before: [{ type: "type", target: "mk-regen-note", value: "Ánh sáng ấm hơn, nền gỗ sáng" }, wait(400)],
        side: "left",
      },
      {
        target: ["mk-prompt-draft", "mk-prompt-toggle"],
        title: "4. Sửa prompt tạm",
        body: "Tour vừa mở prompt và gõ nối một câu mẫu, nhãn “Prompt tạm” hiện lên, kết thúc sẽ trả lại. Lỗi nặng (sai bố cục, sai kích thước) thì sửa thẳng ở đây.",
        before: [
          ...openPrompt,
          { type: "type", target: "mk-prompt-draft", value: " Warm soft window light.", append: true, ifPresent: true },
          wait(400),
        ],
        side: "left",
      },
      {
        target: "mk-regen-start-btn",
        title: "5. Gen lại và so sánh",
        body: "Có prompt tạm thì nút đổi thành “✨ Gen Lại Bằng Prompt Tạm”, gen xong so với ảnh cũ. Chưa ưng thì quay lại bước 3, mỗi lần chỉ đổi một chỗ.",
        side: "top",
      },
      {
        target: ["mk-prompt-save-btn", "mk-prompt-draft"],
        title: "6. Ưng thì Lưu prompt chung",
        body: "Bấm “Lưu prompt chung” để ghi bản đã tối ưu vào mẫu của mục sản phẩm. Bấm sẽ đổi prompt của content này cho cả team, áp dụng ngay từ lần tạo sau.",
        side: "left",
      },
      {
        target: ["mk-prompt-toggle", "mk-regen-panel"],
        title: "7. Lần sau tự dùng",
        body: "Lưu xong ô prompt báo “Đang dùng prompt chung”, lần tạo sau và Batch tự dùng bản mới, không cần làm gì thêm. Thử thêm 1–2 thẻ khác rồi mới Batch.",
        side: "left",
      },
    ],
  },
  {
    id: "mk-chon-content",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "extra",
    title: "Chọn mục sản phẩm và content",
    summary: "Mục sản phẩm quyết định bộ content và prompt; tối đa 7 content gồm Content 1 bắt buộc; Quản Lý Mẫu SP & Content để sửa mẫu.",
    whenToUse: "Chọn mục sản phẩm, chọn content nào, vì sao không tick thêm được, Content 1 bắt buộc, thêm mục sản phẩm mới, sửa content mẫu.",
    steps: [
      {
        target: "mk-category-list",
        title: "Mục sản phẩm",
        body: "Mỗi mục có bộ content và prompt riêng, số bên cạnh là số content. Bấm mục khác sẽ đặt lại danh sách content về mẫu của mục đó.",
        side: "bottom",
      },
      {
        target: ["mk-content-last", "mk-content-list"],
        title: "Bật / tắt content",
        body: "Tour vừa bỏ tick content cuối làm mẫu, kết thúc sẽ tick lại. Tối đa 7 content, Content 1 luôn bắt buộc.",
        before: [{ type: "click", target: "mk-content-last", ifPresent: true, ensure: "off", undo: true }, wait(400)],
        side: "bottom",
      },
      {
        target: "mk-content-default-btn",
        title: "Mặc định (7 Content)",
        body: "Đưa danh sách content về mẫu của mục đang chọn. Dùng khi lỡ bỏ tick nhiều content.",
        side: "bottom",
      },
      {
        target: "mk-content-clear-ai-btn",
        title: "Bỏ chọn Content AI",
        body: "Bỏ hết content AI, chỉ giữ Content 1. Dùng khi chỉ muốn chọn lại vài content.",
        side: "bottom",
      },
      {
        target: "mk-presets-btn",
        title: "Quản lý mẫu và prompt",
        body: "“Quản Lý Mẫu SP & Content” để thêm, nhân bản mục sản phẩm và sửa content, prompt AI. Thay đổi ở đây áp dụng cho cả team.",
        side: "bottom",
      },
    ],
  },
  {
    id: "mk-model-chat-luong",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "extra",
    title: "Chọn model và chất lượng",
    summary: "Danh sách model AI (chi phí, tốc độ khác nhau) và 3 mức chất lượng low / medium / high cho model GPT.",
    whenToUse: "Nên dùng model nào, model nào rẻ, khác nhau giữa các model, chất lượng low medium high, ảnh mờ.",
    cleanup: [closeDropdown],
    steps: [
      {
        target: "mk-model-btn",
        title: "Model đang dùng",
        body: "Model ở đây dùng cho mọi lần tạo mockup trên trang. Đổi model chỉ ảnh hưởng lần tạo sau, ảnh đã có giữ nguyên.",
        side: "bottom",
      },
      {
        target: ["mk-model-menu", "mk-model-btn"],
        title: "Danh sách model",
        body: "Tour vừa mở danh sách, nhãn nhỏ dưới tên ghi nhà cung cấp và đặc điểm. “Tối ưu” là CheapKeyAI rẻ hơn, “Chuẩn” là OpenAI trực tiếp.",
        before: [{ type: "click", target: "mk-model-btn", ensure: "on" }, wait(400)],
        side: "bottom",
      },
      {
        target: ["mk-quality-menu", "mk-quality-btn", "mk-model-btn"],
        title: "Mức chất lượng",
        body: "“low” nhanh và rẻ để thử, “medium” cân bằng, “high” cho bản đăng bán. Chỉ model GPT mới có lựa chọn này.",
        before: [{ type: "click", target: "mk-quality-btn", ifPresent: true, ensure: "on" }, wait(400)],
        side: "bottom",
      },
      {
        target: ["mk-create-mockup-first", "mk-design-column"],
        title: "Áp dụng khi tạo",
        body: "Model và chất lượng đang chọn dùng khi bấm tạo mockup. Trong Studio còn chọn được model riêng cho từng ảnh gen lại.",
        before: [closeDropdown, wait(300)],
        side: "top",
      },
    ],
  },
  {
    id: "mk-duyet-tai-anh",
    page: AUTO_MOCKUP_GUIDE_PAGE,
    kind: "extra",
    title: "Duyệt, tải và xoá ảnh",
    summary: "Đánh dấu Duyệt / Chưa ưng để rà nhanh (chỉ trong phiên), tải ảnh gốc, xoá ảnh mockup khỏi thẻ Trello.",
    whenToUse: "Duyệt ảnh mockup, Chưa ưng là gì, tải ảnh gốc, xoá ảnh mockup, chuyển sang thẻ khác trong Studio.",
    cleanup: [closeStudio],
    steps: [
      {
        target: "mk-studio-image",
        title: "Mở ảnh trong Studio",
        body: "Tour vừa mở ảnh đầu của thẻ đầu tiên ở cột đích. Mũi tên trái / phải để rà từng ảnh.",
        before: openStudio,
        side: "right",
        missingText: NO_MOCKUP_CARD,
      },
      {
        target: "mk-approve-btn",
        title: "Duyệt hoặc Chưa ưng",
        body: "“Duyệt 💚” và “Chưa ưng 🔴” tô viền ảnh để bạn rà nhanh. Dấu này chỉ giữ trong phiên, tải lại trang là mất.",
        side: "bottom",
      },
      {
        target: "mk-download-btn",
        title: "Tải ảnh gốc",
        body: "Tải ảnh đang xem ở độ phân giải gốc về máy.",
        side: "bottom",
      },
      {
        target: ["mk-delete-btn", "mk-download-btn"],
        title: "Xoá ảnh mockup",
        body: "Nút thùng rác có ở ảnh từ Content 2 trở đi. Bấm sẽ xoá ảnh khỏi thẻ Trello.",
        side: "bottom",
      },
      {
        target: "mk-studio-close",
        title: "Đóng Studio",
        body: "Quay lại bảng hai cột. Ảnh đã gen lại hay đã xoá cập nhật ngay trên thẻ.",
        side: "left",
      },
    ],
  },
];

export const AUTO_MOCKUP_TOURS: GuideTour[] = TOURS;
