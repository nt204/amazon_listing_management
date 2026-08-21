import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

export interface AutocompleteSeedDimension {
  id: "core_functions" | "target_audience" | "usage_context" | "key_attributes" | "pain_points";
  title: string;
  targetCount: string;
  description: string;
  items: string[];
}

export interface AutocompleteSeedResult {
  query: string;
  marketplace: string;
  totalRawSuggestions: number;
  totalSeeds: number;
  dimensions: {
    coreFunctions: AutocompleteSeedDimension;
    targetAudience: AutocompleteSeedDimension;
    usageContext: AutocompleteSeedDimension;
    keyAttributes: AutocompleteSeedDimension;
    painPoints: AutocompleteSeedDimension;
  };
  allSeeds: string[];
  rawSuggestions: string[];
}

/**
 * Fetch suggestions from Amazon Autocomplete endpoint for a single prefix.
 */
async function fetchSingleAmazonPrefix(prefix: string, marketplace: string = "US"): Promise<string[]> {
  try {
    const mid = marketplace === "UK" ? "A1F83G8C2ARO7P" : "ATVPDKIKX0DER";
    const lop = marketplace === "UK" ? "en_GB" : "en_US";
    const url = `https://completion.amazon.com/api/2017/suggestions?lop=${lop}&mid=${mid}&alias=aps&prefix=${encodeURIComponent(prefix)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.suggestions)) return [];

    return data.suggestions
      .map((s: { value?: string }) => s?.value?.trim() || "")
      .filter((val: string) => Boolean(val) && val.length > 2);
  } catch {
    return [];
  }
}

function cleanKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .trim();
}

/**
 * Multi-prefix crawler to get rich Amazon suggestions for a product query.
 */
export async function fetchAmazonAutocompleteSuggestions(query: string, marketplace: string = "US"): Promise<string[]> {
  const clean = cleanKeyword(query);
  if (!clean) return [];

  const tokens = clean.split(/\s+/).filter(Boolean);
  const baseCombos = new Set<string>([clean]);
  
  if (tokens.length >= 2) {
    baseCombos.add(tokens.slice(0, 2).join(" "));
    baseCombos.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    baseCombos.add(tokens.slice(tokens.length - 2).join(" "));
  }
  if (tokens.length >= 3) {
    baseCombos.add(tokens.slice(0, 3).join(" "));
    baseCombos.add(tokens.slice(1).join(" "));
    baseCombos.add(`${tokens[0]} ${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`);
    baseCombos.add(`${tokens[0]} ${tokens[1]} ${tokens[tokens.length - 1]}`);
  }

  const prefixes = new Set<string>();
  for (const base of baseCombos) {
    prefixes.add(base);
    prefixes.add(`${base} for`);
    prefixes.add(`${base} for women`);
    prefixes.add(`${base} for men`);
    prefixes.add(`${base} funny`);
    prefixes.add(`${base} gifts`);
    prefixes.add(`${base} party`);
    prefixes.add(`${base} safe`);
    prefixes.add(`${base} with`);
  }

  const firstBase = Array.from(baseCombos)[0];
  const letters = ["a", "c", "d", "f", "g", "m", "p", "s", "w"];
  for (const letter of letters) {
    prefixes.add(`${firstBase} ${letter}`);
    if (tokens.length >= 3) {
      prefixes.add(`${tokens.slice(tokens.length - 2).join(" ")} ${letter}`);
    }
  }

  const results = await Promise.all(
    Array.from(prefixes).map((p) => fetchSingleAmazonPrefix(p, marketplace))
  );

  const unique = new Set<string>();
  const isMugQuery = clean.includes("mug") || clean.includes("cup") || clean.includes("tumbler");
  const isOrnamentQuery = clean.includes("ornament");

  for (const list of results) {
    for (const item of list) {
      const lower = cleanKeyword(item);
      if (!lower) continue;
      // Filter irrelevant noise
      if (isMugQuery && (lower.includes("cupcake") || lower.includes("topper") || lower.includes("decorations") || lower.includes("picks") || lower.includes("banner") || lower.includes("napkin") || lower.includes("balloon"))) {
        continue;
      }
      if (isOrnamentQuery && (lower.includes("playpen") || lower.includes("gate") || lower.includes("pen") || lower.includes("crate") || lower.includes("bowl"))) {
        continue;
      }
      unique.add(lower);
    }
  }

  return Array.from(unique);
}

/**
 * Checks if a keyword looks like a valid search term rather than a description.
 */
function isValidSearchTerm(kw: string): boolean {
  if (!kw || kw.length < 3) return false;
  const invalidStarters = ["finding a", "lack of", "drinking", "celebrating", "daily use", "various", "gift giving", "home", "office"];
  const lower = kw.toLowerCase();
  if (invalidStarters.some((prefix) => lower.startsWith(prefix) || lower === prefix)) {
    return false;
  }
  return true;
}

/**
 * AI-assisted classification of Amazon Autocomplete seeds into 5 core dimensions.
 */
export async function structureSeedsWithAI(
  query: string,
  rawSuggestions: string[]
): Promise<{
  coreFunctions: string[];
  targetAudience: string[];
  usageContext: string[];
  keyAttributes: string[];
  painPoints: string[];
}> {
  const theme = query.toLowerCase().split(/\s+/)[0] || "";

  // 1. Try Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are an Amazon SEO and Competitor Reverse-Engineering Specialist.
Target Product: "${query}".

Here are real Amazon US Autocomplete suggestions collected from actual Amazon shoppers:
${JSON.stringify(rawSuggestions.slice(0, 50), null, 2)}

Your task is to select and organize EXACTLY 10 to 13 High-Intent Amazon Search Queries into 5 standard dimensions:

1. core_functions (2-3 items): Exact search queries for the core product type combined with the theme (e.g. ["${theme} coffee mug", "${theme} coffee cup", "${theme} tumbler mug"]).
2. target_audience (2-3 items): Exact search queries specifying recipient/demographic (e.g. ["${theme} coffee mugs for women", "${theme} coffee mug for men", "${theme} coffee mug for coworker"]).
3. usage_context (2-3 items): Exact search queries for occasion, party, or gifting event (e.g. ["happy ${theme} gifts coffee mug", "${theme} party coffee mug", "farewell going away coffee mug"]).
4. key_attributes (2-3 items): Exact search queries with design style, size, or material (e.g. ["funny ${theme} coffee mug", "${theme} coffee mug ceramic", "${theme} coffee mug with lid"]).
5. pain_points (1-2 items): Exact search queries for durability, ease of cleaning, or safety (e.g. ["dishwasher safe ${theme} coffee mug", "durable ceramic ${theme} coffee mug"]).

STRICT CONSTRAINTS:
- Every query MUST contain the product theme/topic ("${theme}") whenever relevant.
- Select from the provided real Amazon suggestions list whenever applicable.
- Return EXACTLY 2-3 items for groups 1-4, and 1-2 items for group 5 (Total 10-13 seeds).

Output JSON format:
{
  "core_functions": ["query 1", "query 2", "query 3"],
  "target_audience": ["query 1", "query 2", "query 3"],
  "usage_context": ["query 1", "query 2", "query 3"],
  "key_attributes": ["query 1", "query 2", "query 3"],
  "pain_points": ["query 1", "query 2"]
}`;

      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        const cf = (parsed.core_functions || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const ta = (parsed.target_audience || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const uc = (parsed.usage_context || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const ka = (parsed.key_attributes || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const pp = (parsed.pain_points || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 2);

        if (cf.length >= 2 && ta.length >= 2 && uc.length >= 2 && ka.length >= 2 && pp.length >= 1) {
          return { coreFunctions: cf, targetAudience: ta, usageContext: uc, keyAttributes: ka, painPoints: pp };
        }
      }
    } catch {
      // Fallback to next provider
    }
  }

  // 2. Try CheapKey AI / OpenAI
  const cheapKeyApiKey = process.env.CHEAPKEYAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (cheapKeyApiKey) {
    try {
      const baseURL = (process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1").trim().replace(/\/+$/, "");
      const client = new OpenAI({
        apiKey: cheapKeyApiKey,
        baseURL: process.env.CHEAPKEYAI_API_KEY ? baseURL : undefined,
      });
      const model = process.env.CHEAPKEYAI_API_KEY ? (process.env.CHEAPKEYAI_UPSTREAM_TEXT_MODEL || "gpt-4o-mini") : "gpt-4o-mini";

      const prompt = `Classify 10-13 high intent Amazon search query seeds for product: "${query}" using these real suggestions:
${JSON.stringify(rawSuggestions.slice(0, 40))}

Output JSON with keys:
"core_functions" (2-3 queries combining theme & product, e.g. ["${theme} coffee mug", "${theme} coffee cup"]),
"target_audience" (2-3 queries with recipient, e.g. ["${theme} coffee mugs for women", "${theme} coffee mug for men"]),
"usage_context" (2-3 queries with event/occasion, e.g. ["happy ${theme} gifts coffee mug", "${theme} party mug"]),
"key_attributes" (2-3 queries with attributes/style, e.g. ["funny ${theme} coffee mug", "${theme} coffee mug ceramic"]),
"pain_points" (1-2 queries with durability/care, e.g. ["dishwasher safe ${theme} coffee mug", "durable ceramic ${theme} mug"]).`;

      const resp = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are an Amazon SEO expert. Output valid JSON only." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const text = resp.choices[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text);
        const cf = (parsed.core_functions || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const ta = (parsed.target_audience || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const uc = (parsed.usage_context || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const ka = (parsed.key_attributes || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 3);
        const pp = (parsed.pain_points || []).map(cleanKeyword).filter(isValidSearchTerm).slice(0, 2);

        if (cf.length >= 2 && ta.length >= 2 && uc.length >= 2 && ka.length >= 2 && pp.length >= 1) {
          return { coreFunctions: cf, targetAudience: ta, usageContext: uc, keyAttributes: ka, painPoints: pp };
        }
      }
    } catch {
      // Fallback to rule-based
    }
  }

  // 3. Fallback to smart rule-based classifier
  return classifySeedsRuleBased(query, rawSuggestions);
}

/**
 * High-precision Rule-based fallback classifier that extracts directly from raw Amazon autocomplete terms.
 */
function classifySeedsRuleBased(
  query: string,
  rawSuggestions: string[]
): {
  coreFunctions: string[];
  targetAudience: string[];
  usageContext: string[];
  keyAttributes: string[];
  painPoints: string[];
} {
  const cleanQ = cleanKeyword(query);
  const words = cleanQ.split(/\s+/);
  const theme = words[0] || "";
  const coreNoun = words.slice(1).join(" ") || cleanQ;

  const coreSet = new Set<string>();
  const audienceSet = new Set<string>();
  const contextSet = new Set<string>();
  const attributeSet = new Set<string>();
  const painSet = new Set<string>();

  const audienceKeywords = ["women", "men", "woman", "man", "coworker", "boss", "nurse", "teacher", "dad", "mom", "sister", "friend", "colleague", "doctor", "fireman", "him", "her", "kids"];
  const contextKeywords = ["gift", "gifts", "party", "farewell", "going away", "celebration", "retirement", "leaving", "happy", "card", "set", "exchange"];
  const attributeKeywords = ["funny", "ceramic", "11oz", "15oz", "20oz", "personalized", "custom", "with lid", "with handle", "with straw", "vintage", "retro", "humorous", "stainless steel"];
  const painKeywords = ["dishwasher safe", "microwave safe", "shatterproof", "durable", "spill proof", "insulated", "lead free", "fade resistant"];

  // Filter raw suggestions into theme-matching and general
  for (const item of rawSuggestions) {
    const lower = cleanKeyword(item);
    if (!lower || !isValidSearchTerm(lower)) continue;

    // Check if contains theme
    const hasTheme = !theme || lower.includes(theme);

    if (painKeywords.some((w) => lower.includes(w))) {
      if (painSet.size < 2) painSet.add(lower);
    } else if (audienceKeywords.some((w) => lower.includes(w))) {
      if (hasTheme && audienceSet.size < 3) audienceSet.add(lower);
    } else if (attributeKeywords.some((w) => lower.includes(w))) {
      if (hasTheme && attributeSet.size < 3) attributeSet.add(lower);
    } else if (contextKeywords.some((w) => lower.includes(w)) && (lower.includes("party") || lower.includes("farewell") || lower.includes("going away") || lower.includes("gifts") || lower.includes("card"))) {
      if (hasTheme && contextSet.size < 3) contextSet.add(lower);
    } else if (hasTheme) {
      if (coreSet.size < 3 && lower.length >= 6) {
        coreSet.add(lower);
      }
    }
  }

  // Ensure high quality concrete seeds for each bucket
  if (coreSet.size < 2) {
    coreSet.add(`${theme} coffee mug`.trim());
    coreSet.add(`${theme} coffee cup`.trim());
  }
  if (coreSet.size < 3) {
    coreSet.add(`${theme} tumbler mug`.trim());
  }

  if (audienceSet.size < 2) {
    audienceSet.add(`${cleanQ} for women`);
    audienceSet.add(`${cleanQ} for men`);
  }
  if (audienceSet.size < 3) {
    audienceSet.add(`${cleanQ} for coworker`);
  }

  if (contextSet.size < 2) {
    contextSet.add(`happy ${cleanQ} gifts`);
    contextSet.add(`${cleanQ} and card`);
  }
  if (contextSet.size < 3) {
    contextSet.add(`farewell going away ${coreNoun}`);
  }

  if (attributeSet.size < 2) {
    attributeSet.add(`funny ${cleanQ}`);
    attributeSet.add(`${cleanQ} ceramic`);
  }
  if (attributeSet.size < 3) {
    attributeSet.add(`${cleanQ} with lid`);
  }

  if (painSet.size < 1) {
    painSet.add(`dishwasher safe ${cleanQ}`);
  }
  if (painSet.size < 2) {
    painSet.add(`durable ceramic ${cleanQ}`);
  }

  return {
    coreFunctions: Array.from(coreSet).slice(0, 3),
    targetAudience: Array.from(audienceSet).slice(0, 3),
    usageContext: Array.from(contextSet).slice(0, 3),
    keyAttributes: Array.from(attributeSet).slice(0, 3),
    painPoints: Array.from(painSet).slice(0, 2),
  };
}

/**
 * Main export function to get the complete 10-13 seeds categorized into 5 dimensions.
 */
export async function getCategorizedAutocompleteSeeds(
  query: string,
  marketplace: string = "US"
): Promise<AutocompleteSeedResult> {
  const rawSuggestions = await fetchAmazonAutocompleteSuggestions(query, marketplace);
  const structured = await structureSeedsWithAI(query, rawSuggestions);

  // Global deduplication to keep all seeds unique
  const seenSeeds = new Set<string>();
  const filterUnique = (list: string[], max: number) => {
    const res: string[] = [];
    for (const item of list) {
      if (!seenSeeds.has(item) && res.length < max) {
        seenSeeds.add(item);
        res.push(item);
      }
    }
    return res;
  };

  const uniqueCore = filterUnique(structured.coreFunctions, 3);
  const uniqueAudience = filterUnique(structured.targetAudience, 3);
  const uniqueContext = filterUnique(structured.usageContext, 3);
  const uniqueAttributes = filterUnique(structured.keyAttributes, 3);
  const uniquePainPoints = filterUnique(structured.painPoints, 2);

  const dimensions = {
    coreFunctions: {
      id: "core_functions" as const,
      title: "Chức năng chính",
      targetCount: "2-3",
      description: "Định danh loại sản phẩm cốt lõi & biến thể hình thái (Mug, Cup, Tumbler)",
      items: uniqueCore,
    },
    targetAudience: {
      id: "target_audience" as const,
      title: "Đối tượng dùng",
      targetCount: "2-3",
      description: "Người nhận hoặc đối tượng sử dụng trực tiếp (Women, Men, Coworker, Boss)",
      items: uniqueAudience,
    },
    usageContext: {
      id: "usage_context" as const,
      title: "Ngữ cảnh dùng",
      targetCount: "2-3",
      description: "Dịp tặng quà, bữa tiệc, sự kiện chia tay (Retirement Party, Farewell, Going Away)",
      items: uniqueContext,
    },
    keyAttributes: {
      id: "key_attributes" as const,
      title: "Thuộc tính nổi bật",
      targetCount: "2-3",
      description: "Phong cách thiết kế, chất liệu, dung tích (Funny quotes, Ceramic 11oz, With Lid)",
      items: uniqueAttributes,
    },
    painPoints: {
      id: "pain_points" as const,
      title: "Pain point khách gặp / Tiện ích",
      targetCount: "1-2",
      description: "Yếu tố giải quyết nỗi lo của khách (Dishwasher Safe, Microwave Safe, Durable)",
      items: uniquePainPoints,
    },
  };

  const allSeeds = [
    ...uniqueCore,
    ...uniqueAudience,
    ...uniqueContext,
    ...uniqueAttributes,
    ...uniquePainPoints,
  ];

  return {
    query,
    marketplace,
    totalRawSuggestions: rawSuggestions.length,
    totalSeeds: allSeeds.length,
    dimensions,
    allSeeds,
    rawSuggestions,
  };
}
