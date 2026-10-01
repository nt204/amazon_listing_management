import type { SellerSpriteCandidate } from "../../domain/competitor.types";
import { normalizeCandidate } from "../../domain/normalize";
import {
  getSellerSpriteExtensionToken,
  computeSellerSpriteTk,
  refreshSellerSpriteExtensionToken,
} from "@/lib/sellersprite";

export interface SellerSpriteSearchOptions {
  query: string;
  marketplace?: string;
  limit?: number;
}

/**
 * Searches SellerSprite Competitor Lookup directly via the authentic Extension API (Sections 2 & 3).
 * Fetches 50-100 candidates for downstream AI and quantitative filtering.
 */
export async function searchSellerSprite(
  productName: string,
  marketplace: string = "US",
  limit: number = 100
): Promise<SellerSpriteCandidate[]> {
  const trimmed = productName.trim();
  if (!trimmed) {
    throw new Error("SELLERSPRITE_SEARCH_FAILED: Tên sản phẩm tìm kiếm không được để trống.");
  }

  let token = await getSellerSpriteExtensionToken();
  const marketCode = marketplace.toUpperCase();

  const isAsin = /^[A-Z0-9]{10}$/i.test(trimmed) || (trimmed.includes(",") && trimmed.length <= 150);
  const qParam = isAsin ? "" : trimmed;
  const asinsParam = isAsin ? trimmed : "";
  const tk = computeSellerSpriteTk(qParam, asinsParam);

  const url = new URL(`https://e.sellersprite.com/v2/extension/competitor-lookup/${marketCode}`);
  if (qParam) url.searchParams.set("q", qParam);
  if (asinsParam) url.searchParams.set("asins", asinsParam);
  url.searchParams.set("tk", tk);
  url.searchParams.set("version", "5.0.5");
  url.searchParams.set("language", "en");
  url.searchParams.set("extension", "lnbmbgocenenhhhdojdielgnmeflbnfb");
  url.searchParams.set("source", "chrome");

  let rawItems: any[] = [];
  try {
    const doFetch = (activeToken: string) =>
      fetch(url.toString(), {
        headers: {
          "Auth-Token": activeToken,
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
      });

    let response = await doFetch(token);
    let payload = await response.json();

    // Auto-reauthenticate if token expired or forbidden
    const isAuthError =
      payload.code === "ERR_NEED_RE_AUTHORIZED" ||
      payload.code === "ERR_GLOBAL_403" ||
      payload.code === "ERR_NEED_RENEWAL_AUTHORIZED" ||
      payload.code === "ERR_TOKEN_EXPIRED" ||
      (typeof payload.message === "string" && /token expired|re-auth|sign out and login|unauthorized|forbidden/i.test(payload.message));

    if (isAuthError) {
      try {
        token = await refreshSellerSpriteExtensionToken(token);
        response = await doFetch(token);
        payload = await response.json();
      } catch (authErr) {
        throw new Error(
          `Không thể tự động làm mới token SellerSprite: ${authErr instanceof Error ? authErr.message : String(authErr)}`
        );
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (payload.code !== "OK" && payload.code !== "200" && payload.code !== 200) {
      throw new Error(payload.message || `API error code: ${payload.code}`);
    }

    rawItems = payload.data?.items || [];
  } catch (error) {
    throw new Error(`SELLERSPRITE_SEARCH_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (rawItems.length === 0) {
    throw new Error(`SELLERSPRITE_SEARCH_FAILED: Không tìm thấy sản phẩm đối thủ nào cho "${trimmed}".`);
  }

  // Slice to desired target count (50-100) and normalize each candidate (Sections 3 & 4)
  const targetCandidates = rawItems.slice(0, limit);
  return targetCandidates.map((raw, index) => normalizeCandidate(raw, index));
}
