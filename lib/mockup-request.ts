import { z } from "zod";
import { MAX_AI_MOCKUPS_PER_PRODUCT } from "@/lib/mockup-generator";

export const mockupModelSchema = z.enum([
  "gpt-image-2",
  "gpt-image-2-c",
  "gpt-image-2-cheapkey",
  "gpt-image-1.5",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "fast-graphic",
  "chatgpt-web-automation",
]);

export const imageQualitySchema = z.enum(["low", "medium", "high"]);

export const generateMockupsSchema = z.object({
  cardId: z.string().min(1, "cardId là bắt buộc"),
  model: mockupModelSchema.optional(),
  quality: imageQualitySchema.optional(),
  designDataUrl: z.string().optional(),
  selectedSteps: z
    .array(z.number().int().min(2).max(20))
    .min(1, "Hãy chọn ít nhất một concept mockup.")
    .max(
      MAX_AI_MOCKUPS_PER_PRODUCT,
      `Mỗi sản phẩm chỉ được chọn tối đa ${MAX_AI_MOCKUPS_PER_PRODUCT} Content AI ngoài ảnh gốc.`,
    )
    .refine((steps) => new Set(steps).size === steps.length, {
      message: "Danh sách Content AI không được chứa vị trí trùng nhau.",
    })
    .optional(),
  customContents: z
    .array(
      z.object({
        id: z.number().int().min(1).max(20),
        label: z.string().trim().min(1).max(200),
        promptKey: z.string().trim().optional(),
        customPrompt: z.string().trim().optional(),
      }),
    )
    .max(20)
    .optional(),
  customRefinementNotes: z.record(z.coerce.number(), z.string()).optional(),
  forceRegenerate: z.boolean().optional(),
  stream: z.boolean().optional(),
}).strict();

export type GenerateMockupsInput = z.infer<typeof generateMockupsSchema>;

export function sanitizeQueuedMockupInput(
  input: GenerateMockupsInput,
): GenerateMockupsInput {
  return {
    ...input,
    designDataUrl: undefined,
    stream: true,
    selectedSteps: input.selectedSteps
      ? [...input.selectedSteps].sort((left, right) => left - right)
      : undefined,
  };
}
