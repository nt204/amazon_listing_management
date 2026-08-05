"use client";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  ImageSquareIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ListingContent, ListingRevision, StoredListing } from "@/lib/types";

interface ResultPanelProps {
  stored: StoredListing | null;
  content: ListingContent | null;
  editing: boolean;
  loading: boolean;
  action: string | null;
  onContentChange: (content: ListingContent) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onSubmitReview: () => void;
  onApprove: () => void;
  onExport: () => void;
  onCopy: () => void;
  onRevise: (instruction: string) => Promise<boolean>;
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#b84f1d] px-3 text-xs font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c4c8cb]"
          : "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#cfd5da] bg-white px-3 text-xs font-semibold text-[#39444d] hover:bg-[#f5f6f7] active:translate-y-px disabled:text-[#9ba3aa]"
      }
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: StoredListing["status"] }) {
  const styles = {
    Draft: "bg-[#edf1f3] text-[#4d5962]",
    Review: "bg-[#fff1d8] text-[#83520f]",
    Approved: "bg-[#e8f5ed] text-[#17663a]",
    Exported: "bg-[#e8f0f7] text-[#285a7d]",
  }[status];
  return <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${styles}`}>{status}</span>;
}

function LoadingState() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const stage =
    elapsedSeconds < 5
      ? "Đang chuẩn bị evidence..."
      : elapsedSeconds < 20
        ? "Đang đọc ảnh và viết draft..."
        : "AI đang hoàn thiện draft. Kết quả chưa đạt sẽ được đưa vào Review, không retry âm thầm.";
  return (
    <div className="mx-auto w-full max-w-5xl p-6 lg:p-8" aria-label="Generating listing">
      <div className="mb-7 flex items-center gap-3 rounded-lg border border-[#ead7ce] bg-[#fff8f4] p-4">
        <MagicWandIcon className="text-[#b84f1d]" size={22} />
        <div>
          <p className="text-sm font-bold text-[#60321d]">{stage}</p>
          <p className="mt-0.5 text-xs text-[#79513e]">{elapsedSeconds}s - Hệ thống kiểm tra fact, policy và keyword trước khi lưu.</p>
        </div>
      </div>
      <div className="grid gap-6">
        {["w-24", "w-32", "w-28", "w-40"].map((width, index) => (
          <div key={index} className="animate-pulse">
            <div className={`mb-3 h-3 rounded bg-[#dfe3e6] ${width}`} />
            <div className="h-24 rounded-lg bg-[#e8ebed]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid min-h-[calc(100dvh-64px)] place-items-center px-6 py-14">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl border border-[#dfe3e6] bg-white text-[#65717c] shadow-[0_6px_24px_rgba(44,52,58,0.07)]">
          <ClipboardTextIcon size={28} />
        </div>
        <h2 className="mt-5 text-lg font-bold text-[#222b32]">Chọn listing hoặc tạo draft mới</h2>
        <p className="mt-2 text-sm leading-6 text-[#65717c]">Evidence, nội dung, quality check và revision sẽ xuất hiện tại đây.</p>
      </div>
    </div>
  );
}

function ListingField({
  label,
  count,
  children,
}: {
  label: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-5 shadow-[0_4px_18px_rgba(51,61,68,0.04)]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-bold text-[#39444d]">{label}</h3>
        <span className="text-[11px] text-[#7a858e]">{count}</span>
      </div>
      {children}
    </section>
  );
}

function ContentView({
  content,
  editing,
  onContentChange,
}: {
  content: ListingContent;
  editing: boolean;
  onContentChange: (content: ListingContent) => void;
}) {
  return (
    <div className="grid content-start gap-5">
      <ListingField label="SEO title" count={`${content.title.length} chars`}>
        {editing ? (
          <textarea className="field-control min-h-28 resize-y text-[15px] font-semibold leading-6" value={content.title} onChange={(event) => onContentChange({ ...content, title: event.target.value })} />
        ) : (
          <p className="text-[15px] font-semibold leading-7 text-[#222b32]">{content.title}</p>
        )}
      </ListingField>

      <ListingField label="Bullet points" count={`${content.bullet_points.length} bullets`}>
        <div className="grid gap-3">
          {content.bullet_points.map((bullet, index) =>
            editing ? (
              <div key={index} className="grid grid-cols-[24px_1fr] items-start gap-2">
                <span className="pt-2.5 text-xs font-bold text-[#8a949c]">{index + 1}</span>
                <textarea
                  className="field-control min-h-24 resize-y leading-6"
                  value={bullet}
                  onChange={(event) => {
                    const nextBullets = [...content.bullet_points];
                    nextBullets[index] = event.target.value;
                    onContentChange({ ...content, bullet_points: nextBullets });
                  }}
                />
              </div>
            ) : (
              <div key={index} className="grid grid-cols-[24px_1fr] items-start gap-2 pb-2">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-[#fff0e8] text-[11px] font-bold text-[#a24419]">{index + 1}</span>
                <p className="text-sm leading-6 text-[#39444d]">{bullet}</p>
              </div>
            ),
          )}
        </div>
      </ListingField>

      <ListingField label="Product description" count={`${content.description.length} chars`}>
        {editing ? (
          <textarea className="field-control min-h-44 resize-y leading-6" value={content.description} onChange={(event) => onContentChange({ ...content, description: event.target.value })} />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-7 text-[#4b5660]">{content.description || "Description generation is disabled."}</p>
        )}
      </ListingField>

      <ListingField label="Backend search terms" count={`${new TextEncoder().encode(content.backend_search_terms).length} bytes`}>
        {editing ? (
          <textarea className="field-control min-h-24 resize-y leading-6" value={content.backend_search_terms} onChange={(event) => onContentChange({ ...content, backend_search_terms: event.target.value })} />
        ) : (
          <p className="text-sm leading-6 text-[#4b5660]">{content.backend_search_terms || "Search term generation is disabled."}</p>
        )}
      </ListingField>
    </div>
  );
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    generated: "AI draft",
    ai_revision: "AI revision",
    manual_edit: "Sửa thủ công",
    submitted_for_review: "Gửi review",
    approved: "Đã duyệt",
    exported: "Đã export",
  };
  return labels[action] || action.replace(/_/g, " ");
}

function revisionValue(content: ListingContent, field: keyof ListingContent) {
  return field === "bullet_points" ? content.bullet_points.join("\n\n") : content[field];
}

function RevisionView({ revisions }: { revisions: ListingRevision[] }) {
  const latestId = revisions.at(-1)?.id || "";
  const [selectedId, setSelectedId] = useState(latestId);
  const selectedIndex = Math.max(
    0,
    revisions.findIndex((revision) => revision.id === selectedId) >= 0
      ? revisions.findIndex((revision) => revision.id === selectedId)
      : revisions.length - 1,
  );
  const selected = revisions[selectedIndex];
  const previous = selectedIndex > 0 ? revisions[selectedIndex - 1] : null;
  const fields: Array<{ key: keyof ListingContent; label: string }> = [
    { key: "title", label: "Title" },
    { key: "bullet_points", label: "Bullet points" },
    { key: "description", label: "Description" },
    { key: "backend_search_terms", label: "Backend search terms" },
  ];
  const changed = previous
    ? fields.filter(({ key }) => revisionValue(previous.content, key) !== revisionValue(selected.content, key))
    : fields;

  if (!selected) {
    return <p className="rounded-lg bg-white p-5 text-sm text-[#65717c]">Chưa có revision để so sánh.</p>;
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold capitalize text-[#303b44]">{actionLabel(selected.action)}</p>
            <p className="mt-1 text-xs text-[#65717c]">{new Date(selected.created_at).toLocaleString()}</p>
          </div>
          <select className="field-control w-auto min-w-48" value={selected.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Chọn revision">
            {revisions.map((revision, index) => (
              <option key={revision.id} value={revision.id}>#{index + 1} {actionLabel(revision.action)}</option>
            ))}
          </select>
        </div>
        {selected.instruction ? (
          <div className="mt-4 rounded-lg bg-[#fff7f2] p-3">
            <p className="text-[11px] font-bold text-[#8a431f]">Yêu cầu review</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#5f4437]">{selected.instruction}</p>
          </div>
        ) : null}
        {selected.quality ? (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#65717c]">
            <span>Fact coverage <strong className="text-[#303b44]">{selected.quality.fact_coverage_percent}%</strong></span>
            <span>Keyword coverage <strong className="text-[#303b44]">{selected.quality.keyword_coverage_percent}%</strong></span>
            <span>Lỗi <strong className="text-[#303b44]">{selected.quality.error_count}</strong></span>
          </div>
        ) : null}
      </div>

      {previous && !changed.length ? (
        <p className="rounded-lg border border-[#dfe3e6] bg-white p-5 text-sm text-[#65717c]">Revision này chỉ thay đổi trạng thái workflow, nội dung không đổi.</p>
      ) : null}

      {changed.map(({ key, label }) => (
        <section key={key} className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
          <h3 className="mb-3 text-xs font-bold text-[#39444d]">{label}</h3>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)]">
            <div className="rounded-lg bg-[#f5f6f7] p-3">
              <p className="mb-2 text-[11px] font-bold text-[#7a858e]">Trước</p>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[#59656e]">{previous ? revisionValue(previous.content, key) : "Chưa có phiên bản trước"}</p>
            </div>
            <div className="hidden place-items-center text-[#a0a8ae] lg:grid"><ArrowRightIcon size={16} /></div>
            <div className="rounded-lg bg-[#eef7f2] p-3">
              <p className="mb-2 text-[11px] font-bold text-[#286345]">Sau</p>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[#344f40]">{revisionValue(selected.content, key)}</p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

const placementLabels = {
  title: "Title",
  bullets: "Bullets",
  description: "Description",
  backend_search_terms: "Backend",
} as const;

const sourceLabels = {
  main: "Primary",
  operator: "Operator",
  competitor: "Competitor",
  ai: "AI research",
} as const;

function ScoreCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 border-r border-[#e2e6e8] px-4 last:border-r-0">
      <dt className="text-[11px] font-semibold text-[#65717c]">{label}</dt>
      <dd className="mt-1 text-xl font-bold tracking-tight text-[#222b32]">{value}</dd>
      <p className="mt-0.5 truncate text-[10px] text-[#879099]" title={detail}>{detail}</p>
    </div>
  );
}

function SeoEvidenceView({
  stored,
  onApplyBackend,
}: {
  stored: StoredListing;
  onApplyBackend: (value: string) => void;
}) {
  const result = stored.result;
  const seo = result.seo_analysis;
  const backend = seo.backend_search_terms;
  const quality = result.content_quality;
  const keywords = seo.keyword_usage || [];
  const profile = result.competitor_profile;
  const usedFacts = new Set(quality.facts_used);
  const overlapIssues = [
    ...(result.policy_validation?.errors || []),
    ...(result.policy_validation?.warnings || []),
  ].filter((issue) =>
    ["COMPETITOR_PHRASE_OVERLAP", "COMPETITOR_PHRASE_SIMILARITY"].includes(issue.code),
  );

  return (
    <div className="grid gap-5">
      <section className="rounded-[10px] border border-[#dfe3e6] bg-white py-4">
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-5 sm:gap-y-0">
          <ScoreCell label="SEO coverage" value={`${seo.keyword_coverage_percent}%`} detail="Có trọng số theo nguồn và vị trí" />
          <ScoreCell label="Marketing fit" value={`${seo.marketing_coverage_percent ?? 0}%`} detail={seo.purchase_strategy ? `${seo.purchase_strategy.mode}, ${seo.purchase_strategy.marketing_percent}/${seo.purchase_strategy.product_percent}` : "Chưa có purchase strategy"} />
          <ScoreCell label="Backend efficiency" value={`${backend?.efficiency_percent ?? seo.backend_coverage_percent ?? 0}%`} detail="Từ mới, không trùng visible copy" />
          <ScoreCell label="Verified facts" value={`${quality.fact_coverage_percent}%`} detail={`${quality.facts_used.length}/${quality.supplied_facts.length} facts đã dùng`} />
          <ScoreCell label="Competitor refs" value={`${profile?.references.length || 0}`} detail="Chỉ dùng intent và vocabulary" />
        </div>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[#dfe3e6] bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8ea] px-4 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-[#222b32]">Keyword map</h2>
            <p className="mt-1 text-xs text-[#65717c]">Nguồn, độ ưu tiên và nơi mỗi intent đang được dùng.</p>
          </div>
          <span className="text-xs font-semibold text-[#65717c]">{keywords.filter((item) => item.placements.length).length}/{keywords.filter((item) => item.usable !== false).length} used</span>
        </div>
        {keywords.length ? (
          <div className="divide-y divide-[#e9ecee]">
            {keywords.slice(0, 16).map((item) => (
              <div key={`${item.source}-${item.keyword}`} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_110px_90px_minmax(170px,1fr)] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#303b44]" title={item.keyword}>{item.keyword}</p>
                  {item.source === "competitor" ? <p className="mt-0.5 text-[10px] text-[#879099]">{item.source_count || 1} reference, {item.confidence || "medium"} confidence</p> : null}
                </div>
                <span className="w-fit rounded-md bg-[#f0f2f4] px-2 py-1 text-[10px] font-bold text-[#59656e]">{sourceLabels[item.source || (item.is_main ? "main" : "ai")]}</span>
                <span className={`text-[11px] font-bold ${item.usable === false ? "text-[#a13f32]" : item.placements.length ? "text-[#237047]" : "text-[#9a6218]"}`}>
                  {item.usable === false ? "Blocked" : item.placements.length ? "Used" : "Opportunity"}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {item.placements.length ? item.placements.map((placement) => (
                    <span key={placement} className="rounded-md border border-[#d9dfe2] bg-[#fafbfb] px-1.5 py-0.5 text-[10px] text-[#59656e]">{placementLabels[placement]}</span>
                  )) : <span className="text-[11px] text-[#8a949c]">Chưa có trong listing</span>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="p-5 text-sm text-[#65717c]">Chưa có keyword map. Chạy một AI revision để phân tích lại listing cũ.</p>}
      </section>

      <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><MagnifyingGlassIcon size={18} className="text-[#a24419]" /><h2 className="text-sm font-bold text-[#222b32]">Backend search terms</h2></div>
            <p className="mt-1 text-xs text-[#65717c]">Generic discovery terms, không lặp title, bullet, brand hoặc ASIN.</p>
          </div>
          <span className="rounded-md bg-[#f0f2f4] px-2 py-1 text-[11px] font-bold text-[#4d5962]">{backend?.bytes_used ?? new TextEncoder().encode(result.listing.backend_search_terms).length}/{backend?.byte_limit ?? 249} bytes</span>
        </div>
        <div className="mt-4 rounded-lg bg-[#f5f7f8] p-3 font-mono text-xs leading-6 text-[#35414a]">
          {result.listing.backend_search_terms || "Chưa có backend search terms."}
        </div>
        {backend ? (
          <>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="text-[#7a858e]">Từ trùng visible copy</dt><dd className="mt-0.5 font-semibold text-[#39444d]">{backend.redundant_visible_words.join(", ") || "Không có"}</dd></div>
              <div><dt className="text-[#7a858e]">Từ bị cấm hoặc lãng phí</dt><dd className="mt-0.5 font-semibold text-[#39444d]">{[...backend.prohibited_terms, ...backend.stop_words, ...backend.repeated_words, ...(backend.low_intent_terms || [])].join(", ") || "Không có"}</dd></div>
            </dl>
            {backend.suggested_value && backend.suggested_value !== result.listing.backend_search_terms ? (
              <div className="mt-4 border-t border-[#e5e8ea] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[#39444d]">Bản tối ưu, {backend.suggested_bytes} bytes</p>
                  <button type="button" onClick={() => onApplyBackend(backend.suggested_value)} className="h-8 whitespace-nowrap rounded-lg border border-[#c96f44] bg-white px-3 text-xs font-bold text-[#943f19] hover:bg-[#fff7f2] active:translate-y-px">Đưa vào bản nháp</button>
                </div>
                <p className="mt-2 rounded-lg border border-[#ead7ce] bg-[#fffaf7] p-3 font-mono text-xs leading-6 text-[#5d4438]">{backend.suggested_value}</p>
                {backend.opportunity_words.length ? <p className="mt-2 text-[11px] text-[#65717c]">Cơ hội mới: {backend.opportunity_words.join(", ")}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
          <h2 className="text-sm font-bold text-[#222b32]">Evidence coverage</h2>
          <p className="mt-1 text-xs text-[#65717c]">Fact do operator xác nhận được tách khỏi suy luận từ ảnh và đối thủ.</p>
          <div className="mt-4 grid gap-2">
            {quality.supplied_facts.length ? quality.supplied_facts.map((fact) => (
              <div key={fact} className="flex items-start justify-between gap-3 rounded-lg bg-[#f7f8f8] px-3 py-2">
                <span className="text-xs leading-5 text-[#39444d]">{fact}</span>
                <span className={`shrink-0 text-[10px] font-bold ${usedFacts.has(fact) ? "text-[#237047]" : "text-[#9a6218]"}`}>{usedFacts.has(fact) ? "Used" : "Unused"}</span>
              </div>
            )) : <p className="text-xs text-[#7a858e]">Chưa có fact do operator xác nhận.</p>}
          </div>
        </section>

        <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
          <h2 className="text-sm font-bold text-[#222b32]">Competitor intelligence</h2>
          <p className="mt-1 text-xs text-[#65717c]">Tín hiệu được source, còn brand và claim thiếu evidence bị chặn.</p>
          {overlapIssues.length ? (
            <div className="mt-4 grid gap-2">
              {overlapIssues.map((issue, index) => (
                <div key={`${issue.code}-${index}`} className={`rounded-lg border p-3 ${issue.code === "COMPETITOR_PHRASE_OVERLAP" ? "border-[#e6b7ad] bg-[#fff5f2]" : "border-[#ead4a9] bg-[#fff9ec]"}`}>
                  <p className={`text-xs font-semibold leading-5 ${issue.code === "COMPETITOR_PHRASE_OVERLAP" ? "text-[#8e3021]" : "text-[#7d5113]"}`}>{issue.message}</p>
                  {issue.source_url ? <a href={issue.source_url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] font-bold text-[#9b461f] underline decoration-[#d8a38b] underline-offset-2">Mở nguồn đối thủ</a> : null}
                </div>
              ))}
            </div>
          ) : null}
          {profile?.references.length ? (
            <div className="mt-4 grid gap-3">
              {profile.references.map((reference, index) => (
                <div key={`${reference.asin || reference.url}-${index}`} className="border-b border-[#e5e8ea] pb-3 last:border-0 last:pb-0">
                  <p className="line-clamp-2 text-xs font-semibold leading-5 text-[#39444d]">{reference.title || reference.asin || `Reference ${index + 1}`}</p>
                  <p className="mt-1 text-[10px] text-[#879099]">{reference.brand || "Brand not detected"}{reference.asin ? ` / ${reference.asin}` : ""}</p>
                </div>
              ))}
              <p className="text-[11px] font-semibold text-[#8b5810]">{profile.claims.filter((claim) => claim.own_evidence === "missing").length} claim bị chặn vì thiếu fact của sản phẩm.</p>
            </div>
          ) : <p className="mt-4 text-xs text-[#7a858e]">Chưa có listing đối thủ được đọc thành công.</p>}
        </section>
      </div>
    </div>
  );
}

function QualitySidebar({ stored }: { stored: StoredListing }) {
  const result = stored.result;
  const validation = result.policy_validation;
  const productAnalysis = result.product_analysis;
  const competitorProfile = result.competitor_profile;
  const quality = result.content_quality;
  const errors = validation?.errors || [];
  const warnings = validation?.warnings || [];
  return (
    <aside className="grid content-start gap-4">
      <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
        <div className="mb-3 flex items-center gap-2"><ShieldCheckIcon className={validation?.passed ? "text-[#287149]" : "text-[#a06412]"} size={19} /><h2 className="text-sm font-bold text-[#222b32]">Kiểm tra chất lượng</h2></div>
        <div className={validation?.passed ? "mb-3 rounded-lg bg-[#eef7f2] p-3 text-xs font-semibold text-[#276043]" : "mb-3 rounded-lg bg-[#fff4df] p-3 text-xs font-semibold text-[#7d5113]"}>
          {validation?.passed ? "Đã qua các kiểm tra bắt buộc" : `${errors.length} lỗi cần xử lý`}
        </div>
        <dl className="grid gap-2.5 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-[#65717c]">Fact đã xác minh</dt><dd className="font-bold text-[#303b44]">{quality ? `${quality.fact_coverage_percent}%` : "-"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-[#65717c]">SEO coverage</dt><dd className="font-bold text-[#303b44]">{result.seo_analysis?.keyword_coverage_percent === undefined ? "-" : `${result.seo_analysis.keyword_coverage_percent}%`}</dd></div>
          {result.seo_analysis?.marketing_coverage_percent !== undefined ? (
            <div className="flex justify-between gap-3"><dt className="text-[#65717c]">Marketing fit</dt><dd className="font-bold text-[#303b44]">{result.seo_analysis.marketing_coverage_percent}%</dd></div>
          ) : null}
          {result.seo_analysis?.backend_coverage_percent !== undefined ? (
            <div className="flex justify-between gap-3"><dt className="text-[#65717c]">Backend efficiency</dt><dd className="font-bold text-[#303b44]">{result.seo_analysis.backend_coverage_percent}%</dd></div>
          ) : null}
          {quality?.reference_utilization_percent !== undefined ? (
            <div className="flex justify-between gap-3"><dt className="text-[#65717c]">Reference utilization</dt><dd className="font-bold text-[#303b44]">{quality.reference_utilization_percent}%</dd></div>
          ) : null}
          <div className="flex justify-between gap-3"><dt className="text-[#65717c]">Warnings</dt><dd className="font-bold text-[#303b44]">{warnings.length}</dd></div>
        </dl>
        {quality?.unused_facts?.length ? (
          <div className="mt-4 border-t border-[#e5e8ea] pt-3">
            <p className="text-[11px] font-bold text-[#8b5810]">Facts chưa dùng</p>
            <div className="mt-2 grid gap-1.5">{quality.unused_facts.map((fact) => <p key={fact} className="text-xs leading-5 text-[#5d6266]">{fact}</p>)}</div>
          </div>
        ) : null}
        {errors.length || warnings.length ? (
          <div className="mt-4 grid gap-2 border-t border-[#e5e8ea] pt-3">
            {errors.map((issue, index) => <div key={`error-${index}`} className="flex items-start gap-2 text-xs leading-5 text-[#8e3021]"><XCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" /><span>{issue.message}</span></div>)}
            {warnings.map((issue, index) => <div key={`warning-${index}`} className="flex items-start gap-2 text-xs leading-5 text-[#7d5113]"><WarningCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" /><span>{issue.message}</span></div>)}
          </div>
        ) : null}
      </section>

      <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
        <div className="mb-3 flex items-center gap-2"><ImageSquareIcon className={result.image_analysis.analyzed ? "text-[#287149]" : "text-[#8b5810]"} size={19} /><h2 className="text-sm font-bold text-[#222b32]">Evidence brief</h2></div>
        <p className="mb-3 text-xs leading-5 text-[#65717c]">{result.image_analysis.image_count} ảnh, {result.metadata.model_name}</p>
        <div className="grid gap-2">
          {result.image_analysis.observations.slice(0, 5).map((observation, index) => <p key={`${observation}-${index}`} className="text-xs leading-5 text-[#4b5660]">{observation}</p>)}
        </div>
        {productAnalysis?.exact_text.length ? <div className="mt-4 border-t border-[#e5e8ea] pt-3"><p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Detected text</p><p className="text-xs font-semibold leading-5 text-[#39444d]">{productAnalysis.exact_text.join(", ")}</p></div> : null}
        {productAnalysis?.competitor_insights.length ? <div className="mt-4 border-t border-[#e5e8ea] pt-3"><p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Reference insights</p><div className="grid gap-1.5">{productAnalysis.competitor_insights.slice(0, 4).map((insight) => <p key={insight} className="text-xs leading-5 text-[#4b5660]">{insight}</p>)}</div></div> : null}
        {competitorProfile ? (
          <div className="mt-4 border-t border-[#e5e8ea] pt-3">
            <p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Competitor profile / {competitorProfile.references.length} refs</p>
            <div className="grid gap-1.5">
              {competitorProfile.keyword_candidates.filter((keyword) => keyword.usable_for_listing).slice(0, 4).map((keyword) => (
                <p key={keyword.value} className="text-xs leading-5 text-[#4b5660]">
                  {keyword.value} <span className="text-[10px] text-[#8a949c]">/ {keyword.sources.length} source / {keyword.confidence}</span>
                </p>
              ))}
            </div>
            {competitorProfile.claims.some((claim) => claim.own_evidence === "missing") ? (
              <p className="mt-2 text-[11px] leading-4 text-[#8b5810]">
                {competitorProfile.claims.filter((claim) => claim.own_evidence === "missing").length} competitor claims bị chặn vì thiếu fact của sản phẩm.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-[10px] border border-[#dfe3e6] bg-white p-4 text-xs text-[#65717c]">
        <div className="mb-3 flex items-center gap-2"><SparkleIcon size={17} className="text-[#a24419]" /><h2 className="text-sm font-bold text-[#222b32]">Thông tin xử lý</h2></div>
        <dl className="grid gap-2.5">
          <div className="flex justify-between gap-3"><dt>Processing</dt><dd className="font-semibold text-[#39444d]">{(result.metadata.processing_time_ms / 1000).toFixed(1)}s</dd></div>
          <div className="flex justify-between gap-3"><dt>Retries</dt><dd className="font-semibold text-[#39444d]">{result.metadata.retry_count}</dd></div>
          <div className="flex justify-between gap-3"><dt>Policy</dt><dd className="max-w-36 truncate font-semibold text-[#39444d]" title={result.metadata.policy_version}>{result.metadata.policy_version}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

export function ResultPanel({
  stored,
  content,
  editing,
  loading,
  action,
  onContentChange,
  onEdit,
  onCancelEdit,
  onSave,
  onSubmitReview,
  onApprove,
  onExport,
  onCopy,
  onRevise,
}: ResultPanelProps) {
  const [tab, setTab] = useState<"content" | "seo" | "revisions">("content");
  const [instruction, setInstruction] = useState("");
  const revisions = useMemo(() => stored?.revisions || [], [stored?.revisions]);
  if (loading) return <LoadingState />;
  if (!stored || !content) return <EmptyState />;

  const validation = stored.result.policy_validation;
  const busy = Boolean(action);
  const canReview = stored.status === "Draft";
  const canApprove = stored.status === "Review" && validation.passed;
  const canExport = stored.status === "Approved";
  const missingFacts = stored.result.content_quality.unused_facts;
  const issuePrompt = [
    ...validation.errors.map((issue) => issue.message),
    ...validation.warnings.map((issue) => issue.message),
  ].join("\n");

  const revise = async () => {
    if (!instruction.trim()) return;
    if (await onRevise(instruction.trim())) setInstruction("");
  };

  const applySuggestedBackend = (value: string) => {
    onContentChange({ ...content, backend_search_terms: value });
    onEdit();
    setTab("content");
  };

  return (
    <section className="thin-scrollbar min-h-0 overflow-y-auto lg:max-h-[calc(100dvh-64px)]">
      <div className="sticky top-0 z-[1] border-b border-[#dfe3e6] bg-white/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2.5"><StatusBadge status={stored.status} /><span className="text-xs text-[#65717c]">{stored.input.internal_name}</span></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ActionButton onClick={onCopy} disabled={busy}><CopyIcon size={15} /> Sao chép</ActionButton>
            {editing ? (
              <><ActionButton onClick={onCancelEdit} disabled={busy}>Hủy</ActionButton><ActionButton onClick={onSave} disabled={busy} primary><FloppyDiskIcon size={15} /> {action === "save" ? "Đang lưu..." : "Lưu"}</ActionButton></>
            ) : (
              <ActionButton onClick={onEdit} disabled={busy}><PencilSimpleIcon size={15} /> Sửa</ActionButton>
            )}
            {canReview ? <ActionButton onClick={onSubmitReview} disabled={busy} primary><PaperPlaneTiltIcon size={15} /> {action === "review" ? "Đang gửi..." : "Gửi review"}</ActionButton> : null}
            {stored.status === "Review" ? <ActionButton onClick={onApprove} disabled={busy || !canApprove} primary><CheckCircleIcon size={15} weight="bold" /> {action === "approve" ? "Đang duyệt..." : "Duyệt"}</ActionButton> : null}
            {stored.status === "Approved" || stored.status === "Exported" ? <ActionButton onClick={onExport} disabled={busy || !canExport} primary><DownloadSimpleIcon size={15} /> {stored.status === "Exported" ? "Exported" : action === "export" ? "Exporting..." : "Export CSV"}</ActionButton> : null}
          </div>
        </div>
        <div className="flex gap-1 px-5" role="tablist" aria-label="Listing review">
          <button type="button" role="tab" aria-selected={tab === "content"} onClick={() => setTab("content")} className={`border-b-2 px-3 py-2 text-xs font-bold ${tab === "content" ? "border-[#b84f1d] text-[#8f3d17]" : "border-transparent text-[#65717c] hover:text-[#303b44]"}`}>Nội dung</button>
          <button type="button" role="tab" aria-selected={tab === "seo"} onClick={() => setTab("seo")} className={`border-b-2 px-3 py-2 text-xs font-bold ${tab === "seo" ? "border-[#b84f1d] text-[#8f3d17]" : "border-transparent text-[#65717c] hover:text-[#303b44]"}`}>SEO &amp; Evidence</button>
          <button type="button" role="tab" aria-selected={tab === "revisions"} onClick={() => setTab("revisions")} className={`border-b-2 px-3 py-2 text-xs font-bold ${tab === "revisions" ? "border-[#b84f1d] text-[#8f3d17]" : "border-transparent text-[#65717c] hover:text-[#303b44]"}`}>Phiên bản ({revisions.length})</button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1220px] p-5 lg:p-7">
        <section className="mb-5 rounded-[10px] border border-[#dfc8bc] bg-[#fffaf7] p-4">
          <label htmlFor="review_instruction" className="text-[13px] font-bold text-[#49372f]">Yêu cầu AI chỉnh sửa</label>
          <p className="mt-1 text-xs leading-5 text-[#786156]">Một câu lệnh cho toàn bộ listing. Hệ thống vẫn kiểm tra lại fact và policy sau khi sửa.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {issuePrompt ? <button type="button" onClick={() => setInstruction(`Sửa toàn bộ lỗi và cảnh báo dưới đây, giữ nguyên các phần đang tốt và không thêm claim mới:\n${issuePrompt}`)} className="rounded-md border border-[#dbc8be] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#76503d] hover:bg-[#fff7f2]">Sửa lỗi quality</button> : null}
            <button type="button" onClick={() => setInstruction("Tối ưu SEO tự nhiên cho toàn bộ listing. Ưu tiên keyword do operator cung cấp và intent lặp lại ở đối thủ, không copy wording, không lặp noun để keyword stuffing, và dùng backend chỉ cho vocabulary chưa có trong title hoặc bullets.")} className="rounded-md border border-[#dbc8be] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#76503d] hover:bg-[#fff7f2]">Tối ưu SEO</button>
            {missingFacts.length ? <button type="button" onClick={() => setInstruction(`Tích hợp tự nhiên các fact đã xác minh còn thiếu sau đây, không thay đổi thông số:\n${missingFacts.join("\n")}`)} className="rounded-md border border-[#dbc8be] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#76503d] hover:bg-[#fff7f2]">Dùng fact còn thiếu</button> : null}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <textarea id="review_instruction" className="field-control min-h-20 resize-y bg-white" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Dùng brand Limima, description khoảng 800 ký tự, factual hơn và giữ nguyên các thông số đã xác minh." />
            <button type="button" onClick={() => void revise()} disabled={busy || !instruction.trim()} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c5c9cc]"><MagicWandIcon size={17} /> {action === "revise" ? "Đang sửa..." : "Áp dụng"}</button>
          </div>
        </section>

        {tab === "seo" ? (
          <SeoEvidenceView stored={stored} onApplyBackend={applySuggestedBackend} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
            {tab === "content" ? <ContentView content={content} editing={editing} onContentChange={onContentChange} /> : <RevisionView revisions={revisions} />}
            <QualitySidebar stored={stored} />
          </div>
        )}
      </div>
    </section>
  );
}
