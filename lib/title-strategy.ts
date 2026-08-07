import { normalizeKeyword } from "@/lib/keyword-research";
import { getPolicy } from "@/lib/policies";
import type { KeywordResearchTerm, ListingInput } from "@/lib/types";

const DAY_MS = 86_400_000;

interface EventDefinition {
  name: string;
  aliases: string[];
  nextDate?: (year: number) => Date;
}

export interface RankedTitleKeyword {
  keyword: string;
  searchVolume: number | null;
}

export interface TitleEventCandidate extends RankedTitleKeyword {
  daysUntil: number | null;
  yearRound: boolean;
  operatorSelected: boolean;
  keywordResearchSupported: boolean;
}

export interface TitleBlueprint {
  currentDate: string;
  brand: string;
  coreKeyword1: RankedTitleKeyword;
  coreKeyword2: RankedTitleKeyword | null;
  events: TitleEventCandidate[];
  recipientSeed: string;
  giverSeed: string;
  audienceKeywords: RankedTitleKeyword[];
  productName: string;
  productAdvantages: string[];
  maxCharacters: number;
  idealMinimumCharacters: number;
  idealMaximumCharacters: number;
  primaryKeywordWindow: number;
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (occurrence - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = utcDate(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utcDate(year, month, last.getUTCDate() - offset);
}

const eventDefinitions: EventDefinition[] = [
  { name: "New Year", aliases: ["new year", "new year's day"], nextDate: (year) => utcDate(year, 1, 1) },
  { name: "Valentine's Day", aliases: ["valentine's day", "valentines day", "valentine"], nextDate: (year) => utcDate(year, 2, 14) },
  { name: "Nurse Week", aliases: ["nurse week", "nurses week"], nextDate: (year) => utcDate(year, 5, 6) },
  { name: "Mother's Day", aliases: ["mother's day", "mothers day"], nextDate: (year) => nthWeekday(year, 5, 0, 2) },
  { name: "Graduation", aliases: ["graduation", "graduate"], nextDate: (year) => utcDate(year, 5, 15) },
  { name: "Memorial Day", aliases: ["memorial day"], nextDate: (year) => lastWeekday(year, 5, 1) },
  { name: "Father's Day", aliases: ["father's day", "fathers day"], nextDate: (year) => nthWeekday(year, 6, 0, 3) },
  { name: "Independence Day", aliases: ["independence day", "fourth of july", "4th of july", "july 4th"], nextDate: (year) => utcDate(year, 7, 4) },
  { name: "Homecoming", aliases: ["homecoming"], nextDate: (year) => utcDate(year, 9, 15) },
  { name: "Halloween", aliases: ["halloween"], nextDate: (year) => utcDate(year, 10, 31) },
  { name: "Veterans Day", aliases: ["veterans day", "veteran's day"], nextDate: (year) => utcDate(year, 11, 11) },
  { name: "Thanksgiving", aliases: ["thanksgiving"], nextDate: (year) => nthWeekday(year, 11, 4, 4) },
  { name: "Christmas", aliases: ["christmas", "xmas"], nextDate: (year) => utcDate(year, 12, 25) },
  { name: "Birthday", aliases: ["birthday", "birthdays"] },
  { name: "Anniversary", aliases: ["anniversary", "anniversaries"] },
  { name: "Retirement", aliases: ["retirement", "retiree"] },
];

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedDay(value: Date) {
  return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function nextEventDate(definition: EventDefinition, now: Date) {
  if (!definition.nextDate) return null;
  const today = normalizedDay(now);
  let eventDate = definition.nextDate(today.getUTCFullYear());
  if (eventDate < today) eventDate = definition.nextDate(today.getUTCFullYear() + 1);
  return eventDate;
}

function eventForKeyword(keyword: string) {
  const normalized = ` ${normalizeKeyword(keyword)} `;
  return eventDefinitions.find((definition) =>
    definition.aliases.some((alias) => normalized.includes(` ${normalizeKeyword(alias)} `)),
  );
}

function metricForKeyword(terms: KeywordResearchTerm[], keyword: string) {
  const normalized = normalizeKeyword(keyword);
  return terms.find((term) => normalizeKeyword(term.keyword) === normalized)?.search_volume ?? null;
}

function rankedTerms(terms: KeywordResearchTerm[], categories: KeywordResearchTerm["category"][]) {
  return terms
    .filter((term) => term.selected && categories.includes(term.category))
    .sort((left, right) =>
      (right.search_volume || 0) - (left.search_volume || 0) ||
      right.relevance_score - left.relevance_score ||
      right.opportunity_score - left.opportunity_score,
    );
}

function selectCoreKeyword2(input: ListingInput, terms: KeywordResearchTerm[]) {
  const firstRelatedKeyword = input.related_keywords[0]?.trim();
  return firstRelatedKeyword
    ? {
        keyword: firstRelatedKeyword,
        searchVolume: metricForKeyword(terms, firstRelatedKeyword),
      }
    : null;
}

function buildEventCandidates(input: ListingInput, terms: KeywordResearchTerm[], now: Date) {
  const eventTerms = rankedTerms(terms, ["occasion"]);
  const measuredVolume = new Map<string, number>();
  for (const term of eventTerms) {
    const definition = eventForKeyword(term.keyword);
    if (!definition || term.search_volume === null) continue;
    measuredVolume.set(
      definition.name,
      Math.max(measuredVolume.get(definition.name) || 0, term.search_volume),
    );
  }
  const explicitlyRequested = new Set(
    input.research.occasion
      .map(eventForKeyword)
      .filter((definition): definition is EventDefinition => Boolean(definition))
      .map((definition) => definition.name),
  );
  return eventDefinitions
    .map((definition): TitleEventCandidate | null => {
      const eventDate = nextEventDate(definition, now);
      const daysUntil = eventDate
        ? Math.max(0, Math.round((eventDate.getTime() - normalizedDay(now).getTime()) / DAY_MS))
        : null;
      return {
        keyword: definition.name,
        searchVolume: measuredVolume.get(definition.name) ?? null,
        daysUntil,
        yearRound: daysUntil === null,
        operatorSelected: explicitlyRequested.has(definition.name),
        keywordResearchSupported: measuredVolume.has(definition.name),
      };
    })
    .filter((event): event is TitleEventCandidate => Boolean(event))
    .sort((left, right) => {
      return (
        Number(right.operatorSelected) - Number(left.operatorSelected) ||
        Number(right.keywordResearchSupported) - Number(left.keywordResearchSupported) ||
        (right.searchVolume || 0) - (left.searchVolume || 0) ||
        left.keyword.localeCompare(right.keyword)
      );
    });
}

export function buildTitleBlueprint(input: ListingInput, now = new Date()): TitleBlueprint {
  const policy = getPolicy(input);
  const research = input.research.keyword_research;
  const terms = research?.terms || [];
  const coreKeyword1 = normalizeKeyword(input.main_keyword);
  const audienceKeywords = rankedTerms(terms, ["audience"])
    .slice(0, 10)
    .map((term) => ({ keyword: term.keyword, searchVolume: term.search_volume }));
  return {
    currentDate: normalizedDay(now).toISOString().slice(0, 10),
    brand: input.brand.trim(),
    coreKeyword1: {
      keyword: coreKeyword1,
      searchVolume: metricForKeyword(terms, coreKeyword1),
    },
    coreKeyword2: selectCoreKeyword2(input, terms),
    events: buildEventCandidates(input, terms, now),
    recipientSeed: input.research.target_customer.trim(),
    giverSeed: input.research.gift_giver?.trim() || "",
    audienceKeywords,
    productName: input.product_type.trim(),
    productAdvantages: unique([
      input.research.usp,
      ...input.product_information.features,
      input.product_information.material,
      input.product_information.size_capacity,
    ]).slice(0, 6),
    maxCharacters: policy.titleMax,
    idealMinimumCharacters: policy.titleTargetMin,
    idealMaximumCharacters: policy.titleTargetMax,
    primaryKeywordWindow: policy.titlePrimaryWindow,
  };
}
