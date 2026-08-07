import "server-only";

import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import {
  createKeywordResearchSnapshot,
  normalizeKeyword,
  titleCaseKeyword,
  type KeywordResearchContext,
  type RawKeywordMetric,
} from "@/lib/keyword-research";
import { discoverCompetitorAsins } from "@/lib/competitor";
import { getMarketplaceRules, getRuleProfile } from "@/lib/rules";
import type { KeywordResearchSnapshot, ListingInput } from "@/lib/types";

interface ResearchCacheEntry {
  expiresAt: number;
  promise: Promise<KeywordResearchSnapshot>;
}

const globalForHelium10 = globalThis as unknown as {
  helium10ResearchCache?: Map<string, ResearchCacheEntry>;
};
const researchCache = globalForHelium10.helium10ResearchCache || new Map<string, ResearchCacheEntry>();
globalForHelium10.helium10ResearchCache = researchCache;

const asinPattern = /\b(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])\b/gi;

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function helium10MockEnabled() {
  const configured = process.env.HELIUM10_MOCK_MODE?.trim();
  return configured ? configured === "true" : process.env.AI_MOCK_MODE === "true";
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function schemaType(schema: JsonSchema) {
  return Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
}

function marketplaceValue(schema: JsonSchema, marketplace: KeywordResearchContext["marketplace"]) {
  const domain = { US: "amazon.com", UK: "amazon.co.uk", DE: "amazon.de" }[marketplace];
  const candidates = schema.enum || [];
  const matched = candidates.find((candidate) => {
    const value = String(candidate).toLowerCase();
    return value === marketplace.toLowerCase() || value.includes(domain);
  });
  return matched ?? marketplace;
}

function semanticValue(
  name: string,
  schema: JsonSchema,
  values: {
    keyword: string;
    asins: string[];
    marketplace: KeywordResearchContext["marketplace"];
    limit: number;
  },
) {
  const key = normalizedKey(name);
  const type = schemaType(schema);
  const array = type === "array";
  if (/^(keyword|keywords|seedkeyword|searchterm|searchterms|searchquery|query|phrase)$/.test(key)) {
    return array ? [values.keyword] : values.keyword;
  }
  if (/^(asin|asins|productid|productids|amazonproductid|amazonproductids)$/.test(key)) {
    return array ? values.asins : values.asins[0];
  }
  if (/^(primaryasin|seedasin|primaryproductid|seedproductid)$/.test(key)) return values.asins[0];
  if (/^(competitorasins|secondaryasins|competitorproductids|secondaryproductids)$/.test(key)) {
    return array ? values.asins.slice(1) : values.asins[1];
  }
  if (/^(marketplace|marketplaceid|country|countrycode|domain)$/.test(key)) {
    return marketplaceValue(schema, values.marketplace);
  }
  if (/^(limit|size|pagesize|maxresults|resultlimit|count)$/.test(key)) return values.limit;
  if (/^(page|pagenumber|offset)$/.test(key)) return key === "offset" ? 0 : 1;
  if (schema.default !== undefined) return schema.default;
  if (type === "object") return {};
  if (type === "array") return [];
  if (schema.enum?.length === 1) return schema.enum[0];
  return undefined;
}

function buildToolArguments(
  tool: Tool,
  values: {
    keyword: string;
    asins: string[];
    marketplace: KeywordResearchContext["marketplace"];
    limit: number;
  },
) {
  const input = tool.inputSchema as JsonSchema;
  const properties = input.properties || {};
  const required = new Set(input.required || []);
  const args: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(properties)) {
    const value = semanticValue(name, schema, values);
    if (value !== undefined) args[name] = value;
    else if (required.has(name)) {
      throw new Error(`Helium 10 tool '${tool.name}' has an unsupported required argument '${name}'.`);
    }
  }
  return args;
}

function parseTextPayload(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1];
    if (!fenced) return trimmed;
    try {
      return JSON.parse(fenced) as unknown;
    } catch {
      return trimmed;
    }
  }
}

function resultPayload(result: CallToolResult) {
  const payloads: unknown[] = [];
  if (result.structuredContent !== undefined) payloads.push(result.structuredContent);
  for (const block of result.content || []) {
    if (block.type === "text") payloads.push(parseTextPayload(block.text));
    if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) payloads.push(parseTextPayload(resource.text));
    }
  }
  return payloads.filter((value) => value !== undefined);
}

function valuesFromObject(record: Record<string, unknown>) {
  return new Map(Object.entries(record).map(([key, value]) => [normalizedKey(key), value]));
}

function firstString(values: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = values.get(alias);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(values: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = values.get(alias);
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,%\s]/g, "")) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function extractAsins(value: unknown) {
  const found = new Set<string>();
  const visit = (current: unknown) => {
    if (typeof current === "string") {
      for (const match of current.match(asinPattern) || []) found.add(match.toUpperCase());
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (current && typeof current === "object") Object.values(current).forEach(visit);
  };
  visit(value);
  return [...found];
}

function extractKeywordMetrics(payloads: unknown[], defaultAsin?: string) {
  const rows: RawKeywordMetric[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const values = valuesFromObject(record);
    let keyword = firstString(values, [
      "keyword",
      "searchterm",
      "searchquery",
      "keywordphrase",
      "phrase",
      "query",
    ]);
    if (!keyword && firstNumber(values, ["searchvolume", "monthlysearchvolume", "volume"]) !== null) {
      keyword = firstString(values, ["value"]);
    }
    if (keyword) {
      const asins = extractAsins(record);
      if (defaultAsin && !asins.includes(defaultAsin)) asins.push(defaultAsin);
      rows.push({
        keyword,
        search_volume: firstNumber(values, ["searchvolume", "monthlysearchvolume", "magnetsearchvolume", "volume"]),
        cpc: firstNumber(values, ["cpc", "costperclick", "suggestedbid"]),
        iq_score: firstNumber(values, ["iqscore", "cerebroiqscore", "magnetiqscore"]),
        organic_rank: firstNumber(values, ["organicrank", "positionrank", "position", "rank"]),
        sponsored_rank: firstNumber(values, ["sponsoredrank", "paidrank"]),
        competitor_count: firstNumber(values, ["competitorcount", "rankingcompetitors", "competingproducts"]) || asins.length,
        competitor_asins: asins,
      });
    }
    Object.values(record).forEach(visit);
  };
  payloads.forEach(visit);
  return rows;
}

function findTool(tools: Tool[], names: string[]) {
  for (const name of names) {
    const exact = tools.find((tool) => tool.name === name);
    if (exact) return exact;
  }
  return undefined;
}

async function callTool(
  client: Client,
  tool: Tool,
  values: Parameters<typeof buildToolArguments>[1],
  signal?: AbortSignal,
) {
  const result = await client.callTool({
    name: tool.name,
    arguments: buildToolArguments(tool, values),
  }, {
    signal,
    timeout: configuredNumber("HELIUM10_TOOL_TIMEOUT_MS", 45_000, 5_000, 120_000),
    maxTotalTimeout: configuredNumber("HELIUM10_TOOL_TIMEOUT_MS", 45_000, 5_000, 120_000),
    toolDefinition: tool,
  });
  if (result.isError) {
    const message = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(" ");
    throw new Error(message || `Helium 10 tool '${tool.name}' failed.`);
  }
  return resultPayload(result);
}

function mockResearch(context: KeywordResearchContext) {
  const seed = normalizeKeyword(context.main_keyword);
  const product = normalizeKeyword(context.product_type) || "product";
  const audience = normalizeKeyword(context.target_customer).split(" ").slice(-2).join(" ");
  const occasion = normalizeKeyword(context.occasion[0] || "birthday");
  const feature = normalizeKeyword(context.product_information.features[0] || context.product_information.material);
  const asins = ["B0TEST0001", "B0TEST0002", "B0TEST0003", "B0TEST0004", "B0TEST0005"];
  const rawTerms: RawKeywordMetric[] = [
    { keyword: seed, search_volume: 1_600, iq_score: 720, organic_rank: 8, competitor_asins: asins },
    { keyword: `${seed} gift`, search_volume: 920, iq_score: 610, organic_rank: 14, competitor_asins: asins.slice(0, 4) },
    { keyword: `${product} gift`, search_volume: 760, iq_score: 540, organic_rank: 21, competitor_asins: asins.slice(0, 4) },
    { keyword: `unrelated wholesale ${product}`, search_volume: 2_400, organic_rank: 4, competitor_asins: asins.slice(0, 1) },
  ];
  if (audience) rawTerms.push({ keyword: `${seed} for ${audience}`, search_volume: 480, organic_rank: 17, competitor_asins: asins.slice(0, 3) });
  if (occasion) rawTerms.push({ keyword: `${occasion} ${seed}`, search_volume: 360, organic_rank: 25, competitor_asins: asins.slice(0, 3) });
  if (feature) rawTerms.push({ keyword: `${feature} ${product}`, search_volume: 220, organic_rank: 31, competitor_asins: asins.slice(0, 2) });
  return createKeywordResearchSnapshot({
    context,
    rawTerms,
    competitorAsins: asins,
    source: "mock",
    warnings: ["Dữ liệu mẫu dùng để kiểm thử giao diện, không phải dữ liệu Helium 10."],
  });
}

async function fetchHelium10Research(context: KeywordResearchContext, signal?: AbortSignal) {
  if (helium10MockEnabled()) return mockResearch(context);
  const token = process.env.HELIUM10_MCP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("Helium 10 chưa được kết nối. Hãy cấu hình HELIUM10_MCP_ACCESS_TOKEN hoặc bật HELIUM10_MOCK_MODE để kiểm thử.");
  }
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.HELIUM10_MCP_URL || "https://mcp.helium10.com/mcp"),
    {
      authProvider: { token: async () => token },
      onInsufficientScope: "throw",
    },
  );
  const client = new Client({ name: "listing-desk", version: "0.1.0" }, {
    capabilities: {},
    enforceStrictCapabilities: true,
  });
  const warnings: string[] = [];
  try {
    await client.connect(transport, {
      signal,
      timeout: configuredNumber("HELIUM10_CONNECT_TIMEOUT_MS", 20_000, 3_000, 60_000),
    });
    const { tools } = await client.listTools(undefined, { signal, cacheMode: "refresh" });
    const seedTool = findTool(tools, ["get_keywords_by_keyword"]);
    if (!seedTool) throw new Error("Helium 10 MCP không cung cấp tool get_keywords_by_keyword cho tài khoản này.");
    const values = {
      keyword: context.main_keyword,
      asins: [] as string[],
      marketplace: context.marketplace,
      limit: 200,
    };
    const seedPayload = await callTool(client, seedTool, values, signal);
    let competitorAsins = extractAsins(seedPayload).slice(0, context.competitor_count);
    if (competitorAsins.length < context.competitor_count) {
      const productTool = tools.find((tool) => {
        const name = tool.name.toLowerCase();
        return (
          (name.includes("search") || name.includes("top")) &&
          (name.includes("product") || name.includes("amazon")) &&
          !name.includes("inactive")
        );
      });
      if (productTool) {
        try {
          const productPayload = await callTool(client, productTool, values, signal);
          competitorAsins = [...new Set([...competitorAsins, ...extractAsins(productPayload)])]
            .slice(0, context.competitor_count);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Không thể lấy top sản phẩm từ Helium 10.");
        }
      }
    }
    if (competitorAsins.length < context.competitor_count) {
      const amazonAsins = await discoverCompetitorAsins(
        context.main_keyword,
        context.marketplace,
        context.competitor_count,
      );
      const previousCount = competitorAsins.length;
      competitorAsins = [...new Set([...competitorAsins, ...amazonAsins])]
        .slice(0, context.competitor_count);
      if (competitorAsins.length > previousCount) {
        warnings.push("Một phần ASIN được lấy từ trang kết quả Amazon vì seed response của Helium 10 không trả đủ sản phẩm.");
      }
    }

    const reversePayloads: Array<{ payload: unknown[]; asin?: string }> = [];
    const compareTool = findTool(tools, ["compare_asin_keywords"]);
    const reverseTool = findTool(tools, ["get_keywords_by_asin"]);
    if (competitorAsins.length && compareTool) {
      try {
        reversePayloads.push({
          payload: await callTool(client, compareTool, { ...values, asins: competitorAsins }, signal),
        });
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Không thể so sánh keyword của các ASIN.");
      }
    }
    if (!reversePayloads.length && competitorAsins.length && reverseTool) {
      const payloads = await Promise.all(competitorAsins.map(async (asin) => {
        try {
          return {
            asin,
            payload: await callTool(client, reverseTool, { ...values, asins: [asin] }, signal),
          };
        } catch (error) {
          warnings.push(`${asin}: ${error instanceof Error ? error.message : "không lấy được keyword"}`);
          return null;
        }
      }));
      for (const payload of payloads) if (payload) reversePayloads.push(payload);
    }
    const reverseTerms = reversePayloads.flatMap(({ payload, asin }) => extractKeywordMetrics(payload, asin));
    const seedTerms = extractKeywordMetrics(seedPayload);
    const rawTerms = reverseTerms.length ? reverseTerms : seedTerms;
    if (!competitorAsins.length) warnings.push("Không tìm thấy ASIN đối thủ trong kết quả Helium 10. Kết quả hiện chỉ dùng seed keyword expansion.");
    if (!reverseTerms.length) warnings.push("Không có dữ liệu reverse-ASIN; bộ keyword được lọc từ seed keyword expansion.");
    if (!rawTerms.length) throw new Error("Helium 10 không trả về keyword metrics có thể đọc được.");
    return createKeywordResearchSnapshot({
      context,
      rawTerms,
      competitorAsins,
      source: "helium10",
      warnings,
    });
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

export function researchHelium10Keywords(context: KeywordResearchContext, signal?: AbortSignal) {
  const cacheKey = [
    context.marketplace,
    normalizeKeyword(context.main_keyword),
    normalizeKeyword(context.product_type),
    normalizeKeyword(context.target_customer),
    context.occasion.map(normalizeKeyword).sort().join(","),
    normalizeKeyword(Object.values(context.product_information).flat().join(" ")),
    helium10MockEnabled() ? "mock" : "live",
  ].join(":");
  const cached = researchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) researchCache.delete(cacheKey);
  const promise = fetchHelium10Research(context, signal).catch((error) => {
    researchCache.delete(cacheKey);
    throw error;
  });
  researchCache.set(cacheKey, {
    expiresAt: Date.now() + configuredNumber("HELIUM10_CACHE_TTL_MS", 21_600_000, 60_000, 86_400_000),
    promise,
  });
  return promise;
}

export async function enrichListingKeywordResearch(input: ListingInput, signal?: AbortSignal) {
  const existing = input.research.keyword_research;
  if (
    existing &&
    existing.seed_keyword === normalizeKeyword(input.main_keyword) &&
    existing.marketplace === input.marketplace
  ) return input;
  const configured = helium10MockEnabled() || Boolean(process.env.HELIUM10_MCP_ACCESS_TOKEN?.trim());
  if (!configured) return input;
  const profile = getRuleProfile(input);
  const marketplace = getMarketplaceRules(input);
  try {
    const research = await researchHelium10Keywords({
      marketplace: input.marketplace,
      main_keyword: input.main_keyword,
      product_type: input.product_type,
      brand: input.brand,
      product_information: input.product_information,
      target_customer: input.research.target_customer,
      occasion: input.research.occasion,
      stop_words: marketplace.stop_words,
      prohibited_words: profile.search.prohibited_words,
      role_words: profile.competitor.role_words,
      occasion_words: profile.competitor.occasions,
      competitor_count: profile.search.competitor_count,
      minimum_attribute_search_volume: profile.search.minimum_attribute_search_volume,
      maximum_generic_keywords: profile.search.maximum_generic_keywords,
      minimum_relevance_score: profile.search.minimum_relevance_score,
    }, signal);
    const discoveredAsins = research.source === "helium10" ? research.competitor_asins : [];
    return {
      ...input,
      related_keywords: [...new Set([
        ...input.related_keywords,
        ...research.generic_keywords
          .filter((keyword) => normalizeKeyword(keyword) !== normalizeKeyword(input.main_keyword))
          .map(titleCaseKeyword),
      ])].slice(0, 50),
      backend_keywords: [...new Set([...research.search_terms.split(" "), ...input.backend_keywords])].slice(0, 50),
      research: {
        ...input.research,
        competitor_asins: [...new Set([...discoveredAsins, ...input.research.competitor_asins])].slice(0, 5),
        keyword_research: research,
      },
    };
  } catch (error) {
    if (process.env.HELIUM10_REQUIRED === "true") throw error;
    return input;
  }
}
