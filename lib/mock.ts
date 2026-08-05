import type { ListingContent, ListingInput, ProductBrief } from "@/lib/types";

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
    competitor_insights: [],
    listing_angle: `A fact-led ${product} listing centered on ${input.main_keyword}.`,
    facts_to_avoid: excludedFacts,
    policy_risks: [],
  };
}

export function createMockListing(input: ListingInput): ListingContent {
  const info = input.product_information;
  const feature = info.features[0] || input.research.usp || "Made for everyday use";
  const audience = input.research.target_customer || "friends, family, and coworkers";
  const occasion = input.research.occasion[0] || "birthdays and everyday gifting";
  const productLabel = input.product_type.toLowerCase();
  const brand = input.brand.trim();
  const brandPrefix = brand ? `${brand} ` : "";
  const details = [info.material, info.size_capacity, info.color].filter(Boolean).join(", ");
  const related = input.related_keywords.slice(0, 3);

  const bulletCandidates = [
    `${sentence(feature)} - A practical ${productLabel} created for ${audience}.`,
    details
      ? `PRODUCT DETAILS - ${details}. Review the product images for design and size information.`
      : `THOUGHTFUL DESIGN - Clear product details and a gift-ready look for everyday use.`,
    `${sentence(input.research.usp || "Original giftable style")} - An easy choice for ${occasion}.`,
    info.package_contents
      ? `WHAT IS INCLUDED - ${sentence(info.package_contents)}.`
      : `READY TO GIFT - A useful choice for celebrations, appreciation, or a personal treat.`,
    info.care_instructions
      ? `CARE INSTRUCTIONS - ${sentence(info.care_instructions)}.`
      : `EASY TO ENJOY - Please follow the care details shown in the product information.`,
    info.personalization
      ? `PERSONALIZATION - ${sentence(info.personalization)}.`
      : `VERSATILE GIFT - Suitable for home, work, and special occasions.`,
    `SHOP WITH CONFIDENCE - Check the product images and supplied details before ordering.`,
  ];

  return {
    title: `${brandPrefix}${input.main_keyword} - ${[info.material, info.size_capacity, input.research.usp]
      .filter(Boolean)
      .join(", ")} - Gift for ${audience}`.slice(0, input.configuration.title_length),
    bullet_points: bulletCandidates
      .slice(0, input.configuration.bullet_count)
      .map((bullet) => bullet.slice(0, input.configuration.bullet_length)),
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
}
