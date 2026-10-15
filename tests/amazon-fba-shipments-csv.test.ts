import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseAmazonDate,
  parseAmazonShipmentNameAndId,
} from "../lib/accounting/inventory-db";
import { parseCsv } from "../lib/csv";

test("Amazon FBA Date Parser: parses various Amazon date formats accurately", () => {
  assert.equal(parseAmazonDate("Oct 6, 2026"), "2026-10-06");
  assert.equal(parseAmazonDate("Oct 12, 2026"), "2026-10-12");
  assert.equal(parseAmazonDate("Aug 10, 2026"), "2026-08-10");
  assert.equal(parseAmazonDate("Sep 28, 2026"), "2026-09-28");
  assert.equal(parseAmazonDate("Jan 1, 2026"), "2026-01-01");
  assert.equal(parseAmazonDate("2026-10-06"), "2026-10-06");
  assert.equal(parseAmazonDate(null), null);
  assert.equal(parseAmazonDate(""), null);
});

test("Amazon FBA Shipment Name & ID: extracts FBA ID and clean shipment name", () => {
  const ex1 = parseAmazonShipmentNameAndId("FBA ASDN (10/05/2026 22:39)-RMN3 (FBA19S37QSF8)");
  assert.equal(ex1.shipment_name, "FBA ASDN (10/05/2026 22:39)-RMN3");
  assert.equal(ex1.shipment_id, "FBA19S37QSF8");

  const ex2 = parseAmazonShipmentNameAndId("FBA STA (08/10/2026 01:57)-BNA6 (FBA19L92L6J2)");
  assert.equal(ex2.shipment_name, "FBA STA (08/10/2026 01:57)-BNA6");
  assert.equal(ex2.shipment_id, "FBA19L92L6J2");

  const ex3 = parseAmazonShipmentNameAndId("STAR-QDSFVHVYGM4GW (STAR-QDSFVHVYGM4GW)");
  assert.equal(ex3.shipment_id, "STAR-QDSFVHVYGM4GW");
});

test("Amazon FBA CSV File: validates fba_shipments_data_page_1.csv structure and values", () => {
  const filePath = "/Users/macbook/Downloads/fba_shipments_data_page_1.csv";
  if (!fs.existsSync(filePath)) {
    return; // Skip if file is moved
  }

  const content = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(content);
  assert.ok(rows.length >= 26, "Should contain at least 26 rows including header");

  const headers = rows[0].map((h) => h.toLowerCase());
  assert.ok(headers.includes("shipment name"));
  assert.ok(headers.includes("status"));
  assert.ok(headers.includes("created"));
  assert.ok(headers.includes("last updated"));
  assert.ok(headers.includes("destination"));
  assert.ok(headers.includes("units expected"));
  assert.ok(headers.includes("units located"));

  const firstRow = rows[1];
  const parsed = parseAmazonShipmentNameAndId(firstRow[0]);
  assert.equal(parsed.shipment_id, "FBA19S37QSF8");
  assert.equal(parsed.shipment_name, "FBA ASDN (10/05/2026 22:39)-RMN3");
  assert.equal(firstRow[1], "Checked in");
  assert.equal(parseAmazonDate(firstRow[2]), "2026-10-06");
  assert.equal(parseAmazonDate(firstRow[3]), "2026-10-12");
  assert.equal(firstRow[4], "RMN3");
  assert.equal(firstRow[7], "40");
  assert.equal(firstRow[8], "0");
});
