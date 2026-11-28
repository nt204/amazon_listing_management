export interface MockupPromptReferenceImage {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  url: string;
}

export interface MockupContentItem {
  id: number;
  label: string;
  checked: boolean;
  promptKey?: string;
  customPrompt?: string;
  referenceImages?: MockupPromptReferenceImage[];
}

export interface ProductCategoryPreset {
  id: string;
  label: string;
  icon: string;
  isSystem?: boolean;
  contents: MockupContentItem[];
  revision?: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** Một bản trong lịch sử chỉnh sửa phôi (prompt chung), dùng để khôi phục. */
export interface SharedMockupPresetVersion {
  id: string;
  presetId: string;
  label: string;
  icon: string;
  contents: MockupContentItem[];
  source: "baseline" | "edit" | "restore";
  restoredFromId: string | null;
  savedBy: string;
  savedByName: string;
  savedAt: string;
}

export interface PresetExportPayload {
  version: string;
  exportedAt: string;
  presets: ProductCategoryPreset[];
}
