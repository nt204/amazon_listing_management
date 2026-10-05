import { getDatabaseClient } from "../lib/db";
import { evaluateBidDecision } from "../lib/ppc/bid-evaluator/evaluator";
import type { EvaluationInput } from "../lib/ppc/bid-evaluator/types";
import { resolveMarginForSku } from "../lib/ppc/action-outcome-evaluator";

function addDaysToIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function auditAction(actionIdArg?: string) {
  const sql = await getDatabaseClient();

  // Find action
  let actionId = actionIdArg;
  if (!actionId) {
    const sample = await sql<{ id: string }[]>`
      SELECT id FROM ppc_actions 
      WHERE status IN ('EXPORTED', 'APPLIED') 
        AND target_id IS NOT NULL AND target_id <> ''
      LIMIT 1;
    `;
    actionId = sample[0]?.id;
  }

  if (!actionId) {
    console.log("No exported/applied action found to audit.");
    await sql.end();
    return;
  }

  const actions = await sql<any[]>`
    SELECT id, store_id, campaign_id, campaign_name, campaign_type,
           target_id, target_keyword, match_type, sku,
           old_value, system_suggested_value, final_value,
           rule_version, status, approved_by,
           COALESCE(approved_at::date, created_at::date, CURRENT_DATE)::text AS applied_on
    FROM ppc_actions
    WHERE id = ${actionId};
  `;

  if (actions.length === 0) {
    console.log(`Action ID "${actionId}" not found.`);
    await sql.end();
    return;
  }

  const a = actions[0];
  const margin = await resolveMarginForSku(a.sku);
  const appliedDate = a.applied_on;

  // Facts
  const targetFacts = await sql<any[]>`
    SELECT report_start_date::text, report_end_date::text,
           (report_end_date - report_start_date)::int as window_days,
           clicks, spend, sales, orders
    FROM ppc_performance_facts
    WHERE store_id = ${a.store_id}
      AND target_id = ${a.target_id}
      AND grain = 'TARGET'
    ORDER BY report_end_date DESC;
  `;

  const bFact = targetFacts.find((f) => f.window_days === 30);
  const aFact = targetFacts.find((f) => f.window_days === 30 && f.report_end_date >= appliedDate) || targetFacts.find((f) => f.window_days === 30);

  const baselineClicks = Number(bFact?.clicks || 0);
  const baselineSpend = Number(bFact?.spend || 0);
  const baselineSales = Number(bFact?.sales || 0);
  const baselineOrders = Number(bFact?.orders || 0);

  const afterClicks = Number(aFact?.clicks || 0);
  const afterSpend = Number(aFact?.spend || 0);
  const afterSales = Number(aFact?.sales || 0);
  const afterOrders = Number(aFact?.orders || 0);

  const baselineContrib = baselineSales * margin - baselineSpend;
  const afterContrib = afterSales * margin - afterSpend;

  // Simulate evaluation at mature date (35 days after applied)
  const matureDate = addDaysToIso(appliedDate, 35);

  const evalInput: EvaluationInput = {
    decision: {
      decision_id: a.id,
      target_id: a.target_id,
      applied_at: appliedDate,
      current_bid: Number(a.old_value || 0),
      applied_bid: Number(a.final_value || a.system_suggested_value || 0),
      pre_ads_contribution_margin_pct: margin,
      is_control: false,
      user_action: "APPLY_AI",
    },
    window: 30,
    evaluation_date: matureDate,
    baseline_metrics_summary: {
      clicks: baselineClicks,
      orders: baselineOrders,
      ad_spend: baselineSpend,
      ad_sales: baselineSales,
      acos: baselineSales > 0 ? (baselineSpend / baselineSales) * 100 : null,
      contribution: baselineContrib,
      days_with_data: 30,
      total_days: 30,
    },
    after_metrics_summary: {
      clicks: afterClicks,
      orders: afterOrders,
      ad_spend: afterSpend,
      ad_sales: afterSales,
      acos: afterSales > 0 ? (afterSpend / afterSales) * 100 : null,
      contribution: afterContrib,
      days_with_data: 30,
      total_days: 30,
    },
    matched_controls: [],
  };

  const res = evaluateBidDecision(evalInput);

  console.log("================================================================================");
  console.log("        BẢNG MINH BẠCH & KIỂM TRA ĐỐI CHIẾU CÔNG THỨC (AUDIT VERIFICATION)       ");
  console.log("================================================================================\n");

  console.log(`Action ID         : ${a.id}`);
  console.log(`Target Keyword    : "${a.target_keyword}" (${a.match_type})`);
  console.log(`SKU               : ${a.sku}`);
  console.log(`Ngày áp dụng (T0) : ${appliedDate}`);
  console.log(`Thay đổi Bid      : $${a.old_value} -> $${a.final_value} (${res.applied_delta_pct >= 0 ? "+" : ""}${res.applied_delta_pct.toFixed(2)}%)`);
  console.log(`Margin ròng (m)   : ${(margin * 100).toFixed(1)}% (Từ Product Cost Master)`);
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ BƯỚC 1: SỐ LIỆU ĐẦU VÀO TỪ BÁO CÁO AMAZON (FACTS)");
  console.log(`  • Baseline (30 ngày trước): Sales = $${baselineSales.toFixed(2)} | Spend = $${baselineSpend.toFixed(2)} | Clicks = ${baselineClicks} | Orders = ${baselineOrders}`);
  console.log(`  • Sau áp dụng (30 ngày)   : Sales = $${afterSales.toFixed(2)} | Spend = $${afterSpend.toFixed(2)} | Clicks = ${afterClicks} | Orders = ${afterOrders}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ BƯỚC 2: TÍNH CONTRIBUTION (Lợi nhuận = Sales × Margin - Spend)");
  console.log(`  • Baseline Contribution = ($${baselineSales.toFixed(2)} × ${(margin * 100).toFixed(1)}%) - $${baselineSpend.toFixed(2)} = $${baselineContrib.toFixed(2)}`);
  console.log(`  • Baseline / ngày       = $${baselineContrib.toFixed(2)} / 30 = $${(baselineContrib / 30).toFixed(2)}/ngày`);
  console.log(`  • Expected Own 30D      = $${(baselineContrib / 30).toFixed(2)} × 30 = $${((baselineContrib / 30) * 30).toFixed(2)}`);
  console.log(`  • Control Shift         = +$${res.expected_baseline?.control_shift_w.toFixed(2)} (Nguồn: ${res.expected_baseline?.source})`);
  console.log(`  • Expected Tổng (E)     = Expected Own + Control Shift = $${res.expected_baseline?.value.toFixed(2)}`);
  console.log(`  • Thực tế sau 30D (A)   = ($${afterSales.toFixed(2)} × ${(margin * 100).toFixed(1)}%) - $${afterSpend.toFixed(2)} = $${res.actual_contribution?.toFixed(2)}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ BƯỚC 3: TÍNH REWARD VÀ NGƯỠNG DUNG SAI NHIỄU (T)");
  console.log(`  • Reward (USD)          = Thực tế (A) - Kỳ vọng (E) = $${res.actual_contribution?.toFixed(2)} - ($${res.expected_baseline?.value.toFixed(2)}) = ${res.reward_usd! >= 0 ? "+" : ""}$${res.reward_usd?.toFixed(2)}`);
  console.log(`  • Baseline Spend 30D    = $${baselineSpend.toFixed(2)}`);
  console.log(`  • Ngưỡng T              = max($3.00, 10% × $${baselineSpend.toFixed(2)}) × 1.25 (hệ số phạt mẫu)`);
  console.log(`                          = max($3.00, $${(baselineSpend * 0.1).toFixed(2)}) × 1.25 = $${res.T?.toFixed(2)}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ BƯỚC 4: QUY TẮC PHÁN QUYẾT NHÃN (DETERMINISTIC VERDICT)");
  if (res.reward_usd! > res.T!) {
    console.log(`  👉 Reward (${res.reward_usd?.toFixed(2)}) > +T (${res.T?.toFixed(2)})`);
    console.log(`  ==> KẾT QUẢ: 🟢 POSITIVE (Thành công - Vượt kỳ vọng)`);
  } else if (res.reward_usd! < -res.T!) {
    console.log(`  👉 Reward (${res.reward_usd?.toFixed(2)}) < -T (-${res.T?.toFixed(2)})`);
    console.log(`  ==> KẾT QUẢ: 🔴 NEGATIVE (Thất bại - Kém hơn kỳ vọng)`);
  } else {
    console.log(`  👉 |Reward| (${Math.abs(res.reward_usd!).toFixed(2)}) <= T (${res.T?.toFixed(2)})`);
    console.log(`  ==> KẾT QUẢ: ⚪ NEUTRAL (Nằm trong biên độ nhiễu)`);
  }
  console.log(`  • Reason Codes          : [${res.reason_codes.join(", ")}]`);
  console.log(`  • Đủ chuẩn huấn luyện AI: ${res.eligible_for_learning ? "✅ CÓ (Được học)" : "❌ KHÔNG (Loại khỏi tập train)"}`);
  console.log("================================================================================\n");

  await sql.end();
}

auditAction(process.argv[2]).catch(console.error);
