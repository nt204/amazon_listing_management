import type { AiProviderPreference } from "@/lib/models";

export type Marketplace = "US" | "UK" | "DE";
export type ListingStatus = "Draft" | "Review" | "Approved" | "Exported";
export type KeywordResearchCategory =
  | "core"
  | "long_tail"
  | "occasion"
  | "audience"
  | "attribute"
  | "other";

export interface KeywordResearchTerm {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  iq_score: number | null;
  organic_rank: number | null;
  sponsored_rank: number | null;
  competitor_asins: string[];
  competitor_count: number;
  category: KeywordResearchCategory;
  relevance_score: number;
  opportunity_score: number;
  selected: boolean;
  exclusion_reason?: string;
}

export interface KeywordResearchSnapshot {
  source: "helium10" | "mock";
  seed_keyword: string;
  marketplace: Marketplace;
  competitor_asins: string[];
  terms: KeywordResearchTerm[];
  generic_keywords: string[];
  search_terms: string;
  top_core_keywords: string[];
  minimum_attribute_search_volume: number;
  captured_at: string;
  warnings: string[];
}

export type EvidenceConfidence = "high" | "medium";
export type OwnEvidenceStatus = "confirmed" | "missing";
export type ProductEvidenceSource = "operator" | "image_ocr" | "image_visual";
export type ProductEvidenceConfidence = "high" | "medium" | "low";
export type ProductEvidenceVerification = "verified" | "needs_review" | "rejected";
export type ProductEvidenceCategory =
  | "material"
  | "dimensions"
  | "capacity"
  | "care"
  | "origin"
  | "package"
  | "safety"
  | "performance"
  | "color"
  | "design"
  | "subject"
  | "construction"
  | "text"
  | "other";

export interface ProductEvidenceItem {
  id: string;
  value: string;
  category: ProductEvidenceCategory;
  source: ProductEvidenceSource;
  source_image: number | null;
  source_text: string;
  source_field: string;
  confidence: ProductEvidenceConfidence;
  publishable: boolean;
  verification: ProductEvidenceVerification;
  reason: string;
  selected_for_product?: boolean;
}

export interface CompetitorSignal {
  value: string;
  sources: string[];
  confidence: EvidenceConfidence;
}

export interface CompetitorKeywordSignal extends CompetitorSignal {
  usable_for_listing: boolean;
  missing_own_facts: string[];
}

export interface CompetitorClaim extends CompetitorSignal {
  category: "material" | "capacity" | "dimensions" | "care" | "performance" | "origin" | "color" | "other";
  own_evidence: OwnEvidenceStatus;
}

export interface CompetitorReferenceProfile {
  asin?: string;
  url: string;
  title?: string;
  brand?: string;
  attributes: Record<string, string>;
  content_hash?: string;
  captured_characters?: number;
}

export interface CompetitorProfile {
  references: CompetitorReferenceProfile[];
  keyword_candidates: CompetitorKeywordSignal[];
  claims: CompetitorClaim[];
  audiences: CompetitorSignal[];
  occasions: CompetitorSignal[];
  blocked_terms: string[];
  captured_at: string;
}

export interface ListingInput {
  marketplace: Marketplace;
  product_type: string;
  internal_name: string;
  brand: string;
  brand_profile_id?: string;
  brand_guidelines?: string;
  product_information: {
    material: string;
    size_capacity: string;
    color: string;
    package_contents: string;
    features: string[];
    personalization: string;
    care_instructions: string;
    country_of_origin: string;
  };
  main_keyword: string;
  related_keywords: string[];
  backend_keywords: string[];
  research: {
    target_customer: string;
    gift_giver?: string;
    occasion: string[];
    customer_insight: string;
    usp: string;
    competitor_asins: string[];
    competitor_notes: string;
    notes: string;
    competitor_profile?: CompetitorProfile;
    keyword_research?: KeywordResearchSnapshot;
  };
  images: Array<{
    name: string;
    type: string;
    data_url: string;
    storage_key?: string;
    sha256?: string;
  }>;
  configuration: {
    rule_profile?: string;
    ai_provider: AiProviderPreference;
    gemini_model: string;
    openai_model: string;
    language: string;
    tone: string;
    bullet_count: number;
    title_length: number;
    bullet_length: number;
    generate_description: boolean;
    generate_search_terms: boolean;
  };
}

export interface ListingContent {
  title: string;
  bullet_points: string[];
  description: string;
  backend_search_terms: string;
}

export interface ProductBrief {
  visual_facts: string[];
  exact_text: string[];
  selected_ocr_line_ids?: string[];
  ocr_selection_complete?: boolean;
  image_facts?: string[];
  evidence_items?: ProductEvidenceItem[];
  colors: string[];
  styles: string[];
  subjects: string[];
  supplied_facts: string[];
  inferred_audiences: string[];
  inferred_occasions: string[];
  related_keywords: string[];
  backend_keywords?: string[];
  competitor_insights: string[];
  listing_angle: string;
  facts_to_avoid: string[];
  policy_risks: string[];
  ocr?: {
    engine: "tesseract";
    language: string;
    status: "success" | "partial" | "failed" | "disabled";
    images_processed: number;
    line_count: number;
    selected_line_count: number;
    selection: "model" | "fallback" | "direct";
    warnings: string[];
  };
}

export interface KeywordUsage {
  keyword: string;
  is_main: boolean;
  placements: Array<"title" | "bullets" | "description" | "backend_search_terms">;
  source?: "main" | "operator" | "competitor" | "ai";
  weight?: number;
  source_count?: number;
  confidence?: EvidenceConfidence;
  usable?: boolean;
  placement_score_percent?: number;
}

export interface BackendSearchTermAnalysis {
  bytes_used: number;
  byte_limit: number;
  bytes_remaining: number;
  unique_word_count: number;
  useful_word_count: number;
  available_word_count: number;
  efficiency_percent: number;
  repeated_words: string[];
  redundant_visible_words: string[];
  stop_words: string[];
  prohibited_terms: string[];
  low_intent_terms: string[];
  irrelevant_terms: string[];
  suggested_value: string;
  suggested_bytes: number;
  opportunity_words: string[];
}

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  source_url?: string;
}

export interface ListingResult {
  request_id: string;
  status: "success" | "needs_review";
  marketplace: Marketplace;
  product_type: string;
  model_used: "gemini" | "openai" | "mock";
  fallback_used: boolean;
  image_analysis: {
    analyzed: boolean;
    image_count: number;
    observations: string[];
  };
  product_analysis?: ProductBrief;
  competitor_profile?: CompetitorProfile;
  listing: ListingContent;
  seo_analysis: {
    main_keyword: string;
    main_keyword_used: boolean;
    related_keywords_used: string[];
    unused_keywords: string[];
    keyword_coverage_percent: number;
    backend_coverage_percent?: number;
    backend_search_terms?: BackendSearchTermAnalysis;
    keyword_stuffing_detected: boolean;
    keyword_usage?: KeywordUsage[];
  };
  content_quality: {
    supplied_facts: string[];
    facts_used: string[];
    unused_facts: string[];
    image_facts?: string[];
    image_facts_used?: string[];
    unused_image_facts?: string[];
    fact_coverage_percent: number;
    reference_utilization_percent?: number;
    title_repetition_detected: boolean;
  };
  policy_validation: {
    passed: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    checks?: PolicyCheck[];
  };
  metadata: {
    processing_time_ms: number;
    retry_count: number;
    prompt_version: string;
    policy_version: string;
    evidence_version?: string;
    rule_profile?: string;
    created_at: string;
    model_name: string;
    fallback_reason?: string;
    estimated_cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface StoredListing {
  id: string;
  status: ListingStatus;
  input: ListingInput;
  result: ListingResult;
  current_listing: ListingContent;
  revisions: ListingRevision[];
  created_at: string;
  updated_at: string;
}

export interface RevisionQualitySnapshot {
  fact_coverage_percent: number;
  keyword_coverage_percent: number;
  error_count: number;
  warning_count: number;
}

export interface ListingRevision {
  id: string;
  action: string;
  instruction: string;
  content: ListingContent;
  quality: RevisionQualitySnapshot | null;
  created_at: string;
}

export interface ListingSummary {
  id: string;
  internal_name: string;
  main_keyword: string;
  product_type: string;
  marketplace: Marketplace;
  status: ListingStatus;
  model_used: ListingResult["model_used"];
  fact_coverage_percent: number;
  keyword_coverage_percent: number;
  error_count: number;
  warning_count: number;
  missing_fact_count: number;
  created_at: string;
  updated_at: string;
}

export interface BrandProfile {
  id: string;
  name: string;
  guidelines: string;
  created_at: string;
  updated_at: string;
}

export interface ListingTemplateMetadata {
  sheet_name: string;
  attribute_row: number;
  label_row: number;
  data_row: number;
  column_count: number;
  last_column: string;
  source_parent_row: number;
  source_child_row: number;
  content_columns: {
    sku: string;
    title: string;
    description: string;
    bullet_points: string[];
    generic_keywords: string;
    main_image: string;
  };
  defaults: {
    material: string;
    size_capacity: string;
    color: string;
    package_contents: string;
    features: string[];
    country_of_origin: string;
  };
}

export interface ListingTemplateSummary {
  id: string;
  name: string;
  original_filename: string;
  file_extension: string;
  product_type: string;
  metadata: ListingTemplateMetadata;
  created_at: string;
  updated_at: string;
}

export interface WorkflowMetrics {
  total: number;
  draft: number;
  review: number;
  approved: number;
  exported: number;
  with_errors: number;
  missing_facts: number;
}
