# Hệ thống AI Agent

Agent đầu tiên: **AI đối soát kế toán** (`accounting-reconciliation`), giải thích mọi con số trên Dashboard kế toán:
số từ đâu ra, vì sao tăng/giảm, store/SKU nào gây ra, dữ liệu có thiếu không.
Mở bằng nút **Hỏi AI** hoặc nút **?** cạnh mỗi thẻ KPI.

## Kiến trúc

```
Giao diện   components/agents/agent-chat-panel.tsx   khung chat dùng chung (stream, 👍/👎)
API         app/api/agents/[agent]/route.ts          POST hỏi (NDJSON) · PATCH đánh giá
Đăng ký     lib/agents/registry.ts                   danh sách agent
Chạy 1 lượt lib/agents/run.ts                        phân quyền → lịch sử → runner → ghi agent_runs
Agent       lib/agents/<tên>/agent.ts + tools.ts     prompt + tool của từng agent
Lõi         lib/agent-core/                          runner · cổng model · nhật ký · DB chỉ đọc
Chỉ số      lib/metrics/                             danh mục chỉ số + bộ máy bóc tách (không AI)
```

Nguyên tắc:

1. **Code tính số, AI chỉ diễn giải.** Phần bóc tách trong `lib/metrics/engine.ts` là hàm thuần, cộng đúng về tổng.
   Số liệu lấy qua đúng các hàm Dashboard đang dùng (`getAccountingDashboard`), nên luôn khớp với web.
2. **Quyền ép ở lớp tool, không dựa vào prompt.** Phạm vi store dựng lại mỗi lượt từ phân quyền kế toán.
   Runner chặn tool vượt mức quyền (`read` / `propose` / `execute`) agent được khai báo.
3. **Truy vấn tự viết phải đi qua `withAgentReadOnly`.** Chạy trong transaction READ ONLY với `statement_timeout`,
   luôn lọc theo store + khoảng ngày và có `LIMIT` (theo quy định DB production trong AGENTS.md).
4. **Lịch sử chat lưu trên server, riêng theo từng tài khoản** (mọi truy vấn lọc `team_id` + `actor_id`).
   Mở khung chat sẽ thấy cuộc chat gần nhất. Nút "Lịch sử" liệt kê và mở lại các cuộc chat cũ, nút "Mới" bắt đầu cuộc
   chat mới. Đóng khung khi AI đang trả lời thì server vẫn trả lời xong, mở lại sẽ thấy. Xóa một cuộc chat chỉ đặt
   `cleared_at` (ẩn khỏi lịch sử và ngữ cảnh model), dòng vẫn giữ để chấm điểm.
   API: `GET ?list=1` (danh sách) · `GET ?sessionId=` (một cuộc chat) · `DELETE ?sessionId=` (xóa một cuộc chat).
5. **Lịch sử đưa cho model** (`lib/agent-core/history.ts`, hàm thuần, có test):
   - Tối đa 12 lượt, luôn gồm câu hỏi đầu tiên. 3 lượt gần nhất giữ nguyên văn, lượt cũ hơn chỉ giữ phần **Kết luận**.
   - Khối bối cảnh màn hình chỉ giữ khi khác lượt trước. Có ngân sách ký tự.
   - Thông tin "các lượt trước đã tra gì" (tool + phạm vi) là **một khối ghi chú riêng đặt trước câu hỏi mới**,
     chỉ gửi model, không lưu. **Không chèn ghi chú vào câu trả lời cũ.** Khi thử thật, model đã bắt chước định dạng
     đó, tự viết "đã tra" giả và bịa số mà không gọi tool.
   - Chống bịa số: `verifyAnswer` trong định nghĩa agent. Câu trả lời có số mà lượt đó chưa gọi tool nào thì runner
     bắt model tra lại (1 lần).
6. **Mọi lượt đều được ghi vào bảng `agent_runs`.** Ghi câu hỏi, bối cảnh, tool đã gọi, model, token, độ trễ, 👍/👎.
   Đây là dữ liệu để chấm điểm khi đổi prompt hoặc model.

## Giao diện (Dashboard kế toán)

> **Đang tạm ẩn** (từ 21/11/2026): nút "Hỏi AI", nút "?" trên thẻ KPI và panel chat chỉ hiện khi đặt
> `NEXT_PUBLIC_AI_RECONCILIATION=1` trong `.env` rồi build / khởi động lại. API `/api/agents/*` và
> `/api/accounting/data-checks` vẫn chạy.

- **Panel ghim bên phải, không che màn hình.** Trên màn rộng, Dashboard tự chừa chỗ cho panel.
  Bấm **?** ở thẻ số nào cũng hỏi tiếp trong cuộc chat đang mở. Nếu AI đang bận, câu hỏi xếp hàng chờ.
- **Dải "Cảnh báo dữ liệu"** ở đầu panel: chạy các kiểm tra bằng code, không gọi AI
  (`GET /api/accounting/data-checks`), mỗi cảnh báo có nút "Hỏi AI". Câu trả lời của AI chỉ nhắc cảnh báo làm sai
  chính số đang hỏi, không lặp lại cảnh báo đã nói.
- Mỗi câu hỏi có **nhãn bối cảnh** ("Profit · 01/11–18/11 · Tất cả store"). Cuộc chat trong Lịch sử dùng nhãn này làm tên.
- Dưới câu trả lời cuối có **nút hỏi tiếp** (so với kỳ trước, tách theo store/SKU, xem dòng gốc), bỏ những hướng AI
  vừa làm. Agent khai báo qua `describeContext` và `followUps` trong `AgentModule`.
- Khi thêm chế độ mới (vd hỏi dữ liệu kinh doanh, gợi ý), mỗi chế độ là một agent riêng trong registry, dùng chung panel.

## Kiểm tra dữ liệu (`lib/metrics/accounting/checks.ts`)

Kế toán không tự biết số sai ở đâu, nên agent tự rà. Có 13 kiểm tra, chạy bằng code, chỉ đọc DB, có timeout. Chia 2 nhóm:

- **Đối chiếu nội bộ: thiếu hoặc không khớp quy tắc.** Gồm: dữ liệu chậm, thiếu giá vốn, thiếu phí trong Bảng mã,
  tiền tệ lạ, ngày có đơn mà không có ADS, ADS không vào kênh nào, ADS mà không có doanh thu, refund Deferred,
  SKU FBM ngoài Bảng mã.
- **Đối chiếu nguồn độc lập hoặc lịch sử: bắt được dữ liệu "nhập sai mà không để trống".**
  - `fee_vs_actual`: Amazon Fee ước tính theo Bảng mã so với phí thật trong báo cáo giao dịch (bảng tổng kết tháng
    do `ingest_monthly_from_raw.py` tạo). Kết quả chỉ ra SKU có phí Bảng mã đã cũ. Tháng chưa chốt thì ước lượng
    theo phí thật/unit của tháng gần nhất, tính lệch ròng cả hai chiều.
  - `costs_not_in_dashboard`: lưu kho, placement, lưu kho dài hạn, AWD, removal… có trong báo cáo tháng nhưng P&L
    Dashboard không trừ. Đây là khác biệt theo thiết kế, giải thích vì sao Profit Dashboard cao hơn KQKD.
  - `basecost_outlier`: giá vốn tháng lệch hơn 50% so với trung bình 3 tháng trước.
  - `daily_anomaly`: số đơn hoặc tiền ADS của một ngày tụt mạnh (dấu hiệu thiếu file) hoặc tăng vọt, so với trung vị
    14 ngày trước đó.
- Đã cân nhắc nhưng **không** làm kiểm tra dòng trùng theo `order_item_id`: trường này hay để trống ở đơn nhiều SKU,
  nên toàn báo động giả.

## Thêm chỉ số mới cho AI đối soát

Khai báo trong `lib/metrics/accounting/definitions.ts`: id, alias tiếng Việt, công thức (`terms` / `numerator` /
`denominator`), quy tắc FBA/FBM đúng như code, nguồn, các kiểm tra liên quan. Không cần thêm tool.
Thêm nút **?** ở màn hình khác: gán `metricId` rồi mở `AgentChatPanel` với `context` (store, kỳ, giá trị đang hiển thị).

## Thêm agent mới (PPC, tồn kho, listing…)

1. Tạo `lib/agents/<tên>/tools.ts`: mỗi tool gồm schema zod, `permission`, `label` tiếng Việt và `run`.
2. Tạo `lib/agents/<tên>/agent.ts`: export một `AgentModule` (definition, feature, `createScope` theo phân quyền,
   `contextSchema` nếu có).
3. Đăng ký trong `lib/agents/registry.ts`. Agent có ngay API `/api/agents/<tên>` và dùng được khung chat chung.
4. Tool đổi dữ liệu thì để mức `propose` (tạo đề xuất chờ duyệt). Chỉ mở `execute` sau khi đã chấm kết quả đủ tốt.

## Cấu hình model (.env)

Thứ tự ưu tiên: `<PREFIX>_*` → `AGENT_*` → key CheapKey sẵn có. Prefix của AI đối soát là `AGENT_ACCOUNTING`.

| Biến | Mặc định |
|---|---|
| `AGENT_ACCOUNTING_MODEL` / `AGENT_MODEL` | `claude-sonnet-4-6` |
| `AGENT_ACCOUNTING_FALLBACK_MODEL` / `AGENT_FALLBACK_MODEL` | `gpt-5.4-mini` |
| `AGENT_ACCOUNTING_API_KEY` / `AGENT_API_KEY` | `CHEAPKEYAI_TEXT_API_KEY` → `CHEAPKEYAI_API_KEY` |
| `AGENT_ACCOUNTING_BASE_URL` / `AGENT_BASE_URL` | `CHEAPKEYAI_BASE_URL` → `https://cheapkeyai.shop/v1` |
| `AGENT_ACCOUNTING_TIMEOUT_MS` | `90000` |

Cổng model luôn gọi dạng **stream**: phản hồi non-stream của cheapkeyai làm mất ký tự xuống dòng.

## Trợ lý hướng dẫn Auto Bid (thử nghiệm) — `ppc-autobid-guide`

Nút chat tròn góc dưới phải tab PPC **Đề xuất & Auto Bid**. Hỏi cách dùng → AI trả lời và gắn kịch bản
`[[tour:<id>]]` → nút **Xem mình làm** chạy hướng dẫn ngay trên màn hình (làm sáng phần tử + con trỏ giả tự bấm).

- Kịch bản: `lib/guide/ppc-autobid-tours.ts`. Mỗi bước trỏ tới phần tử có `data-tour="<key>"` (đừng xoá các thuộc tính này khi sửa giao diện).
  AI chỉ CHỌN id kịch bản, không tự đoán nút. Thêm kịch bản = thêm vào danh mục, AI tự thấy.
- Chạy kịch bản: `components/guide/guide-tour-runner.ts` (driver.js MIT; cách bấm học theo alibaba/page-agent).
  Con trỏ giả chỉ mở / đóng / lọc; nút có chữ Duyệt, Lưu, Xoá, Xác nhận… bị chặn bấm. Kết thúc / đóng giữa chừng thì `cleanup` trả màn hình về như cũ.
- Kiến thức: `lib/agents/ppc-autobid-guide/knowledge.ts` (viết theo code). Ngưỡng luật lấy LIVE từ `ppc_rule_versions` qua tool `get_bid_rules`.
- Chống bịa (`verifyAnswer`): mọi câu trả lời phải kết thúc bằng `[[tour:<id>]]` hoặc `[[tour:none]]`; id phải có trong danh mục;
  nêu ngưỡng ACoS / click thì phải đã gọi `get_bid_rules`.
- Trí nhớ theo tài khoản: lịch sử chat lưu `agent_runs` như mọi agent; prompt kèm các câu người đó từng hỏi + hướng dẫn đã gợi ý.
- Model: dùng lại key Gemini của chat Lark kế toán (`LARK_AGENT_KEY`, `LARK_AGENT_BASE_URL`, `LARK_AGENT_MODEL`, mặc định
  `gemini-3.5-flash-lite`, dự phòng `gemini-3.1-flash-lite`). Muốn tách riêng: đặt `AGENT_PPC_GUIDE_API_KEY` / `_MODEL` / `_BASE_URL`.
- Chấm thử: `node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/ppc-autobid-guide-eval.ts [model] [lọc câu hỏi]`
  (chạy bằng tài khoản giả `eval-guide-bot`, tự ẩn lượt chạy sau khi chấm).

## Kiểm tra

- `tests/metrics-accounting.test.ts`: danh mục chỉ số nhất quán; các phép bóc tách cộng đúng về tổng.
- `tests/agent-core-runner.test.ts`: runner dùng model giả, kiểm tra chặn quyền, tham số sai, vòng lặp tối đa.
