import "server-only";
// Lên Camp Sale KW dạng SB01 / SB05: gắn creative theo SKU (BẢNG MÃ + Entity / Logo theo store), bid theo % CPC.
import { getStoreSbDefaults, listLaunchSkus } from "./new-camp-db";
import { SB_FIELD_LABELS, SB_FIELDS, missingSbFields, sbFieldValue, withStoreSbDefaults, type SbField, type SbOverrides } from "./new-camp-fields";
import type { SaleKwCampaignPayload } from "./service";

export type SaleKwSbRun = "SB01" | "SB05";

export function saleKwSbRun(adTypeCode: unknown): SaleKwSbRun | null {
  const raw = String(adTypeCode || "").toUpperCase();
  if (raw.includes("SB05") || raw.includes("VIDEO")) return "SB05";
  if (raw.includes("SB01")) return "SB01";
  return null;
}

/** % bid SB so với CPC (như Lên Camp SKU Mới: SB01 80%, SB05 90%). */
export const SALE_KW_SB_BID_PCT: Record<SaleKwSbRun, number> = { SB01: 80, SB05: 90 };

export function parseSbOverrides(raw: unknown): SbOverrides {
  const out: SbOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [sku, fields] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    if (!fields || typeof fields !== "object") continue;
    const o: Partial<Record<SbField, string>> = {};
    for (const f of SB_FIELDS) if (typeof fields[f] === "string" && (fields[f] as string).trim()) o[f] = (fields[f] as string).trim().slice(0, 500);
    out[sku.trim().toUpperCase()] = o;
  }
  return out;
}

/** Chuyển camp sang SB: gắn creative, nhân bid theo %. Trả danh sách SKU thiếu trường bắt buộc (Auto Upload thì chặn). */
export async function applySaleKwSb(
  campaigns: SaleKwCampaignPayload[],
  opts: { run: SaleKwSbRun; storeName: string; fulfillment: "FBA" | "FBM"; overrides: SbOverrides; bidPct: number },
): Promise<string[]> {
  const [skus, storeDefaults] = await Promise.all([listLaunchSkus(opts.fulfillment), getStoreSbDefaults(opts.storeName)]);
  const infos = new Map(skus.map((x) => [x.sku.toUpperCase(), x]));
  const runs = { sb01: opts.run === "SB01", sb05: opts.run === "SB05" };
  const pct = opts.bidPct >= 10 && opts.bidPct <= 500 ? opts.bidPct : SALE_KW_SB_BID_PCT[opts.run];
  const scale = (bid: number | undefined) => (bid && bid > 0 ? Math.max(0.1, Math.round(bid * pct) / 100) : bid);
  const missing = new Set<string>();

  for (const camp of campaigns) {
    const sku = String(camp.sku || camp.skus?.[0] || "").trim().toUpperCase();
    const info = withStoreSbDefaults(infos.get(sku), sku, storeDefaults);
    const override = opts.overrides[sku];
    const lack = missingSbFields(info, override, runs);
    if (lack.length) missing.add(`${sku}: ${lack.map((f) => SB_FIELD_LABELS[f]).join(", ")}`);
    const v = (f: SbField) => sbFieldValue(info, override, f);
    camp.adProduct = "SB";
    camp.runType = opts.run;
    camp.sbCreative = runs.sb05
      ? { brandEntityId: v("brandEntityId"), brand: v("brand"), creativeAsins: v("creativeAsinsVideo"), videoMediaIds: v("videoMediaIds") }
      : {
          brandEntityId: v("brandEntityId"),
          brand: v("brand"),
          brandLogoAssetId: v("brandLogoAssetId"),
          creativeHeadline: v("creativeHeadline"),
          creativeAsins: v("creativeAsinsCollection"),
          landingPageUrl: v("landingPageUrl"),
        };
    camp.defaultBid = scale(camp.defaultBid);
    camp.keywords = camp.keywords.map((k) => ({ ...k, bid: scale(k.bid) }));
  }
  return [...missing];
}
