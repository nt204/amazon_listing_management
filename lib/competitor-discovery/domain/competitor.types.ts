export type PlacementType = "organic" | "sponsored" | "unknown";

export type CandidateStatus =
  | "RAW"
  | "SPONSORED_REJECTED"
  | "AI_SCORED"
  | "PRODUCT_MISMATCH"
  | "LOW_RELEVANCE"
  | "ELIGIBLE"
  | "PARENT_DUPLICATE"
  | "SELECTED";

export interface SellerSpriteCandidate {
  asin: string;
  parentAsin?: string;
  title: string;
  brand?: string;
  category?: string;
  monthlyRevenue?: number;
  monthlySales?: number;
  bsr?: number;
  price?: number;
  position: number;
  placement: PlacementType;
  image?: string;
  rating?: number;
  reviewCount?: number;
  fees?: number;
  profit?: number;
  sellerCountry?: string;
  sellerType?: string;
  badges?: string[];
  status?: CandidateStatus;
  rejectReason?: string;
}

export interface AiRelevanceResult {
  asin: string;
  relevanceScore: number; // 0 - 100
  sameProductType: boolean;
  hardMismatch: boolean;
  reason: string;
}

export interface CandidateScores {
  relevance: number; // 0 - 100
  revenue: number;   // 0 - 100
  sales: number;     // 0 - 100
  bsr: number;       // 0 - 100
  final: number;     // 0 - 100
}

export interface ScoredCandidate extends SellerSpriteCandidate {
  rank?: number;
  ai: {
    relevanceScore: number;
    sameProductType: boolean;
    hardMismatch: boolean;
    reason: string;
  };
  scores: CandidateScores;
}

export interface CompetitorDiscoveryRunStats {
  raw: number;
  organicOnly: number;
  afterAiFilter: number;
  afterHardFilter: number;
  selected: number;
}

export interface RejectedCandidateRecord {
  asin: string;
  title?: string;
  reasonCode: string;
  relevanceScore?: number;
}

export interface CompetitorDiscoveryOutput {
  productName: string;
  marketplace: string;
  stats: CompetitorDiscoveryRunStats;
  competitors: ScoredCandidate[];
  allEligible?: ScoredCandidate[];
  rejected: RejectedCandidateRecord[];
}

export interface CompetitorDiscoveryInput {
  productName: string;
  marketplace?: string;
  limit?: number;
  weights?: CandidateScoreWeights;
}

export interface CandidateScoreWeights {
  relevance: number;
  revenue: number;
  sales: number;
  bsr: number;
}
