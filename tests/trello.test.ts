import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanGeneratedTitle } from "../lib/listing-sanitizer";
import {
  extractTrelloBoardId,
  filterPublicTrelloImageAttachments,
  formatRawTrelloKeywords,
  parseTrelloCardTitle,
  selectTrelloImageAttachments,
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

test("formatRawTrelloKeywords uses raw keywords from Trello card description", () => {
  const rawDesc = "Generic keywords: cowgirl pop up card, 3d greeting card for birthday, western theme popup cards";
  const formatted = formatRawTrelloKeywords(rawDesc);
  assert.equal(formatted, "cowgirl pop up card 3d greeting for birthday western theme popup cards");
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
