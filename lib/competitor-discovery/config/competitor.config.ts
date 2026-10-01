export interface CompetitorConfig {
  targetCandidateCount: number;
  minimumRelevance: number;
  weights: {
    relevance: number;
    revenue: number;
    sales: number;
    bsr: number;
  };
  maxPerParent: number;
  maxPerBrand: number;
  finalLimit: number;
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxBatchSize: number;
  };
}

export const competitorConfig: CompetitorConfig = {
  targetCandidateCount: 60,
  minimumRelevance: 70,
  weights: {
    relevance: 0.50,
    revenue: 0.30,
    sales: 0.10,
    bsr: 0.10,
  },
  maxPerParent: 1,
  maxPerBrand: 3,
  finalLimit: 10,
  ai: {
    baseUrl: process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1",
    apiKey:
      process.env.KEYWORD_AI_API_KEY ||
      process.env.CHEAPKEYAI_GEMINI_API_KEY ||
      "sk-wHzuyDAkK3ZXNEHtxdqTOwO1Dh1LExPnMKK0N6au0G01vDVj",
    model: "gemini-3.7-flash",
    maxBatchSize: 30,
  },
};
