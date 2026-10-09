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
  created_at: string;
  updated_at: string;
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
