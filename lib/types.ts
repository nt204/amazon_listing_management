import type { AiProviderPreference } from "@/lib/models";

export type Marketplace = "US" | "UK" | "DE";
export type ListingStatus =
  | "Draft"
  | "Generated"
  | "Needs Review"
  | "Approved"
  | "Rejected"
  | "Exported";

export interface ListingInput {
  marketplace: Marketplace;
  product_type: string;
  internal_name: string;
  brand: string;
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
    occasion: string[];
    customer_insight: string;
    usp: string;
    competitor_asins: string[];
    competitor_notes: string;
    notes: string;
  };
  images: Array<{
    name: string;
    type: string;
    data_url: string;
  }>;
  configuration: {
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
  colors: string[];
  styles: string[];
  subjects: string[];
  supplied_facts: string[];
  inferred_audiences: string[];
  inferred_occasions: string[];
  related_keywords: string[];
  competitor_insights: string[];
  listing_angle: string;
  facts_to_avoid: string[];
  policy_risks: string[];
}

export interface KeywordUsage {
  keyword: string;
  is_main: boolean;
  placements: Array<"title" | "bullets" | "description" | "backend_search_terms">;
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
  listing: ListingContent;
  seo_analysis: {
    main_keyword: string;
    main_keyword_used: boolean;
    related_keywords_used: string[];
    unused_keywords: string[];
    keyword_coverage_percent: number;
    keyword_stuffing_detected: boolean;
    keyword_usage?: KeywordUsage[];
  };
  content_quality: {
    supplied_facts: string[];
    facts_used: string[];
    unused_facts: string[];
    fact_coverage_percent: number;
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
  created_at: string;
  updated_at: string;
}

export interface ListingSummary {
  id: string;
  internal_name: string;
  product_type: string;
  marketplace: Marketplace;
  status: ListingStatus;
  model_used: ListingResult["model_used"];
  created_at: string;
  updated_at: string;
}
