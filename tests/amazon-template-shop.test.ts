import assert from "node:assert/strict";
import test from "node:test";
import { isTemplateForShop, templatesForShop } from "@/lib/amazon-template-shop";

const shopA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const shopB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const templates = [
  { id: "template-a", shop_id: shopA, shop_is_unassigned: false },
  { id: "template-b", shop_id: shopB, shop_is_unassigned: false },
  { id: "legacy", shop_id: shopA, shop_is_unassigned: true },
];

test("a destination shop only sees its assigned blank templates", () => {
  assert.deepEqual(templatesForShop(templates, shopA).map((template) => template.id), ["template-a"]);
  assert.deepEqual(templatesForShop(templates, shopB).map((template) => template.id), ["template-b"]);
});

test("export rejects a template from another shop or an unassigned legacy template", () => {
  assert.equal(isTemplateForShop(templates[0], shopA), true);
  assert.equal(isTemplateForShop(templates[0], shopB), false);
  assert.equal(isTemplateForShop(templates[2], shopA), false);
  assert.equal(isTemplateForShop(templates[0], ""), false);
});
