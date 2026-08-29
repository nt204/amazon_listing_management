import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanGeneratedTitle } from "../lib/listing-sanitizer";
import {
  buildTrelloAiProductInformation,
  extractTrelloBoardId,
  filterPublicTrelloImageAttachments,
  formatRawTrelloKeywords,
  listingMockupIndexFromAttachmentName,
  parseTrelloCardTitle,
  parseTrelloListingDescription,
  prioritizeTrelloCoverAttachment,
  selectMissingTrelloImageDerivatives,
  selectTrelloImageAttachments,
  selectTrelloListingImageAttachments,
  selectLatestTrelloWorkbookAttachment,
  withStoredTrelloImagePreviews,
  type TrelloAttachment,
} from "../lib/trello";

test("parseTrelloCardTitle parses card title with underscore", () => {
  const result = parseTrelloCardTitle("3CVT0708COW01_Cowgirl 3D Card");
  assert.equal(result.sku, "3CVT0708COW01");
  assert.equal(result.itemName, "Cowgirl 3D Card");
});

test("parseTrelloCardTitle parses card title with dash", () => {
  const result = parseTrelloCardTitle("SKU12345 - Awesome Birthday Mug");
  assert.equal(result.sku, "SKU12345");
  assert.equal(result.itemName, "Awesome Birthday Mug");
});

test("parseTrelloCardTitle fallback when no delimiter", () => {
  const result = parseTrelloCardTitle("Cowgirl 3D Card Only");
  assert.equal(result.itemName, "Cowgirl 3D Card Only");
  assert.ok(result.sku.length > 0);
});

test("extractTrelloBoardId extracts shortLink from full Trello board URL", () => {
  assert.equal(extractTrelloBoardId("https://trello.com/b/UaCRcUxZ/test-project"), "UaCRcUxZ");
  assert.equal(extractTrelloBoardId("https://trello.com/b/UaCRcUxZ"), "UaCRcUxZ");
  assert.equal(extractTrelloBoardId("https://trello.com/b/UaCRcUxZ/"), "UaCRcUxZ");
  assert.equal(extractTrelloBoardId("UaCRcUxZ"), "UaCRcUxZ");
  assert.equal(extractTrelloBoardId("hcmdsBOh"), "hcmdsBOh");
});

test("cleanGeneratedTitle removes generic for Gift Buyers filler", () => {
  const dirty = "Limima Hanging Ornament, Glass Ornament Cowgirl 3D for Gift Buyers, Detailed 3D Pop-Up Design Craftsmanship, Standard 1 Card";
  const cleaned = cleanGeneratedTitle(dirty);
  assert.equal(cleaned, "Limima Hanging Ornament, Glass Ornament Cowgirl 3D, Detailed 3D Pop-Up Design Craftsmanship, Standard 1 Card");
});

test("formatRawTrelloKeywords only lowercases phrases and uses semicolon separators", () => {
  const rawDesc = "Generic keywords: Cowgirl Pop Up Card, Father's Day Gift, Cowgirl Pop Up Card";
  const formatted = formatRawTrelloKeywords(rawDesc);
  assert.equal(formatted, "cowgirl pop up card; father's day gift; cowgirl pop up card;");
});

test("listing description supplies English material, dimensions, and generic keyword phrases", () => {
  const parsed = parseTrelloListingDescription([
    "Material: Natural birch wood; Finish: matte",
    'Dimensions: 3.5" x 3.2" x 0.15"',
    "Generic Keywords: monster truck ornament, personalized truck gift",
    "boys holiday decor",
    "Color: Orange",
  ].join("\n"));

  assert.equal(parsed.material, "Natural birch wood");
  assert.equal(parsed.sizeCapacity, '3.5" x 3.2" x 0.15"');
  assert.deepEqual(parsed.genericKeywords, [
    "monster truck ornament",
    "personalized truck gift",
    "boys holiday decor",
  ]);
  assert.equal(
    parsed.formattedGenericKeywords,
    "monster truck ornament; personalized truck gift; boys holiday decor;",
  );
});

test("listing description supports Vietnamese material and size labels without template defaults", () => {
  const parsed = parseTrelloListingDescription([
    "Chất liệu: Kính",
    "Kích thước: 24cm x 20cm",
    "Generic keywords: cat mouse pad; funny orange cat gift",
  ].join("\n"));

  assert.equal(parsed.material, "Kính");
  assert.equal(parsed.sizeCapacity, "24cm x 20cm");
  assert.deepEqual(parsed.genericKeywords, [
    "cat mouse pad",
    "funny orange cat gift",
  ]);

  const missing = parseTrelloListingDescription("Kích thước: 4 x 4 inches");
  assert.equal(missing.material, "");
});

test("generic keywords stop before bullet-prefixed Trello description labels", () => {
  const parsed = parseTrelloListingDescription([
    "• Generic keywords: Paris Glass Ornament, Paris souvenir gift",
    "• Tên chiến dịch / sản phẩm: Glass Ornament Paris France",
    "• Niche (thị trường ngách): Paris France",
    "• Đối tượng khách hàng: Paris France",
    "• Top KW ranking:",
  ].join("\n"));

  assert.deepEqual(parsed.genericKeywords, [
    "Paris Glass Ornament",
    "Paris souvenir gift",
  ]);
  assert.equal(
    parsed.formattedGenericKeywords,
    "paris glass ornament; paris souvenir gift;",
  );
});

test("generic keyword phrases from a Trello description keep duplicate phrases", () => {
  const parsed = parseTrelloListingDescription(
    "Generic keywords: Cat Lover Gift, CAT LOVER GIFT; Cat Decor",
  );

  assert.deepEqual(parsed.genericKeywords, [
    "Cat Lover Gift",
    "CAT LOVER GIFT",
    "Cat Decor",
  ]);
  assert.equal(
    parsed.formattedGenericKeywords,
    "cat lover gift; cat lover gift; cat decor;",
  );
});

test("generic keywords support alternate English and Vietnamese labels", () => {
  const cases = [
    ["Generic Keywords = Cat Gift, CAT GIFT", "cat gift; cat gift;"],
    ["Search terms - Cat Lover Gift | Pet Decor", "cat lover gift; pet decor;"],
    ["Từ khóa: Quà Tặng Mèo; Trang Trí Thú Cưng", "quà tặng mèo; trang trí thú cưng;"],
    ["Từ khoá = Quà Tặng Chó", "quà tặng chó;"],
    ["Tu khoa tim kiem: Cat Dad Mug", "cat dad mug;"],
  ] as const;

  for (const [description, expected] of cases) {
    assert.equal(
      parseTrelloListingDescription(description).formattedGenericKeywords,
      expected,
    );
  }
});

test("generic keywords stop before prose that is not keyword-like", () => {
  const parsed = parseTrelloListingDescription([
    "Generic keywords: cat gift, pet decor",
    "This product description continues on the next line.",
  ].join("\n"));

  assert.equal(parsed.formattedGenericKeywords, "cat gift; pet decor;");
});

test("generic keywords preserve phrase text and punctuation while lowercasing", () => {
  const parsed = parseTrelloListingDescription(
    "Generic keywords: Pizza for You, Love Pizza; With Cheese! TRI, 3x12",
  );

  assert.equal(
    parsed.formattedGenericKeywords,
    "pizza for you; love pizza; with cheese! tri; 3x12;",
  );
});

test("material supports Trello bullets and common material labels", () => {
  const cases = [
    ["• Chất liệu: Kính", "Kính"],
    ["- Vật liệu = Acrylic", "Acrylic"],
    ["Material Type - Ceramic", "Ceramic"],
    ["Made of natural birch wood", "natural birch wood"],
    ["Made from: stainless steel", "stainless steel"],
    ["Thành phần chất liệu: 100% cotton", "100% cotton"],
  ] as const;

  for (const [description, expected] of cases) {
    assert.equal(parseTrelloListingDescription(description).material, expected);
  }
});

test("Trello AI product facts never inherit Amazon template metadata", () => {
  const description = parseTrelloListingDescription([
    "Chất liệu: Kính",
    'Kích thước: 3.1" x 3.1" x 0.15"',
    "Color: Blue",
    "Package contents: Ribbon",
  ].join("\n"));

  assert.deepEqual(buildTrelloAiProductInformation(description), {
    material: "Kính",
    size_capacity: '3.1" x 3.1" x 0.15"',
    color: "",
    package_contents: "",
    features: [],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  });
});

const attachment = (overrides: Partial<TrelloAttachment>): TrelloAttachment => ({
  id: "attachment-1",
  name: "mockup.jpg",
  url: "https://trello.com/1/cards/card-current/attachments/attachment-1/download/mockup.jpg",
  mimeType: "image/jpeg",
  bytes: 100,
  isUpload: true,
  ...overrides,
});

test("selectTrelloImageAttachments keeps only uploaded images from the current card", () => {
  const current = attachment({});
  const linkedOldProduct = attachment({
    id: "attachment-old",
    url: "https://trello.com/1/cards/card-old/attachments/attachment-old/download/old.png",
    isUpload: false,
  });
  const spreadsheet = attachment({
    name: "listing.xlsx",
    mimeType: "application/vnd.ms-excel",
    url: "https://trello.com/listing.xlsx",
  });

  assert.deepEqual(
    selectTrelloImageAttachments({ id: "card-current", attachments: [linkedOldProduct, spreadsheet, current] }),
    [current],
  );
});

test("listing images contain one main image and at most six numbered mockups", () => {
  const main = attachment({ id: "main", name: "Full Design.png" });
  const unrelated = attachment({ id: "reference", name: "Reference photo.jpg" });
  const mockups = Array.from({ length: 8 }, (_, offset) => {
    const index = offset + 2;
    return attachment({
      id: `mockup-${index}`,
      name: `Mockup${index}_Scene.jpg`,
      date: `2026-08-${String(index).padStart(2, "0")}T12:00:00.000Z`,
    });
  });
  const oldMockup2 = attachment({
    id: "old-mockup-2",
    name: "Mockup2_Old.jpg",
    date: "2026-07-02T12:00:00.000Z",
  });

  assert.deepEqual(
    selectTrelloListingImageAttachments({
      id: "card-current",
      attachments: [mockups[5], unrelated, oldMockup2, mockups[0], main, ...mockups.slice(1, 5), ...mockups.slice(6)],
    }).map((item) => item.id),
    ["main", "mockup-2", "mockup-3", "mockup-4", "mockup-5", "mockup-6", "mockup-7"],
  );
});

test("listing workbook mockups accept only MK or Mockup filename prefixes", () => {
  const cover = attachment({ id: "cover", name: "Product Hero.png" });
  const mk1 = attachment({ id: "mk-1", name: "MK1_Lifestyle.png" });
  const mockup2 = attachment({ id: "mockup-2", name: "Mockup2_Dimensions.png" });
  const unrelated = attachment({ id: "unrelated", name: "Reference 3.png" });
  const embeddedMk = attachment({ id: "embedded-mk", name: "SKU_MK3.png" });

  assert.equal(listingMockupIndexFromAttachmentName(mk1.name), 1);
  assert.equal(listingMockupIndexFromAttachmentName(mockup2.name), 2);
  assert.equal(listingMockupIndexFromAttachmentName("mk6.jpg"), 6);
  assert.equal(listingMockupIndexFromAttachmentName(embeddedMk.name), null);
  assert.deepEqual(
    selectTrelloListingImageAttachments({
      id: "card-current",
      idAttachmentCover: cover.id,
      attachments: [unrelated, mockup2, cover, embeddedMk, mk1],
    }).map((item) => item.id),
    ["cover", "mk-1", "mockup-2"],
  );
});

test("Mockup1 becomes the main image when the source artwork is unavailable", () => {
  const mockup1 = attachment({ id: "mockup-1", name: "Mockup1_Main.jpg" });
  const mockup2 = attachment({ id: "mockup-2", name: "Mockup2_Dimensions.jpg" });

  assert.deepEqual(
    selectTrelloListingImageAttachments({
      id: "card-current",
      attachments: [mockup2, mockup1],
    }).map((item) => item.id),
    ["mockup-1", "mockup-2"],
  );
});

test("the Trello Make cover attachment takes priority over filename conventions", () => {
  const fullDesign = attachment({ id: "full-design", name: "Full Design.png" });
  const cover = attachment({ id: "chosen-cover", name: "Mockup3_Lifestyle.jpg" });
  const mockup1 = attachment({ id: "mockup-1", name: "Mockup1_Main.jpg" });
  const mockup2 = attachment({ id: "mockup-2", name: "Mockup2_Dimensions.jpg" });

  assert.deepEqual(
    selectTrelloListingImageAttachments({
      id: "card-current",
      idAttachmentCover: cover.id,
      attachments: [fullDesign, mockup1, mockup2, cover],
    }).map((item) => item.id),
    ["chosen-cover", "mockup-1", "mockup-2"],
  );
});

test("the Trello Make cover attachment is displayed first without mutating API order", () => {
  const first = attachment({ id: "first", name: "First upload.png" });
  const cover = attachment({ id: "cover", name: "Chosen cover.png" });
  const last = attachment({ id: "last", name: "Last upload.png" });
  const apiOrder = [first, cover, last];

  assert.deepEqual(
    prioritizeTrelloCoverAttachment(apiOrder, cover.id).map((item) => item.id),
    ["cover", "first", "last"],
  );
  assert.deepEqual(apiOrder.map((item) => item.id), ["first", "cover", "last"]);
});

test("an unavailable or non-image Trello cover falls back to the source artwork", () => {
  const fullDesign = attachment({ id: "full-design", name: "Full Design.png" });
  const spreadsheet = attachment({
    id: "spreadsheet-cover",
    name: "listing.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    url: "https://trello.com/listing.xlsx",
  });

  assert.deepEqual(
    selectTrelloListingImageAttachments({
      id: "card-current",
      idAttachmentCover: spreadsheet.id,
      attachments: [spreadsheet, fullDesign],
    }).map((item) => item.id),
    ["full-design"],
  );
});

test("filterPublicTrelloImageAttachments rejects missing or non-image URLs", async () => {
  const valid = attachment({ id: "valid", url: "https://example.test/valid.jpg" });
  const missing = attachment({ id: "missing", url: "https://example.test/missing.jpg" });
  const html = attachment({ id: "html", url: "https://example.test/page.jpg" });
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("missing")) return new Response("missing", { status: 404 });
    if (url.includes("page")) {
      return new Response("page", { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("image", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  assert.deepEqual(await filterPublicTrelloImageAttachments([valid, missing, html], fakeFetch), [valid]);
});

test("selectLatestTrelloWorkbookAttachment returns the newest generated Excel file", () => {
  const older = attachment({
    id: "excel-old",
    name: "listing.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    date: "2026-08-11T04:57:55.045Z",
  });
  const newest = attachment({
    id: "excel-new",
    name: "listing.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    date: "2026-08-11T06:57:24.419Z",
  });

  assert.equal(selectLatestTrelloWorkbookAttachment([older, newest]), newest);
});

test("stored Trello derivatives override display URLs without replacing the master", () => {
  const master = attachment({
    previewUrl: "https://trello.test/native-preview.jpg",
    thumbnailUrl: "https://trello.test/native-thumbnail.jpg",
  });
  const [card] = withStoredTrelloImagePreviews(
    [
      {
        id: "card-current",
        name: "SKU_Product",
        desc: "",
        idList: "list-1",
        url: "https://trello.test/card-current",
        badges: { attachments: 1 },
        attachments: [master],
      },
    ],
    [
      {
        cardId: "card-current",
        attachmentId: master.id,
        variant: "preview",
        sha256: "a".repeat(64),
      },
      {
        cardId: "card-current",
        attachmentId: master.id,
        variant: "thumbnail",
        sha256: "b".repeat(64),
      },
    ],
  );

  assert.equal(card.attachments?.[0].url, master.url);
  assert.match(card.attachments?.[0].previewUrl || "", /\/preview\?v=a{16}$/);
  assert.match(card.attachments?.[0].thumbnailUrl || "", /\/thumbnail\?v=b{16}$/);
});

test("missing Trello derivatives use same-origin lazy-cache URLs", () => {
  const master = attachment({
    id: "attachment missing",
    previewUrl: "https://trello.com/native-preview.jpg",
    thumbnailUrl: "https://trello.com/native-thumbnail.jpg",
  });
  const [card] = withStoredTrelloImagePreviews(
    [
      {
        id: "card-current",
        name: "SKU_Product",
        desc: "",
        idList: "list-1",
        url: "https://trello.test/card-current",
        badges: { attachments: 1 },
        attachments: [master],
      },
    ],
    [],
  );

  assert.equal(card.attachments?.[0].url, master.url);
  assert.equal(
    card.attachments?.[0].previewUrl,
    "/api/trello/cards/card-current/attachments/attachment%20missing/preview",
  );
  assert.equal(
    card.attachments?.[0].thumbnailUrl,
    "/api/trello/cards/card-current/attachments/attachment%20missing/thumbnail",
  );
});

test("preview scan selects only images missing at least one derivative", () => {
  const master = attachment({ id: "master" });
  const complete = attachment({
    id: "complete",
    url: "https://trello.com/1/cards/card-current/attachments/complete/download/complete.jpg",
  });
  const card = {
    id: "card-current",
    name: "SKU_Product",
    desc: "",
    idList: "list-1",
    url: "https://trello.test/card-current",
    badges: { attachments: 2 },
    attachments: [master, complete],
  };
  const missing = selectMissingTrelloImageDerivatives(
    [card],
    [
      {
        cardId: card.id,
        attachmentId: master.id,
        variant: "preview",
        sha256: "a".repeat(64),
      },
      {
        cardId: card.id,
        attachmentId: complete.id,
        variant: "preview",
        sha256: "b".repeat(64),
      },
      {
        cardId: card.id,
        attachmentId: complete.id,
        variant: "thumbnail",
        sha256: "c".repeat(64),
      },
    ],
  );

  assert.deepEqual(
    missing.map((item) => item.attachment.id),
    [master.id],
  );
});

test("moveTrelloCard sends pos 'top' to place moved card at the top of target column", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) {
      requestBody = JSON.parse(init.body as string);
    }
    return new Response(JSON.stringify({ id: "card-123", idList: "list-target", pos: 1024 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const { moveTrelloCard } = await import("../lib/trello");
    await moveTrelloCard("card-123", "list-target", "key", "token");
    assert.deepEqual(requestBody, { idList: "list-target", pos: "top" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
