export interface LegalEntity {
  id: string;
  name: string;
  country: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface Store {
  id: string;
  name: string;
  marketplace: string;
  team: string;
  legal_entity_id?: string | null;
  legal_entity_name?: string | null;
  legal_entity?: string | null;
  seller_id: string | null;
  status: "active" | "inactive";
  /** FBA: Net Profit = Profit − 20000 × service_rate ÷ 184 ngày (null = mặc định) */
  service_rate?: number | null;
  /** FBM: Net Profit = Profit − fbm_service_cost ÷ 184 ngày (null = không trừ) */
  fbm_service_cost?: number | null;
  created_at: string;
  updated_at: string;
  /** Phân quyền kế toán của người đang xem (GET /api/accounting/stores; xem lib/accounting/access.ts). */
  access?: StoreAccessInfo;
}

export interface StoreAccessInfo {
  channels: ("FBA" | "FBM")[];
  editChannels: ("FBA" | "FBM")[];
}

export interface CreateStoreInput {
  name: string;
  marketplace: string;
  team?: string;
  legal_entity_id?: string | null;
  legal_entity?: string | null;
  seller_id?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateStoreInput {
  name?: string;
  marketplace?: string;
  team?: string;
  legal_entity_id?: string | null;
  legal_entity?: string | null;
  seller_id?: string | null;
  status?: "active" | "inactive";
  service_rate?: number | null;
  fbm_service_cost?: number | null;
}

export interface CreateLegalEntityInput {
  name: string;
  country?: string;
  status?: "active" | "inactive";
}

export interface UpdateLegalEntityInput {
  name?: string;
  country?: string;
  status?: "active" | "inactive";
}
