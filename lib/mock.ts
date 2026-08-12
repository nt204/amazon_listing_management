import type { ListingContent, ListingInput, ProductBrief } from "@/lib/types";
import { buildOperatorEvidenceItems } from "@/lib/evidence";
import { cleanGeneratedTitle, trimAtWordBoundary } from "@/lib/listing-sanitizer";
import { getPolicy } from "@/lib/policies";
import { optimizeBackendSearchTerms } from "@/lib/search-terms";
import { buildTitleBlueprint } from "@/lib/title-strategy";

const sentence = (value: string) => value.trim().replace(/[.!?]+$/, "");

export function createMockProductBrief(input: ListingInput): ProductBrief {
  const info = input.product_information;
  const noteFacts = input.research.notes
    .split("\n")
    .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
    .filter(Boolean);
  const excludedFacts = noteFacts.filter((fact) => /^(do not|don't|never|avoid)/i.test(fact));
  const structuredFacts = [
    info.material ? `Material: ${info.material}` : "",
    info.size_capacity ? `Size or capacity: ${info.size_capacity}` : "",
    info.color ? `Color: ${info.color}` : "",
    info.care_instructions ? `Care: ${info.care_instructions}` : "",
    ...info.features,
  ].filter(Boolean);
  const product = input.product_type.toLowerCase();
  return {
    visual_facts: ["Mock mode does not inspect image content."],
    exact_text: [],
    selected_ocr_line_ids: [],
    ocr_selection_complete: false,
    image_facts: [],
    evidence_items: buildOperatorEvidenceItems(input),
    colors: info.color ? [info.color] : [],
    styles: [],
    subjects: [],
    supplied_facts: [...structuredFacts, ...noteFacts.filter((fact) => !excludedFacts.includes(fact))],
    inferred_audiences: input.research.target_customer
      ? [input.research.target_customer]
      : [`${input.main_keyword} shoppers`],
    inferred_occasions: input.research.occasion,
    related_keywords: [
      `${input.main_keyword} gift`,
      `${product} gift`,
      `${input.main_keyword} for adults`,
      `unique ${product}`,
      `${product} for everyday use`,
    ],
    backend_keywords: [
      `${input.main_keyword} alternative`,
      `${product} keepsake`,
      `${product} present`,
      `${product} accessory`,
      `${product} idea`,
      `${product} style`,
      `${product} collection`,
      `${product} decor`,
    ],
    competitor_insights: [],
    listing_angle: `A fact-led ${product} listing centered on ${input.main_keyword}.`,
    facts_to_avoid: excludedFacts,
    policy_risks: [],
  };
}

export function createMockListing(input: ListingInput): ListingContent {
  const policy = getPolicy(input);
  const titleBlueprint = buildTitleBlueprint(input);
  const info = input.product_information;
  const feature = info.features[0] || input.research.usp || "Made for everyday use";
  const audience = input.research.target_customer || "friends, family, and coworkers";
  const occasion = input.research.occasion[0] || "birthdays and everyday gifting";
  const productLabel = input.product_type.toLowerCase();
  const brand = input.brand.trim();
  const details = [info.material, info.size_capacity, info.color].filter(Boolean).join(", ");
  const related = input.related_keywords.slice(0, 3);
  const designTheme = titleBlueprint.designThemeCandidates[0] || "";
  const searchPhrase = titleBlueprint.highIntentKeywordCandidates[0]?.keyword || input.main_keyword;
  const styleUse = titleBlueprint.styleUseCandidates.find(
    (candidate) => candidate.toLocaleLowerCase() !== designTheme.toLocaleLowerCase(),
  ) || "";
  const keyFeature = titleBlueprint.keyFeatureCandidates.find((candidate) =>
    ![designTheme, styleUse].some(
      (used) => used && used.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
    ),
  ) || "";
  const validRecipient = titleBlueprint.recipient && !/^(buyers?|shoppers?|customers?|recipients?)$/i.test(titleBlueprint.recipient.trim())
    ? `for ${titleBlueprint.recipient}`
    : "";
  const titleCandidate = [
    [titleBlueprint.brand, input.product_type].filter(Boolean).join(" "),
    [designTheme, searchPhrase, validRecipient]
      .filter(Boolean)
      .join(" "),
    [styleUse, keyFeature].filter(Boolean).join(" "),
    titleBlueprint.size,
  ].filter(Boolean).join(", ");

  const bulletCandidates = [
    `PRACTICAL EVERYDAY BENEFIT: The supported feature (${sentence(feature)}) makes this ${productLabel} a useful choice for ${audience}.`,
    details
      ? `DISTINCTIVE PRODUCT DESIGN: ${sentence(input.research.usp || feature)}, together with verified details such as ${details}, helps shoppers picture this ${productLabel}.`
      : `DISTINCTIVE PRODUCT DESIGN: ${sentence(input.research.usp || feature)} gives shoppers a clear reason to consider this ${productLabel} for ${audience}.`,
    details
      ? `VERIFIED DETAILS FOR EASY CHOOSING: Specifications include ${details}, helping shoppers compare the product and choose the right option before ordering.`
      : `VERIFIED DETAILS FOR EASY CHOOSING: Supplied product facts help shoppers understand this ${productLabel} and choose the right option before ordering.`,
    info.care_instructions
      ? `EASY TO CARE FOR: ${sentence(info.care_instructions)}, providing a clear care routine for keeping this ${productLabel} ready for regular use.`
      : info.package_contents
        ? `READY FOR THE INTENDED USE: The package includes ${sentence(info.package_contents)}, helping shoppers understand what arrives before placing an order.`
        : `EASY TO PLAN FOR: Supplied product facts help shoppers understand how this ${productLabel} fits the intended setting before placing an order.`,
    `THOUGHTFUL GIFT IDEA: Created for ${audience}, this ${productLabel} makes a thoughtful choice for ${occasion}, celebrations, or everyday appreciation.`,
  ];

  const listing: ListingContent = {
    title: trimAtWordBoundary(cleanGeneratedTitle(titleCandidate), policy.titleMax),
    bullet_points: bulletCandidates
      .slice(0, input.configuration.bullet_count)
      .map((bullet) => bullet.slice(0, policy.bulletMax)),
    description: input.configuration.generate_description
      ? `Make gifting simple with this ${input.main_keyword}${brand ? ` from ${brand}` : ""}. ${sentence(feature)}. ${
          details ? `Product details include ${details}. ` : ""
        }Designed with ${audience} in mind, it is a thoughtful option for ${occasion}. ${
          info.care_instructions ? `Care: ${sentence(info.care_instructions)}.` : ""
        }`
      : "",
    backend_search_terms: input.configuration.generate_search_terms
      ? [...related, ...input.backend_keywords]
          .join(" ")
          .toLowerCase()
          .replace(/[^a-z0-9äöüß\s-]/gi, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 249)
      : "",
  };
  return {
    ...listing,
    backend_search_terms: optimizeBackendSearchTerms({
      listing,
      input,
      currentValue: listing.backend_search_terms,
      maxBytes: policy.searchTermsMaxBytes,
    }),
  };
}
