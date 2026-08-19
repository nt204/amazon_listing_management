export interface MockupContentItem {
  id: number;
  label: string;
  checked: boolean;
  promptKey?: string;
  customPrompt?: string;
}

export interface ProductCategoryPreset {
  id: string;
  label: string;
  icon: string;
  isSystem?: boolean;
  contents: MockupContentItem[];
}

export interface PresetExportPayload {
  version: string;
  exportedAt: string;
  presets: ProductCategoryPreset[];
}
