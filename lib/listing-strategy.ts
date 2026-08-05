import type { ListingInput, ListingStrategy, ProductBrief } from "@/lib/types";

const giftWords = /\b(gifts?|presents?|gifting|birthday|christmas|anniversary|graduation|retirement|appreciation|valentine|father'?s day|mother'?s day)\b/i;
const roleWords = new Set([
  "dad", "dads", "father", "fathers", "daddy", "mom", "moms", "mother", "mothers",
  "mama", "man", "men", "woman", "women", "husband", "wife", "boyfriend", "girlfriend",
  "grandpa", "grandfather", "grandma", "grandmother", "son", "daughter", "brother", "sister",
  "uncle", "aunt", "friend", "coworker", "colleague", "owner", "owners", "lover", "lovers",
  "parent", "parents", "nurse", "nurses", "teacher", "teachers", "student", "students",
  "coach", "coaches", "boss", "employee", "employees", "kid", "kids", "boy", "boys", "girl",
  "girls", "baby", "babies", "couple", "partner", "partners",
]);
const productWords = new Set([
  "mug", "mugs", "cup", "cups", "tumbler", "tumblers", "shirt", "shirts", "tshirt", "tee",
  "hoodie", "hoodies", "sweatshirt", "blanket", "blankets", "ornament", "ornaments", "candle",
  "candles", "poster", "posters", "print", "prints", "plaque", "plaques", "keychain", "keychains",
  "necklace", "necklaces", "bracelet", "bracelets", "tote", "totes", "bag", "bags", "pillow",
  "pillows", "notebook", "notebooks", "journal", "journals", "card", "cards", "sign", "signs",
  "glass", "glasses", "bottle", "bottles", "drinkware", "coffee", "tea",
]);
const audienceNoise = new Set([
  "best", "ever", "fun", "funny", "cute", "novelty", "unique", "retro", "personalized", "custom",
  "gift", "gifts", "present", "presents", "for", "with", "and", "the", "a", "an", "of",
]);
const giftableProducts = new Set([
  ...productWords,
  "jewelry", "apparel", "decor", "keepsake", "accessory", "accessories",
]);
const searchAlternates: Record<string, string[]> = {
  cat: ["feline", "kitty"],
  dog: ["canine", "puppy"],
  dad: ["father", "daddy", "papa"],
  father: ["dad", "daddy", "papa"],
  mom: ["mother", "mama"],
  mother: ["mom", "mama"],
  mug: ["cup", "drinkware"],
  cup: ["mug", "drinkware"],
  tumbler: ["travel cup", "drinkware"],
  lover: ["enthusiast", "fan"],
  lovers: ["enthusiast", "fan"],
  owner: ["parent"],
  pet: ["animal", "companion"],
  husband: ["spouse", "hubby"],
  wife: ["spouse"],
  boyfriend: ["partner"],
  girlfriend: ["partner"],
  grandfather: ["grandpa", "granddad"],
  grandmother: ["grandma", "grandmom"],
  friend: ["buddy"],
  coworker: ["colleague", "workmate"],
  son: ["kids", "children"],
  daughter: ["kids", "children"],
  birthday: ["bday"],
  christmas: ["xmas"],
  nurse: ["rn", "healthcare worker", "caregiver"],
  teacher: ["educator", "instructor"],
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/t[ -]?shirts?/g, "tshirt")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), value.trim()])).values()];
}

function alternateVocabulary(values: string[]) {
  return unique(
    values.flatMap((value) => words(value).flatMap((word) => searchAlternates[word] || [])),
  );
}

function audiencePhrase(value: string) {
  const normalized = normalize(value);
  const afterFor = normalized.match(/\bfor\s+(.+)$/)?.[1] || normalized;
  const kept = words(afterFor).filter(
    (word) => !productWords.has(word) && !audienceNoise.has(word),
  );
  if (!kept.some((word) => roleWords.has(word))) return "";
  return kept.slice(0, 5).join(" ");
}

function deriveCoreAudienceTerms(input: ListingInput, brief?: ProductBrief) {
  const profile = input.research.competitor_profile;
  const candidates = [
    input.main_keyword,
    ...input.related_keywords,
    ...(profile?.audiences || []).map((item) => item.value),
    ...(profile?.keyword_candidates || []).map((item) => item.value),
    ...(brief?.inferred_audiences || []),
    ...(brief?.related_keywords || []),
  ];
  return unique(candidates.map(audiencePhrase)).slice(0, 12);
}

function deriveBuyerTerms(input: ListingInput) {
  const supplied = input.research.target_customer.trim();
  if (!supplied) return [];
  const phrases = supplied
    .split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)
    .map(audiencePhrase)
    .filter(Boolean);
  return unique(phrases).slice(0, 8);
}

function recipientExpansion(audiences: string[]) {
  const text = normalize(audiences.join(" "));
  const masculine = /\b(dad|dads|father|fathers|daddy|man|men|husband|boyfriend|grandpa|grandfather|son|brother|uncle|him)\b/.test(text);
  const feminine = /\b(mom|moms|mother|mothers|mama|woman|women|wife|girlfriend|grandma|grandmother|daughter|sister|aunt|her)\b/.test(text);
  const recipients: string[] = [];
  if (masculine) recipients.push("men", "husband", "boyfriend", "father", "grandfather");
  if (feminine) recipients.push("women", "wife", "girlfriend", "mother", "grandmother");
  recipients.push("friend", "coworker");
  return unique(recipients);
}

function withoutBuyerRoles(value: string, buyers: string[]) {
  const buyerWords = new Set(buyers.flatMap(words));
  return words(value).filter((word) => !buyerWords.has(word)).join(" ");
}

function isBuyerOnlyAudience(value: string, buyers: string[]) {
  const buyerWords = new Set(buyers.flatMap(words));
  const roles = words(value).filter((word) => roleWords.has(word));
  return roles.length > 0 && roles.every((role) => buyerWords.has(role));
}

function occasionExpansion(input: ListingInput, audiences: string[], brief?: ProductBrief) {
  const profile = input.research.competitor_profile;
  const explicit = unique([
    ...input.research.occasion,
    ...(profile?.occasions || []).map((item) => item.value),
    ...(brief?.inferred_occasions || []),
  ]);
  const audienceText = normalize(audiences.join(" "));
  const expanded = [...explicit, "Birthday", "Christmas"];
  if (/\b(dad|dads|father|fathers|daddy|grandpa|grandfather)\b/.test(audienceText)) {
    expanded.push("Father's Day");
  }
  if (/\b(mom|moms|mother|mothers|mama|grandma|grandmother)\b/.test(audienceText)) {
    expanded.push("Mother's Day");
  }
  if (/\b(husband|wife|boyfriend|girlfriend|couple|partner)\b/.test(audienceText)) {
    expanded.push("Anniversary");
  }
  return unique(expanded).slice(0, 10);
}

function hasGiftableProduct(input: ListingInput) {
  return words(`${input.product_type} ${input.main_keyword}`).some((word) => giftableProducts.has(word));
}

export function buildListingStrategy(input: ListingInput, brief?: ProductBrief): ListingStrategy {
  const profile = input.research.competitor_profile;
  const buyers = deriveBuyerTerms(input);
  const audiences = deriveCoreAudienceTerms(input, brief)
    .filter((audience) => !isBuyerOnlyAudience(audience, buyers));
  const recipientSignals = audiences
    .map((audience) => withoutBuyerRoles(audience, buyers))
    .filter(Boolean);
  const sourceText = [
    input.main_keyword,
    ...input.related_keywords,
    ...input.backend_keywords,
    input.research.target_customer,
    ...input.research.occasion,
    input.research.customer_insight,
    ...(profile?.references || []).map((item) => item.title || ""),
    ...(profile?.keyword_candidates || []).map((item) => item.value),
    ...(profile?.occasions || []).map((item) => item.value),
    ...(brief?.related_keywords || []),
    ...(brief?.inferred_occasions || []),
  ].join(" ");
  const explicitOccasionCount = unique([
    ...input.research.occasion,
    ...(profile?.occasions || []).map((item) => item.value),
    ...(brief?.inferred_occasions || []),
  ]).length;
  let giftScore = giftWords.test(sourceText) ? 3 : 0;
  if (explicitOccasionCount) giftScore += Math.min(explicitOccasionCount, 2);
  if (audiences.length && hasGiftableProduct(input)) giftScore += 1;
  const mode = giftScore >= 4 ? "gift-led" : giftScore >= 2 ? "hybrid" : "function-led";
  const recipients = mode === "function-led" ? [] : recipientExpansion(recipientSignals);
  const occasions = mode === "function-led" ? unique(input.research.occasion) : occasionExpansion(input, audiences, brief);
  const usableCompetitorKeywords = (profile?.keyword_candidates || [])
    .filter((item) => item.usable_for_listing)
    .map((item) => item.value);
  const priorityKeywords = unique([
    input.main_keyword,
    ...input.related_keywords,
    ...usableCompetitorKeywords,
    ...(brief?.related_keywords || []),
  ]).slice(0, 20);
  const backendAlternates = alternateVocabulary([
    input.main_keyword,
    ...input.related_keywords,
    ...audiences,
    ...recipients,
    ...buyers,
    ...occasions,
    ...(brief?.related_keywords || []),
  ]);
  const visualTerms = unique([
    ...(brief?.colors || []),
    ...(brief?.styles || []),
    ...(brief?.subjects || []),
    "illustration",
    "artwork",
    "graphic",
    "typography",
  ]);
  const giftLed = mode === "gift-led";
  const marketingPercent = giftLed ? 70 : mode === "hybrid" ? 50 : 30;
  const benefitAngles = giftLed
    ? [
        "celebrate the recipient's identity or relationship",
        "connect the item to a specific gifting moment",
        "show how the design adds meaning to an everyday routine",
        "help the shopper recognize who the item is for",
      ]
    : mode === "hybrid"
      ? [
          "translate each verified feature into a practical customer benefit",
          "connect the product to a relevant use case or recipient",
          "balance purchase motivation with supported product details",
        ]
      : [
          "lead with the primary customer outcome or use case",
          "translate verified specifications into practical benefits",
          "explain fit, compatibility, care, or package contents only when supplied",
        ];
  const bulletJobs = giftLed
    ? [
        "recipient identity or emotional payoff",
        "specific gifting occasions",
        "everyday-use benefit grounded in the product type",
        "relevant recipient expansion",
        "verified attribute or design value translated into a shopper benefit",
      ]
    : mode === "hybrid"
      ? [
          "primary customer benefit",
          "verified differentiator",
          "use case or routine",
          "audience or occasion relevance",
          "verified care, size, package, or design detail",
        ]
      : [
          "primary customer outcome",
          "verified differentiator",
          "verified specification and its practical meaning",
          "use case or compatibility",
          "verified care, package, or limitation",
        ];

  return {
    mode,
    marketing_percent: marketingPercent,
    product_percent: 100 - marketingPercent,
    audience_terms: audiences,
    buyer_terms: buyers,
    recipient_terms: recipients,
    occasion_terms: occasions,
    priority_keywords: priorityKeywords,
    backend_candidates: unique([
      ...input.backend_keywords,
      ...backendAlternates,
      ...recipients,
      ...buyers,
      ...occasions,
      ...audiences,
      ...usableCompetitorKeywords,
      ...(brief?.related_keywords || []),
      ...input.related_keywords,
    ]).slice(0, 40),
    benefit_angles: benefitAngles,
    bullet_jobs: bulletJobs,
    visual_terms: visualTerms,
    reasons: [
      giftWords.test(sourceText) ? "gift language found in operator or sourced search evidence" : "no explicit gift language found",
      explicitOccasionCount ? `${explicitOccasionCount} occasion signal(s) found` : "no explicit occasion signal found",
      audiences.length ? `${audiences.length} recipient signal(s) found` : "no recipient signal found",
      buyers.length ? `${buyers.length} operator buyer signal(s) found` : "no explicit buyer signal found",
      hasGiftableProduct(input) ? "product type supports gifting context" : "product type is treated as function-first",
    ],
  };
}
