// Lên camp SKU mới — các trường thông tin SB lấy từ BẢNG MÃ mà mỗi dạng chạy cần.
// Không import thư viện nặng: dùng được cả ở client (báo thiếu) lẫn server (kiểm tra lại).
import type { NewCampSkuInfo } from "./new-camp-generator";

export type SbField =
  | "brandEntityId"
  | "brand"
  | "brandLogoAssetId"
  | "creativeHeadline"
  | "creativeAsinsCollection"
  | "landingPageUrl"
  | "videoMediaIds"
  | "creativeAsinsVideo";

export const SB_FIELD_LABELS: Record<SbField, string> = {
  brandEntityId: "Brand Entity ID",
  brand: "Brand Name",
  brandLogoAssetId: "Brand Logo Asset ID",
  creativeHeadline: "Creative Headline",
  creativeAsinsCollection: "Creative ASINs (Collection)",
  landingPageUrl: "Landing Page URL",
  videoMediaIds: "Video Media IDs",
  creativeAsinsVideo: "Creative ASINs (Video)",
};

export const SB_FIELD_PLACEHOLDERS: Record<SbField, string> = {
  brandEntityId: "ENTITY…",
  brand: "Tên brand",
  brandLogoAssetId: "amzn1.assetlibrary.asset1…",
  creativeHeadline: "Tiêu đề quảng cáo",
  creativeAsinsCollection: "B0…, B0…, B0…",
  landingPageUrl: "https://www.amazon.com/stores/…",
  videoMediaIds: "amzn1.assetlibrary.asset1…",
  creativeAsinsVideo: "B0…",
};

/** Trường bắt buộc: thiếu thì Amazon từ chối camp khi upload. */
export const SB_REQUIRED_FIELDS: Record<"sb01" | "sb05", SbField[]> = {
  sb01: ["brandEntityId", "brand", "brandLogoAssetId", "creativeHeadline", "creativeAsinsCollection"],
  sb05: ["brandEntityId", "brand", "videoMediaIds", "creativeAsinsVideo"],
};

/** Trường nên có nhưng không bắt buộc (vẫn cho tạo file). */
export const SB_OPTIONAL_FIELDS: Record<"sb01" | "sb05", SbField[]> = {
  sb01: ["landingPageUrl"],
  sb05: [],
};

export const SB_FIELDS = Object.keys(SB_FIELD_LABELS) as SbField[];

export type SbOverrides = Record<string, Partial<Record<SbField, string>>>;

export function sbFieldValue(info: NewCampSkuInfo | undefined, override: Partial<Record<SbField, string>> | undefined, field: SbField): string {
  const extra = override?.[field]?.trim();
  if (extra) return extra;
  return (info?.[field] ?? "").trim();
}

/** Trường bắt buộc còn thiếu của 1 SKU theo các dạng SB đang chọn. */
export function missingSbFields(
  info: NewCampSkuInfo | undefined,
  override: Partial<Record<SbField, string>> | undefined,
  runs: { sb01: boolean; sb05: boolean },
  kind: "required" | "optional" = "required",
): SbField[] {
  const source = kind === "required" ? SB_REQUIRED_FIELDS : SB_OPTIONAL_FIELDS;
  const fields = new Set<SbField>();
  if (runs.sb01) source.sb01.forEach((f) => fields.add(f));
  if (runs.sb05) source.sb05.forEach((f) => fields.add(f));
  return SB_FIELDS.filter((f) => fields.has(f) && !sbFieldValue(info, override, f));
}

// ---------------------------------------------------------------------------
// Tên camp: ghép như tool cũ, thêm đuôi tên / gộp dấu cách (tuỳ chọn)
// ---------------------------------------------------------------------------

export interface NamingOptions {
  /** Gắn thêm vào cuối mọi tên camp */
  suffix?: string;
  /** Gộp nhiều dấu cách liền nhau (khi Phôi / Ngách / PIC trống) */
  collapseSpaces?: boolean;
}

export type NameField = "productType" | "niche" | "picMkt";
export const NAME_FIELDS: NameField[] = ["productType", "niche", "picMkt"];
export const NAME_FIELD_LABELS: Record<NameField, string> = { productType: "Phôi", niche: "Ngách", picMkt: "PIC" };
export type NameOverrides = Record<string, Partial<Record<NameField, string>>>;

/** "{SKU} {dạng chạy} {Phôi} {Ngách} {FBA|FBM} {Test|Win} {PIC} {YYYYMMDD} {đuôi part}" — đúng thứ tự tool cũ. */
export function buildCampaignName(
  p: { sku: string; loaiChay: string; productType: string; niche: string; loaiHinh: string; trangThai: string; picMkt: string; ngay: string; tail: string },
  naming?: NamingOptions,
): string {
  let name = `${p.sku} ${p.loaiChay} ${p.productType} ${p.niche} ${p.loaiHinh} ${p.trangThai} ${p.picMkt} ${p.ngay} ${p.tail}`;
  const suffix = naming?.suffix?.trim();
  if (suffix) name += ` ${suffix}`;
  if (naming?.collapseSpaces) name = name.replace(/\s{2,}/g, " ").trim();
  return name;
}

// ---------------------------------------------------------------------------
// Tuỳ chỉnh nâng cao — để trống thì dùng đúng giá trị của tool cũ
// ---------------------------------------------------------------------------

export const BIDDING_STRATEGIES = ["Dynamic bids - down only", "Dynamic bids - up and down", "Fixed bid"] as const;
export type BiddingStrategy = (typeof BIDDING_STRATEGIES)[number];

export interface AdvancedOptions {
  sp03BiddingStrategy: BiddingStrategy;
  sp04BiddingStrategy: BiddingStrategy;
  /** Ad Group Default Bid; trống = mặc định tool cũ (SP03/SP04 0.09, FL Asin 0.1) */
  adGroupDefaultBid: string;
  /** % bid Phrase / Broad so với Exact */
  phrasePct: number;
  broadPct: number;
}

export const DEFAULT_ADVANCED: AdvancedOptions = {
  sp03BiddingStrategy: "Dynamic bids - down only",
  sp04BiddingStrategy: "Dynamic bids - up and down",
  adGroupDefaultBid: "",
  phrasePct: 90,
  broadPct: 80,
};

// ---------------------------------------------------------------------------
// Brand Entity ID chuẩn theo store: lưu ở bảng ppc_store_brand_entities (sửa trên web)
// ---------------------------------------------------------------------------
export const BRAND_ENTITY_PATTERN = /^ENTITY[A-Z0-9]{8,}$/;

export function storeKey(storeName: string | null | undefined): string {
  return (storeName || "").trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Trạng thái SKU trong Bảng mã → Win / Test trong tên camp ("Phát triển" = Win, còn lại Test)
// ---------------------------------------------------------------------------
export function isWinStatus(status: string | null | undefined): boolean {
  return (status || "").normalize("NFC").trim().toLowerCase() === "phát triển";
}

/** Trạng thái đã dừng (Hủy / OFF / Cũ) — vẫn tính Test nhưng hiện cảnh báo */
export function isStoppedStatus(status: string | null | undefined): boolean {
  return ["hủy", "huỷ", "off", "cũ"].includes((status || "").normalize("NFC").trim().toLowerCase());
}
