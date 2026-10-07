"use client";

import {
  X,
  Sparkle,
  ShieldCheck,
  CheckCircle,
  WarningCircle,
  Database,
  Cpu,
  CircleNotch,
  Info,
  Clock,
} from "@phosphor-icons/react";
import type { AiReviewerExecutionResult, RuleCritique } from "@/lib/ppc/ai-reviewer";
import type { PpcRecommendation } from "@/lib/ppc/types";

interface PpcAiReviewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: PpcRecommendation | null;
  aiResult: AiReviewerExecutionResult | null;
  scenarioInfo?: {
    scenario: string;
    acosBeRatio: number | null;
    clicksAtAction: number;
    ordersAtAction: number;
    actualAcos: number | null;
    breakEvenAcos: number | null;
    matchedRuleId: string | null;
    triggerReason: string;
  } | null;
  retrievalMetadata?: {
    level: string;
    specificity: string;
    sample_count: number;
  } | null;
  isLoading: boolean;
  errorMessage?: string | null;
  onApplyBid?: (
    bid: number,
    source: "AI_AGENT" | "RULE_FALLBACK",
    audit: AiReviewApplicationSnapshot,
  ) => void;
}

export interface AiReviewApplicationSnapshot {
  prompt_version: string;
  model: string;
  agent_version: string;
  policy_version: string;
  decision: string | null;
  selected_candidate_id: string | null;
  effective_candidate_id: string;
  effective_bid: number | null;
  validation_status: string;
  decision_source: "AI_AGENT" | "RULE_FALLBACK";
  fallback_reason: string | null;
  reason_codes: string[];
  evidence_used: string[];
  counter_evidence: string[];
  need_more_data: boolean;
  analysis: string | null;
  retrieval_level: string | null;
  retrieval_specificity: string | null;
  sample_count: number;
  rule_critique?: RuleCritique | null;
  latency_ms: number;
  executed_at: string;
  payload: AiReviewerExecutionResult["payload"];
}

export function PpcAiReviewerModal({
  isOpen,
  onClose,
  recommendation,
  aiResult,
  scenarioInfo,
  retrievalMetadata,
  isLoading,
  errorMessage,
  onApplyBid,
}: PpcAiReviewerModalProps) {
  if (!isOpen || !recommendation) return null;

  const payload = aiResult?.payload;
  const rawAi = aiResult?.raw_response;
  const validation = aiResult?.validation;

  const ruleBid = recommendation.recommendedBid ?? recommendation.currentBid ?? 0;
  const effectiveBid = validation?.effective_bid ?? ruleBid;

  const totalSamples =
    retrievalMetadata?.sample_count ??
    (payload?.available_candidates.reduce((sum, c) => sum + (c.sample_count || 0), 0) || 0);
  const minimumSamples = payload?.scenario_evaluation.minimum_samples ?? 20;
  const retrievalLevel = retrievalMetadata?.level || payload?.scenario_evaluation.retrieval_level;
  const hasInsufficientHistoricalData =
    totalSamples < minimumSamples || retrievalLevel === "LEVEL_C" || retrievalLevel === "INSUFFICIENT";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 text-white flex items-center justify-between shrink-0 border-b border-indigo-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-purple-500/30">
              <Sparkle size={22} weight="fill" className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold tracking-tight">AI Reviewer Phản Biện</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-200 border border-purple-400/30 font-mono">
                  {aiResult?.model || "gpt-5.6-terra"}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                  Shadow V1
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 flex items-center gap-2 mt-0.5">
                <span>Target: <b className="text-white font-mono">{recommendation.keyword}</b></span>
                {recommendation.matchType && <span>• Match: <b className="text-white">{recommendation.matchType}</b></span>}
                {aiResult && <span>• Độ trễ: <b className="text-white font-mono">{(aiResult.latency_ms / 1000).toFixed(1)}s</b></span>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-700 text-sm">
          {isLoading && (
            <div className="py-16 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shadow-inner">
                <CircleNotch size={32} className="animate-spin text-purple-600" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-base">Đang gửi dữ liệu sang GPT-5.6 Terra...</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  AI đang đối soát dữ liệu lịch sử mature, đối chiếu Break-even ACoS và kiểm tra các ràng buộc trần bid của SKU.
                </p>
              </div>
            </div>
          )}

          {errorMessage && !isLoading && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
              <WarningCircle size={22} className="text-rose-600 shrink-0 mt-0.5" weight="fill" />
              <div>
                <div className="font-bold text-sm">Lỗi gọi AI Reviewer</div>
                <div className="text-xs mt-0.5 text-rose-700">{errorMessage}</div>
              </div>
            </div>
          )}

          {aiResult && !isLoading && (
            <>
              {/* Scenario & Retrieval Status Bar */}
              <div className="p-3.5 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shadow-xs border border-slate-800">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-xs font-semibold text-slate-300">Phân loại Kịch bản (Scenario):</span>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                    scenarioInfo?.scenario === "ZERO_ORDER_BLEED"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : scenarioInfo?.scenario === "HIGH_ACOS_TRIM"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : scenarioInfo?.scenario === "PROFITABLE_SCALE"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : scenarioInfo?.scenario === "MARGINAL_ACOS"
                            ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40"
                            : scenarioInfo?.scenario === "STARVED_TRAFFIC"
                              ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                              : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                  }`}>
                    {scenarioInfo?.scenario || "STANDARD_EVAL"}
                  </span>
                  {scenarioInfo?.acosBeRatio !== null && scenarioInfo?.acosBeRatio !== undefined && (
                    <span className="text-xs text-slate-300">
                      (ACOS/BE: <b className="text-white font-mono">{scenarioInfo.acosBeRatio.toFixed(2)}x</b>)
                    </span>
                  )}
                </div>

                {retrievalMetadata && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Độ khớp Lịch sử:</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-slate-800 text-slate-200 border border-slate-700">
                      {retrievalMetadata.level} ({retrievalMetadata.specificity})
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      N = {retrievalMetadata.sample_count}
                    </span>
                  </div>
                )}
              </div>

              {/* Alert Banner: Kiểm tra dữ liệu lịch sử */}
              {hasInsufficientHistoricalData ? (
                <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200/90 text-amber-900 flex items-start gap-3 shadow-2xs">
                  <Info size={22} className="text-amber-600 shrink-0 mt-0.5" weight="fill" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-amber-950 flex items-center gap-2">
                      <span>Bằng chứng chưa đủ điều kiện để AI thay đổi phán quyết Rule</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-200 text-amber-900 font-bold font-mono">
                        {retrievalLevel === "LEVEL_C" ? "LEVEL_C_ANALYSIS_ONLY" : "INSUFFICIENT_MATURE_EVIDENCE"}
                      </span>
                    </div>
                    <p className="text-xs text-amber-850 leading-relaxed">
                      Kịch bản <b>{scenarioInfo?.scenario || "hiện tại"}</b> có <b>N={totalSamples}</b> mẫu,
                      yêu cầu tối thiểu <b>N={minimumSamples}</b> và không chấp nhận Level C để thay Rule.
                      Hệ thống tự động <b>bảo lưu phán quyết của Rule Engine</b>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-emerald-50/90 border border-emerald-200/90 text-emerald-900 flex items-start gap-3 shadow-2xs">
                  <CheckCircle size={22} className="text-emerald-600 shrink-0 mt-0.5" weight="fill" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-emerald-950 flex items-center gap-2">
                      <span>Đã tìm thấy {totalSamples} ca tương tự trong lịch sử ({retrievalMetadata?.level || "MATURE"})</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-200 text-emerald-900 font-bold font-mono">
                        EVIDENCE_AVAILABLE
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      AI đã đối chiếu các ca có cùng kịch bản <b>{scenarioInfo?.scenario}</b> đã hoàn tất chu kỳ 30 ngày để đưa ra phán đoán phản biện dựa trên số liệu thực tế.
                    </p>
                  </div>
                </div>
              )}

              {/* So sánh 2 bên: Rule vs AI */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Cột Trái: Chẩn đoán của Rule Base */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5 text-sm">
                      <Cpu size={18} className="text-slate-600" weight="duotone" />
                      Rule Engine (Quy tắc gốc)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-200 text-slate-700">
                      {payload?.rule_evaluation.matched_rule_id || "MATCHED_RULE"}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Hướng đề xuất:</span>
                      <span className="font-bold text-slate-800">{payload?.rule_evaluation.rule_direction}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Candidate của Rule:</span>
                      <span className="font-bold font-mono text-indigo-700">
                        {payload?.rule_evaluation.rule_selected_candidate}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Giá thầu Rule tính:</span>
                      <span className="font-black font-mono text-base text-slate-900">
                        ${ruleBid.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-600 leading-relaxed">
                    <b className="text-slate-800">Lập luận của Rule:</b> {payload?.rule_evaluation.rule_intent}
                  </div>
                </div>

                {/* Cột Phải: Phản biện của AI */}
                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-3">
                  <div className="flex items-center justify-between border-b border-purple-200/80 pb-2">
                    <span className="font-bold text-purple-950 flex items-center gap-1.5 text-sm">
                      <Sparkle size={18} className="text-purple-600" weight="fill" />
                      AI Phản Biện (gpt-5.6-terra)
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        validation?.status === "ACCEPTED_SHADOW"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {validation?.status === "ACCEPTED_SHADOW" ? "Chấp nhận AI Shadow" : "Fallback về Rule"}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Phán quyết AI:</span>
                      <span className="font-bold font-mono text-purple-900">
                        {rawAi?.decision || "INSUFFICIENT_EVIDENCE"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Candidate AI chọn:</span>
                      <span className="font-bold font-mono text-purple-700">
                        {rawAi?.candidate_id || "None (Fallback về Rule)"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Giá hiệu lực cuối:</span>
                      <span className="font-black font-mono text-base text-purple-900">
                        ${effectiveBid.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-purple-200 text-xs text-slate-600 leading-relaxed">
                    <b className="text-purple-900">Lý do & Mã bằng chứng:</b>{" "}
                    {rawAi?.reason_codes && rawAi.reason_codes.length > 0 ? (
                      <span className="font-mono text-purple-700 font-semibold">
                        {rawAi.reason_codes.join(", ")}
                      </span>
                    ) : (
                      "Chưa có mature outcome lịch sử (Sample = 0), AI tuân thủ nguyên tắc không bịa đặt và rơi về Rule."
                    )}
                  </div>
                </div>
              </div>

              {/* Phản biện chiến lược của AI đối với Rule Engine */}
              {rawAi?.rule_critique && (
                <div
                  className={`p-4 rounded-xl border space-y-2 shadow-2xs ${
                    rawAi.rule_critique.rule_disagreement
                      ? "bg-amber-50/90 border-amber-300 text-amber-950"
                      : "bg-slate-50/90 border-slate-200 text-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                      {rawAi.rule_critique.rule_disagreement ? (
                        <>
                          <WarningCircle size={16} className="text-amber-600" weight="fill" />
                          <span className="text-amber-900">AI Cảnh Báo Phản Biện: Không đồng thuận với hướng của Rule Engine</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle size={16} className="text-emerald-600" weight="fill" />
                          <span className="text-slate-700">AI Phản Biện: Đồng thuận với hướng của Rule Engine ({payload?.rule_evaluation.rule_direction})</span>
                        </>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        rawAi.rule_critique.rule_disagreement
                          ? "bg-amber-200 text-amber-900"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      Hướng AI đề xuất: {rawAi.rule_critique.suggested_direction}
                    </span>
                  </div>
                  {rawAi.rule_critique.disagreement_reason && (
                    <p className="text-xs leading-relaxed">
                      <b>Lý do AI phản biện:</b> {rawAi.rule_critique.disagreement_reason}
                    </p>
                  )}
                  {rawAi.rule_critique.rule_disagreement && (
                    <p className="text-[11px] text-amber-800 italic">
                      ℹ️ Ghi chú an toàn: Lệnh thực thi sản xuất vẫn được khóa chặt theo Rule Engine ({payload?.rule_evaluation.rule_direction}) để loại trừ rủi ro. Cảnh báo này được lưu vào audit trail để hiệu chuẩn Rule.
                    </p>
                  )}
                </div>
              )}

              {/* Nhận xét & Đề xuất chuyên sâu từ AI */}
              {rawAi?.analysis && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-purple-50 via-indigo-50/40 to-white border border-purple-200/90 shadow-2xs space-y-1.5">
                  <div className="flex items-center gap-2 text-purple-950 font-bold text-xs uppercase tracking-wider">
                    <Sparkle size={15} weight="fill" className="text-purple-600" />
                    <span>Nhận Xét & Đề Xuất Phản Biện Của AI (GPT-5.6 Terra)</span>
                  </div>
                  <p className="text-xs text-purple-900 leading-relaxed font-sans">
                    {rawAi.analysis}
                  </p>
                </div>
              )}

              {/* Số liệu đa chu kỳ của Target (7D, 14D, 30D) nếu có */}
              {payload?.performance?.windows && Object.keys(payload.performance.windows).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Clock size={16} className="text-indigo-600" />
                      Hiệu suất đa chu kỳ của Target (3D / 7D / 14D / 30D)
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      So sánh xu hướng ngắn hạn và trung hạn
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {Object.entries(payload.performance.windows).map(([days, w]) => (
                      <div key={days} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                        <div className="font-bold text-slate-800 flex justify-between border-b border-slate-200/70 pb-1 mb-1">
                          <span>Chu kỳ {days} Ngày</span>
                          <span className="font-mono text-indigo-700">{w.orders} đơn / {w.clicks} clk</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-500 font-mono">
                          <div>Chi: <b className="text-slate-800">${w.spend.toFixed(2)}</b></div>
                          <div>Thu: <b className="text-slate-800">${w.sales.toFixed(2)}</b></div>
                          <div>CPC: <b className="text-slate-800">{w.avg_cpc !== null ? `$${w.avg_cpc.toFixed(2)}` : "—"}</b></div>
                          <div>ACoS: <b className="text-slate-800">{w.acos !== null ? `${w.acos.toFixed(1)}%` : "—"}</b></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bảng Dữ Liệu Chứng Minh & Candidates */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <Database size={16} className="text-indigo-600" />
                    Bảng đối soát Candidates & Bằng chứng lịch sử
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Chỉ chọn trong tập discrete candidates đã qua kiểm định guardrails
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Candidate ID</th>
                        <th className="py-2.5 px-2 text-right">Điều chỉnh</th>
                        <th className="py-2.5 px-2 text-right">Giá Bid</th>
                        <th className="py-2.5 px-2 text-center">Số Mẫu (N)</th>
                        <th className="py-2.5 px-2 text-center">Win / Loss</th>
                        <th className="py-2.5 px-2 text-right">Reward TB</th>
                        <th className="py-2.5 px-3 text-center">Vai Trò</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {payload?.available_candidates.map((c) => {
                        const isRuleChoice = c.is_rule_choice;
                        const isAiChoice = rawAi?.candidate_id === c.id;
                        return (
                          <tr
                            key={c.id}
                            className={`hover:bg-slate-50 transition ${
                              isAiChoice ? "bg-purple-50/40" : isRuleChoice ? "bg-indigo-50/30" : ""
                            }`}
                          >
                            <td className="py-2 px-3 font-semibold text-slate-800">
                              {c.id}
                              {!c.allowed && (
                                <span className="ml-1 text-[10px] text-rose-600 font-sans font-bold">
                                  [Blocked: {c.guardrail_reasons.join(",")}]
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right font-sans">
                              {c.adjustment_pct > 0 ? `+${c.adjustment_pct}%` : `${c.adjustment_pct}%`}
                            </td>
                            <td className="py-2 px-2 text-right font-bold text-slate-900">
                              {c.bid !== null ? `$${c.bid.toFixed(2)}` : "—"}
                            </td>
                            <td className="py-2 px-2 text-center text-slate-600">
                              {c.sample_count}
                            </td>
                            <td className="py-2 px-2 text-center text-slate-600">
                              {c.win_count} / {c.loss_count}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-700">
                              {c.median_reward_usd !== null ? `$${c.median_reward_usd.toFixed(2)}` : "—"}
                            </td>
                            <td className="py-2 px-3 text-center font-sans">
                              {isRuleChoice && (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 mr-1">
                                  Rule Chọn
                                </span>
                              )}
                              {isAiChoice && (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                                  AI Chọn
                                </span>
                              )}
                              {!isRuleChoice && !isAiChoice && (
                                <span className="text-slate-300 text-[11px]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Khối Kiểm soát Biến Ngoại Cảnh */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600">
                <ShieldCheck size={20} className="text-indigo-600 shrink-0 mt-0.5" weight="fill" />
                <div>
                  <b className="text-slate-800">Kiểm soát an toàn dữ liệu ngoại cảnh:</b>
                  <p className="mt-0.5">
                    Hệ thống xác nhận các biến ngoại cảnh gồm <i>Tồn kho (Stockout)</i>, <i>Buy Box</i>, <i>Biến động giá (Price changes)</i>, và <i>Coupons/Deals</i> hiện chưa có telemetry. AI được khóa chặt trong prompt, cấm tự suy diễn các yếu tố này để đảm bảo tính khách quan 100%.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            {aiResult && <span>Prompt: {aiResult.prompt_version} • Mode: Shadow V1 (Không đổi dữ liệu thật)</span>}
          </div>
          <div className="flex items-center gap-2">
            {onApplyBid && aiResult && (
              <button
                type="button"
                onClick={() => {
                  const source: "AI_AGENT" = "AI_AGENT";
                  onApplyBid(effectiveBid, source, {
                    prompt_version: aiResult.prompt_version,
                    model: aiResult.model,
                    agent_version: aiResult.agent_version,
                    policy_version: aiResult.policy_version,
                    decision: rawAi?.decision || null,
                    selected_candidate_id: rawAi?.candidate_id || null,
                    effective_candidate_id: validation?.effective_candidate_id || "HOLD",
                    effective_bid: validation?.effective_bid ?? null,
                    validation_status: validation?.status || "AI_REVIEW_INVALID",
                    decision_source: source,
                    fallback_reason: validation?.fallback_reason || null,
                    reason_codes: rawAi?.reason_codes || [],
                    evidence_used: rawAi?.evidence_used || [],
                    counter_evidence: rawAi?.counter_evidence || [],
                    need_more_data: rawAi?.need_more_data ?? true,
                    analysis: rawAi?.analysis || null,
                    retrieval_level: retrievalMetadata?.level || null,
                    retrieval_specificity: retrievalMetadata?.specificity || null,
                    sample_count: retrievalMetadata?.sample_count || 0,
                    rule_critique: rawAi?.rule_critique || validation?.rule_critique || null,
                    latency_ms: aiResult.latency_ms,
                    executed_at: aiResult.executed_at,
                    payload: aiResult.payload,
                  });
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle size={15} weight="bold" />
                <span>
                  {validation?.status === "ACCEPTED_SHADOW" ? "Nạp bid AI" : "Nạp bid AI (Khớp Rule an toàn)"}
                  {` $${effectiveBid.toFixed(2)} vào ô chỉnh sửa`}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
