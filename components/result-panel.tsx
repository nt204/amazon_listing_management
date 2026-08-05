"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  ImageSquareIcon,
  MagicWandIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ListingContent, StoredListing } from "@/lib/types";

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
  onApprove: () => void;
  onExport: () => void;
  onCopy: () => void;
  onRegenerate: (field: keyof ListingContent) => void;
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

function FieldHeader({
  label,
  count,
  onRegenerate,
  busy,
}: {
  label: string;
  count?: string;
  onRegenerate: () => void;
  busy: boolean;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-[13px] font-bold text-[#39444d]">{label}</h3>
        {count ? <span className="text-[11px] text-[#7a858e]">{count}</span> : null}
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-semibold text-[#a24419] hover:text-[#7e3212] disabled:text-[#9ba3aa]"
      >
        <ArrowClockwiseIcon className={busy ? "animate-spin" : ""} size={14} />
        Regenerate
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto w-full max-w-4xl p-6 lg:p-8" aria-label="Generating listing">
      <div className="mb-7 flex items-center gap-3 rounded-lg border border-[#ead7ce] bg-[#fff8f4] p-4">
        <MagicWandIcon className="text-[#b84f1d]" size={22} />
        <div>
          <p className="text-sm font-bold text-[#60321d]">Creating your listing</p>
          <p className="mt-0.5 text-xs text-[#79513e]">Building an evidence brief, then writing and validating the listing.</p>
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
        <h2 className="mt-5 text-lg font-bold text-[#222b32]">Listing sẽ hiển thị ở đây</h2>
      </div>
    </div>
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
  onApprove,
  onExport,
  onCopy,
  onRegenerate,
}: ResultPanelProps) {
  if (loading) return <LoadingState />;
  if (!stored || !content) return <EmptyState />;

  const result = stored.result;
  const validation = result.policy_validation;
  const productAnalysis = result.product_analysis;
  const keywordUsage = result.seo_analysis.keyword_usage;
  const contentQuality = result.content_quality;
  const busy = Boolean(action);
  const approved = stored.status === "Approved";

  return (
    <section className="thin-scrollbar min-h-0 overflow-y-auto lg:max-h-[calc(100dvh-64px)]">
      <div className="sticky top-0 z-[1] flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe3e6] bg-white/95 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <span
            className={
              approved
                ? "rounded-md bg-[#e9f6ef] px-2 py-1 text-[11px] font-bold text-[#17663a]"
                : validation.passed
                  ? "rounded-md bg-[#eef5f1] px-2 py-1 text-[11px] font-bold text-[#2b6547]"
                  : "rounded-md bg-[#fff4df] px-2 py-1 text-[11px] font-bold text-[#8b5810]"
            }
          >
            {stored.status}
          </span>
          <span className="text-xs text-[#65717c]">
            {result.metadata.model_name ||
              (result.model_used === "mock"
                ? "Demo model"
                : result.model_used === "gemini"
                  ? "Gemini"
                  : "OpenAI")}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton onClick={onCopy} disabled={busy}>
            <CopyIcon size={15} /> Copy
          </ActionButton>
          <ActionButton onClick={onExport} disabled={busy}>
            <DownloadSimpleIcon size={15} /> Export
          </ActionButton>
          {editing ? (
            <>
              <ActionButton onClick={onCancelEdit} disabled={busy}>Cancel</ActionButton>
              <ActionButton onClick={onSave} disabled={busy} primary>
                <FloppyDiskIcon size={15} /> {action === "save" ? "Saving..." : "Save"}
              </ActionButton>
            </>
          ) : (
            <ActionButton onClick={onEdit} disabled={busy}>
              <PencilSimpleIcon size={15} /> Edit
            </ActionButton>
          )}
          <ActionButton onClick={onApprove} disabled={busy || !validation.passed || approved} primary>
            <CheckCircleIcon size={15} weight="bold" /> {approved ? "Approved" : action === "approve" ? "Approving..." : "Approve"}
          </ActionButton>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1180px] gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-7">
        <div className="grid content-start gap-5">
          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-5 shadow-[0_4px_18px_rgba(51,61,68,0.05)]">
            <FieldHeader
              label="SEO title"
              count={`${content.title.length} chars`}
              onRegenerate={() => onRegenerate("title")}
              busy={action === "title"}
            />
            {editing ? (
              <textarea
                className="field-control min-h-28 resize-y text-[15px] font-semibold leading-6"
                value={content.title}
                onChange={(event) => onContentChange({ ...content, title: event.target.value })}
              />
            ) : (
              <p className="text-[15px] font-semibold leading-7 text-[#222b32]">{content.title}</p>
            )}
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-5 shadow-[0_4px_18px_rgba(51,61,68,0.05)]">
            <FieldHeader
              label="Bullet points"
              count={`${content.bullet_points.length} bullets`}
              onRegenerate={() => onRegenerate("bullet_points")}
              busy={action === "bullet_points"}
            />
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
                  <div key={index} className="grid grid-cols-[24px_1fr] items-start gap-2 border-b border-[#edf0f2] pb-3 last:border-0 last:pb-0">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-[#fff0e8] text-[11px] font-bold text-[#a24419]">{index + 1}</span>
                    <p className="text-sm leading-6 text-[#39444d]">{bullet}</p>
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-5 shadow-[0_4px_18px_rgba(51,61,68,0.05)]">
            <FieldHeader
              label="Product description"
              count={`${content.description.length} chars`}
              onRegenerate={() => onRegenerate("description")}
              busy={action === "description"}
            />
            {editing ? (
              <textarea
                className="field-control min-h-44 resize-y leading-6"
                value={content.description}
                onChange={(event) => onContentChange({ ...content, description: event.target.value })}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#4b5660]">{content.description || "Description generation is disabled."}</p>
            )}
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-5 shadow-[0_4px_18px_rgba(51,61,68,0.05)]">
            <FieldHeader
              label="Backend search terms"
              count={`${new TextEncoder().encode(content.backend_search_terms).length} bytes`}
              onRegenerate={() => onRegenerate("backend_search_terms")}
              busy={action === "backend_search_terms"}
            />
            {editing ? (
              <textarea
                className="field-control min-h-24 resize-y leading-6"
                value={content.backend_search_terms}
                onChange={(event) => onContentChange({ ...content, backend_search_terms: event.target.value })}
              />
            ) : (
              <p className="text-sm leading-6 text-[#4b5660]">{content.backend_search_terms || "Search term generation is disabled."}</p>
            )}
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <ImageSquareIcon
                className={result.image_analysis?.analyzed ? "text-[#287149]" : "text-[#8b5810]"}
                size={19}
              />
              <h2 className="text-sm font-bold text-[#222b32]">Image analysis</h2>
            </div>
            <p
              className={
                result.image_analysis?.analyzed
                  ? "mb-3 rounded-lg bg-[#eef7f2] p-3 text-xs font-semibold text-[#276043]"
                  : "mb-3 rounded-lg bg-[#fff4df] p-3 text-xs font-semibold text-[#7d5113]"
              }
            >
              {result.image_analysis?.analyzed
                ? `${result.image_analysis.image_count} image${result.image_analysis.image_count === 1 ? "" : "s"} analyzed by ${result.metadata.model_name}`
                : "Images were not analyzed in demo mode"}
            </p>
            <div className="grid gap-2.5">
              {(result.image_analysis?.observations || ["No image observations are available."]).map(
                (observation, index) => (
                  <p
                    key={`${observation}-${index}`}
                    className="border-b border-[#edf0f2] pb-2.5 text-xs leading-5 text-[#4b5660] last:border-0 last:pb-0"
                  >
                    {observation}
                  </p>
                ),
              )}
            </div>
            {productAnalysis?.exact_text.length ? (
              <div className="mt-4 border-t border-[#e5e8ea] pt-3">
                <p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Detected text</p>
                <p className="text-xs font-semibold leading-5 text-[#39444d]">
                  {productAnalysis.exact_text.join(" · ")}
                </p>
              </div>
            ) : null}
            {productAnalysis?.colors.length ? (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Colors</p>
                <p className="text-xs leading-5 text-[#39444d]">{productAnalysis.colors.join(", ")}</p>
              </div>
            ) : null}
            {productAnalysis?.styles.length ? (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Style</p>
                <p className="text-xs leading-5 text-[#39444d]">{productAnalysis.styles.join(", ")}</p>
              </div>
            ) : null}
            {productAnalysis?.inferred_audiences.length ? (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold text-[#65717c]">Audience</p>
                <p className="text-xs leading-5 text-[#39444d]">
                  {productAnalysis.inferred_audiences.join(", ")}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <MagicWandIcon className="text-[#a24419]" size={18} />
              <h2 className="text-sm font-bold text-[#222b32]">SEO report</h2>
            </div>
            <div className="grid gap-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#65717c]">Keyword coverage</span>
                <strong className="text-sm text-[#222b32]">{result.seo_analysis.keyword_coverage_percent}%</strong>
              </div>
              {contentQuality ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#65717c]">Product fact coverage</span>
                  <strong className="text-sm text-[#222b32]">{contentQuality.fact_coverage_percent}%</strong>
                </div>
              ) : null}
              {keywordUsage?.length ? (
                <div className="grid gap-2 border-t border-[#e5e8ea] pt-3">
                  {keywordUsage.map((item) => (
                    <div key={item.keyword} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2">
                      {item.placements.length ? (
                        <CheckCircleIcon className="mt-0.5 text-[#287149]" size={14} weight="fill" />
                      ) : (
                        <XCircleIcon className="mt-0.5 text-[#9aa2a9]" size={14} />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold leading-5 text-[#39444d]">{item.keyword}</p>
                        <p className="text-[10px] leading-4 text-[#7a858e]">
                          {item.placements.length ? item.placements.join(", ") : "Not used"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[#65717c]">Main keyword</span>
                    <span className="text-right font-semibold text-[#39444d]">
                      {result.seo_analysis.main_keyword_used ? "Used" : "Missing"}
                    </span>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[#65717c]">Related keywords used</p>
                    <p className="leading-5 text-[#39444d]">
                      {result.seo_analysis.related_keywords_used.join(", ") || "None"}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheckIcon className={validation.passed ? "text-[#287149]" : "text-[#a06412]"} size={19} />
              <h2 className="text-sm font-bold text-[#222b32]">Policy report</h2>
            </div>
            <div className={validation.passed ? "mb-3 rounded-lg bg-[#eef7f2] p-3 text-xs font-semibold text-[#276043]" : "mb-3 rounded-lg bg-[#fff4df] p-3 text-xs font-semibold text-[#7d5113]"}>
              {validation.passed ? "Passed required policy checks" : `${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"} to resolve`}
            </div>
            <div className="grid gap-2.5">
              {validation.checks?.map((check) => (
                <div
                  key={check.name}
                  className={`flex items-start gap-2 text-xs leading-5 ${check.passed ? "text-[#276043]" : "text-[#7d5113]"}`}
                  title={check.detail}
                >
                  {check.passed ? (
                    <CheckCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" />
                  ) : (
                    <WarningCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" />
                  )}
                  <span>{check.name}</span>
                </div>
              ))}
              {validation.checks?.length && (validation.errors.length || validation.warnings.length) ? (
                <div className="border-t border-[#e5e8ea]" />
              ) : null}
              {validation.errors.map((issue, index) => (
                <div key={`error-${index}`} className="flex items-start gap-2 text-xs leading-5 text-[#8e3021]">
                  <XCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" />
                  <span>{issue.message}</span>
                </div>
              ))}
              {validation.warnings.map((issue, index) => (
                <div key={`warning-${index}`} className="flex items-start gap-2 text-xs leading-5 text-[#7d5113]">
                  <WarningCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" />
                  <span>{issue.message}</span>
                </div>
              ))}
              {!validation.checks?.length && !validation.errors.length && !validation.warnings.length ? (
                <div className="flex items-start gap-2 text-xs leading-5 text-[#276043]">
                  <CheckCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" />
                  <span>No policy warnings found.</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#dfe3e6] bg-white p-4 text-xs text-[#65717c]">
            <dl className="grid gap-2.5">
              <div className="flex justify-between gap-3">
                <dt>Processing time</dt>
                <dd className="font-semibold text-[#39444d]">{(result.metadata.processing_time_ms / 1000).toFixed(1)}s</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Retries</dt>
                <dd className="font-semibold text-[#39444d]">{result.metadata.retry_count}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Policy</dt>
                <dd className="max-w-36 truncate font-semibold text-[#39444d]" title={result.metadata.policy_version}>{result.metadata.policy_version}</dd>
              </div>
              {result.fallback_used ? (
                <div className="border-t border-[#e5e8ea] pt-2.5">
                  <dt className="font-semibold text-[#8b5810]">Fallback used</dt>
                  <dd className="mt-1 leading-5">{result.metadata.fallback_reason}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </aside>
      </div>
    </section>
  );
}
