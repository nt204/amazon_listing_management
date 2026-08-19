import { NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import { invalidateCachePattern } from "@/lib/redis";
import {
  ApiError,
  authorize,
  dataScope,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  saveTrelloImageDerivatives,
  type DataScope,
} from "@/lib/db";
import { createTrelloImageDerivatives } from "@/lib/image-processing";
import {
  fetchTrelloCardDetail,
  selectTrelloImageAttachments,
  downloadTrelloAttachment,
  attachFileToTrelloCard,
  deleteTrelloCardAttachment,
  moveTrelloCard,
  parseTrelloCardTitle,
  parseCardDimensions,
  preferredAttachmentPreview,
  preferredAttachmentThumbnail,
} from "@/lib/trello";
import {
  classifyMockupGenerationError,
  generateAllMockups,
  isCheapKeyAIImageModel,
  isImageApiModel,
  isOpenAIImageModel,
  mockupIndexFromAttachmentName,
} from "@/lib/mockup-generator";

export const runtime = "nodejs";
export const maxDuration = 600;

const mockupModelSchema = z.enum([
  "gpt-image-2",
  "gpt-image-2-c",
  "gpt-image-2-cheapkey",
  "gpt-image-1.5",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "fast-graphic",
  "chatgpt-web-automation",
]);
const imageQualitySchema = z.enum(["low", "medium", "high"]);

const generateMockupsSchema = z.object({
  cardId: z.string().min(1, "cardId là bắt buộc"),
  targetListId: z.string().optional(),
  apiKey: z.string().optional(),
  token: z.string().optional(),
  model: mockupModelSchema.optional(),
  quality: imageQualitySchema.optional(),
  designDataUrl: z.string().optional(),
  selectedSteps: z
    .array(z.number().int().min(1).max(20))
    .min(1, "Hãy chọn ít nhất một concept mockup.")
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
});

type GenerateMockupsInput = z.infer<typeof generateMockupsSchema>;
type ProgressReporter = (event: {
  type: "progress";
  step: number;
  name: string;
  status: "processing" | "success" | "error";
  phase: "generation" | "upload";
  message: string;
  attachmentUrl?: string;
  attachmentId?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
}) => void;

const activeCardGenerations = new Set<string>();

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const input = generateMockupsSchema.parse(await request.json());

    if (input.stream) {
      return createStreamingResponse(input, scope);
    }

    return NextResponse.json(await runMockupGeneration(input, scope));
  } catch (error) {
    return routeErrorResponse(
      normalizeGenerationError(error),
      "Không thể tự động tạo mockup.",
    );
  }
}

async function runMockupGeneration(
  input: GenerateMockupsInput,
  scope: DataScope,
  report?: ProgressReporter,
) {
  if (activeCardGenerations.has(input.cardId)) {
    throw new ApiError(
      "Thẻ này đang có một lượt tạo mockup khác chạy. Hệ thống đã chặn request trùng để tránh phát sinh thêm chi phí.",
      409,
    );
  }
  activeCardGenerations.add(input.cardId);
  try {
    return await executeMockupGeneration(input, scope, report);
  } finally {
    activeCardGenerations.delete(input.cardId);
  }
}

async function executeMockupGeneration(
  input: GenerateMockupsInput,
  scope: DataScope,
  report?: ProgressReporter,
) {
  const { cardId, targetListId, model, quality } = input;

  const apiKey = input.apiKey || process.env.TRELLO_API_KEY || "";
  const token = input.token || process.env.TRELLO_TOKEN || "";

  if (!apiKey || !token) {
    throw new ApiError(
      "Vui lòng cung cấp Trello API Key và Token (hoặc cấu hình trong .env)",
      400,
    );
  }

  const configuredModel = mockupModelSchema.safeParse(
    process.env.MOCKUP_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL,
  );
  const configuredQuality = imageQualitySchema.safeParse(
    process.env.OPENAI_IMAGE_QUALITY,
  );
  const selectedModel =
    model ||
    (configuredModel.success ? configuredModel.data : "gpt-image-1.5");
  const selectedQuality =
    quality || (configuredQuality.success ? configuredQuality.data : "low");

  if (isOpenAIImageModel(selectedModel) && !process.env.OPENAI_API_KEY?.trim()) {
    throw new ApiError("OPENAI_API_KEY chưa được cấu hình trên server.", 503);
  }

  if (
    isCheapKeyAIImageModel(selectedModel) &&
    !process.env.CHEAPKEYAI_API_KEY?.trim()
  ) {
    throw new ApiError(
      "CHEAPKEYAI_API_KEY chưa được cấu hình trên server.",
      503,
    );
  }

  if (
    (selectedModel === "gemini-3.1-flash-image" ||
      selectedModel === "gemini-3-pro-image") &&
    !process.env.GEMINI_API_KEY?.trim()
  ) {
    throw new ApiError("GEMINI_API_KEY chưa được cấu hình trên server.", 503);
  }

  console.log(`[API generate-mockups] Đang lấy chi tiết thẻ Trello: ${cardId}`);
  const card = await fetchTrelloCardDetail(cardId, apiKey, token);
  const parsedTitle = parseTrelloCardTitle(card.name);
  const dimensions = parseCardDimensions(card.desc || "");

  const imageAttachments = selectTrelloImageAttachments(card);
  const existingGeneratedAttachments = new Map(
    imageAttachments.flatMap((attachment) => {
      const index = mockupIndexFromAttachmentName(attachment.name);
      return index ? ([[index, attachment]] as const) : [];
    }),
  );
  const sourceAttachment =
    imageAttachments.find(
      (attachment) => mockupIndexFromAttachmentName(attachment.name) === null,
    ) || imageAttachments[0];
  let designBuffer: Buffer | null = null;
  let mimeType = "image/jpeg";

  // Auto-cleanup any old duplicate Mockup 1 attachments uploaded by previous system runs
  const oldMockup1Attachments = imageAttachments.filter(
    (att) => att.id !== sourceAttachment?.id && mockupIndexFromAttachmentName(att.name) === 1,
  );
  if (oldMockup1Attachments.length > 0) {
    console.log(
      `[API generate-mockups] Tự động xóa ${oldMockup1Attachments.length} file Mockup 1 trùng lặp cũ trên Trello.`,
    );
    await Promise.all(
      oldMockup1Attachments.map((att) =>
        deleteTrelloCardAttachment(card.id, att.id, apiKey, token).catch(() => null),
      ),
    );
  }

  if (input.designDataUrl) {
    const match = input.designDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      designBuffer = Buffer.from(match[2], "base64");
    }
  }

  if (!designBuffer && sourceAttachment) {
    console.log(
      `[API generate-mockups] Tải đính kèm thiết kế từ Trello: ${sourceAttachment.url}`,
    );
    try {
      designBuffer = await downloadTrelloAttachment(
        sourceAttachment.url,
        apiKey,
        token,
      );
      mimeType = sourceAttachment.mimeType || "image/jpeg";
    } catch (err) {
      console.warn(
        "[API generate-mockups] Không tải được ảnh đính kèm Trello; lần chạy sẽ dừng vì không có ảnh fallback:",
        err,
      );
    }
  }

  if (!designBuffer) {
    throw new ApiError("Thẻ Trello chưa có ảnh thiết kế đính kèm hợp lệ.", 400);
  }

  const uploadedAttachmentsMap = new Map<
    number,
    {
      index: number;
      name: string;
      status: "success" | "failed";
      attachmentId?: string;
      url?: string;
      previewUrl?: string;
      thumbnailUrl?: string;
      error?: string;
      existing?: boolean;
    }
  >();

  if (sourceAttachment) {
    uploadedAttachmentsMap.set(1, {
      index: 1,
      name: "Mockup 1 - Full Design (Ảnh Gốc Đầu Vào)",
      attachmentId: sourceAttachment.id,
      url: sourceAttachment.url,
      status: "success",
      existing: true,
    });
  }

  for (const [index, attachment] of existingGeneratedAttachments) {
    if (index === 1) continue; // NEVER duplicate index 1
    uploadedAttachmentsMap.set(index, {
      index,
      name: attachment.name,
      attachmentId: attachment.id,
      url: attachment.url,
      status: "success" as const,
      existing: true,
    });
  }

  const uploadedAttachments = Array.from(uploadedAttachmentsMap.values());

  const forceRegenerate = Boolean(
    input.forceRegenerate ||
      (input.selectedSteps && input.selectedSteps.length > 0),
  );

  const existingIndexesSet = new Set(existingGeneratedAttachments.keys());
  const selectedStepSet = input.selectedSteps
    ? new Set(input.selectedSteps)
    : null;

  const skipIndexes = Array.from(
    new Set([
      1, // Always skip generating Mockup 1 via AI
      ...Array.from(existingIndexesSet).filter((index) => {
        if (forceRegenerate && selectedStepSet?.has(index) && index >= 2) {
          return false;
        }
        return true;
      }),
    ]),
  );

  if (!selectedStepSet || selectedStepSet.has(1)) {
    report?.({
      type: "progress",
      step: 1,
      name: uploadedAttachments[0]?.name || "Mockup 1 - Full Design",
      status: "success",
      phase: "upload",
      message: "Đã giữ nguyên ảnh thiết kế gốc trên Trello.",
    });
  }
  for (const [index, attachment] of existingGeneratedAttachments) {
    if (index === 1) continue;
    if (
      skipIndexes.includes(index) &&
      (!selectedStepSet || selectedStepSet.has(index))
    ) {
      report?.({
        type: "progress",
        step: index,
        name: attachment.name,
        status: "success",
        phase: "upload",
        message: `${attachment.name} đã có trên Trello, bỏ qua khi chạy tiếp.`,
      });
    }
  }

  const existingAiIndexes = Array.from(existingIndexesSet).filter(
    (idx) => idx >= 2,
  );
  const existingAiCount = existingAiIndexes.length;
  const maxAiAllowed = forceRegenerate
    ? 6
    : Math.max(0, 6 - existingAiCount);

  const targetIndexes = input.selectedSteps
    ? input.selectedSteps.filter((idx) => idx >= 2)
    : [2, 3, 4, 5, 6, 7];

  const ungeneratedTargetSteps = targetIndexes.filter(
    (idx) => !skipIndexes.includes(idx),
  );

  const stepsToGenerate = ungeneratedTargetSteps.slice(0, maxAiAllowed);

  if (stepsToGenerate.length === 0 && !forceRegenerate) {
    console.log(
      `[API generate-mockups] Thẻ "${card.name}" đã có đủ ${existingAiCount}/6 concept AI đính kèm trên Trello. Bỏ qua sinh mới.`,
    );
    let movedToTargetList = false;
    if (targetListId) {
      try {
        await moveTrelloCard(card.id, targetListId, apiKey, token);
        movedToTargetList = true;
      } catch (err) {
        console.warn("[API generate-mockups] Cảnh báo chuyển cột Trello:", err);
      }
    }
    report?.({
      type: "progress",
      step: 1,
      name: "Đã có đủ ảnh",
      status: "success",
      phase: "upload",
      message: `Thẻ đã có đủ ${existingAiCount}/6 concept AI đính kèm trên Trello, đã tự động chuyển thẻ sang cột MOCKUP.`,
    });
    return {
      success: true,
      cardId: card.id,
      cardName: card.name,
      sku: parsedTitle.sku,
      uploadedCount: uploadedAttachments.length,
      attachments: uploadedAttachments,
      movedToTargetList,
    };
  }

  const selectedIndexesForGen = (
    forceRegenerate ? input.selectedSteps : stepsToGenerate
  )?.filter((idx) => idx >= 2);

  console.log(
    `[API generate-mockups] SKU "${parsedTitle.sku}": đang sinh thêm ${stepsToGenerate.length} concept AI... (đã có ${existingAiCount}/6 AI concept, forceRegenerate=${forceRegenerate})`,
  );

  const uploadTasks: Promise<void>[] = [];

  const mockups = await generateAllMockups(
    {
      sku: parsedTitle.sku,
      itemName: parsedTitle.itemName,
      productContext: card.desc || undefined,
      dimensions,
      inputDesignBuffer: designBuffer,
      inputMimeType: mimeType,
      model: selectedModel,
      quality: selectedQuality,
      skipIndexes,
      selectedIndexes: selectedIndexesForGen,
      customMockups: input.customContents,
      customRefinementNotes: input.customRefinementNotes,
      onMockupReady: async (mockup) => {
        if (mockup.index === 1) {
          console.log(
            "[API generate-mockups] Bỏ qua tải lên Mockup 1 (ảnh gốc đã có sẵn trên Trello).",
          );
          return;
        }

        // 1. LIGHTWEIGHT WEBP PREVIEW (16KB vs 3MB PNG Base64!): Stream tiny WebP Data URI to UI instantly
        const smallWebp = await sharp(mockup.buffer)
          .resize(320, 320, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer()
          .catch(() => null);

        const previewDataUri = smallWebp
          ? `data:image/webp;base64,${smallWebp.toString("base64")}`
          : undefined;

        report?.({
          type: "progress",
          step: mockup.index,
          name: mockup.name,
          status: "success",
          phase: "generation",
          message: `Đã xong ${mockup.name}! Đang tải lên Trello...`,
          attachmentUrl: previewDataUri,
          previewUrl: previewDataUri,
          thumbnailUrl: previewDataUri,
        });

        // 2. QUEUE TRELLO UPLOAD TO BACKGROUND TASK (AI worker is unblocked immediately!)
        const uploadTask = (async () => {
          try {
            const attachment = await attachFileToTrelloCard(
              card.id,
              mockup.buffer,
              mockup.type,
              mockup.mimeType,
              apiKey,
              token,
            );

            const existingEntryIdx = uploadedAttachments.findIndex(
              (item) => item.index === mockup.index,
            );
            const newEntry = {
              index: mockup.index,
              name: mockup.name,
              attachmentId: attachment.id,
              url: attachment.url,
              status: "success" as const,
            };
            if (existingEntryIdx >= 0) {
              uploadedAttachments[existingEntryIdx] = newEntry;
            } else {
              uploadedAttachments.push(newEntry);
            }

            const previewUrl =
              preferredAttachmentPreview(attachment) ||
              `/api/trello/cards/${encodeURIComponent(card.id)}/attachments/${encodeURIComponent(attachment.id)}/preview` ||
              previewDataUri;
            const thumbnailUrl =
              preferredAttachmentThumbnail(attachment) ||
              `/api/trello/cards/${encodeURIComponent(card.id)}/attachments/${encodeURIComponent(attachment.id)}/thumbnail` ||
              previewDataUri;

            report?.({
              type: "progress",
              step: mockup.index,
              name: mockup.name,
              status: "success",
              phase: "upload",
              message: `Đã tải ${mockup.name} lên Trello.`,
              attachmentUrl: attachment.url,
              attachmentId: attachment.id,
              previewUrl,
              thumbnailUrl,
            });

            // WebP derivative creation & old attachment deletion
            const derivatives = await createTrelloImageDerivatives(mockup.buffer).catch(() => null);
            if (derivatives) {
              await saveTrelloImageDerivatives(
                scope,
                card.id,
                attachment.id,
                derivatives,
              ).catch((dbErr) => {
                console.warn(
                  `[API generate-mockups] Không thể lưu derivative DB cho ${mockup.name}:`,
                  dbErr,
                );
              });
            }

            const oldAttachments = imageAttachments.filter(
              (att) =>
                att.id !== attachment.id &&
                mockupIndexFromAttachmentName(att.name) === mockup.index,
            );
            if (oldAttachments.length > 0) {
              await Promise.all(
                oldAttachments.map((oldAtt) =>
                  deleteTrelloCardAttachment(card.id, oldAtt.id, apiKey, token).catch((err) => {
                    console.warn(
                      `[API generate-mockups] Không thể xóa đính kèm cũ ID ${oldAtt.id} trên Trello:`,
                      err,
                    );
                  }),
                ),
              );
            }
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[API generate-mockups] Lỗi khi upload ${mockup.name}:`,
              errorMsg,
            );
            uploadedAttachments.push({
              index: mockup.index,
              name: mockup.name,
              status: "failed",
              error: errorMsg,
            });
            report?.({
              type: "progress",
              step: mockup.index,
              name: mockup.name,
              status: "error",
              phase: "upload",
              message: `Không thể tải ${mockup.name} lên Trello.`,
            });
          }
        })();

        uploadTasks.push(uploadTask);
      },
    },
    (step, name, status) => {
      report?.({
        type: "progress",
        step,
        name,
        status: "processing",
        phase: "generation",
        message:
          status === "processing"
            ? `Đang tạo ${name}...`
            : `Đã tạo xong ${name}, đang chuẩn bị upload...`,
      });
    },
  );

  console.log(
    `[API generate-mockups] Đã xử lý xong ${mockups.length - 1} ảnh AI mới cho SKU "${parsedTitle.sku}".`,
  );
  if (uploadTasks.length > 0) {
    await Promise.allSettled(uploadTasks);
  }

  // Invalidate Redis card cache so team members instantly see updated cards
  await invalidateCachePattern("trello:board:*");

  const successfulIndexes = new Set(
    uploadedAttachments
      .filter((attachment) => attachment.status === "success")
      .map((attachment) => attachment.index),
  );
  const allUploadsSucceeded = Array.from(
    { length: 7 },
    (_, index) => index + 1,
  ).every((index) => successfulIndexes.has(index));
  const requestedMockupIndexes = Array.from(
    new Set(input.selectedSteps || [2, 3, 4, 5, 6, 7]),
  );
  const requestedUploadsSucceeded = requestedMockupIndexes.every((index) =>
    successfulIndexes.has(index),
  );
  const providerResponses = mockups.flatMap((mockup) =>
    mockup.providerTrace ? [mockup.providerTrace] : [],
  );
  const totalSuccessCount = uploadedAttachments.filter(
    (attachment) => attachment.status === "success",
  ).length;

  let movedToTargetList = false;
  // ONLY move card to MOCKUP list when card has ALL 7 images!
  if (targetListId && (allUploadsSucceeded || totalSuccessCount >= 7)) {
    try {
      console.log(
        `[API generate-mockups] Thẻ đã đủ ${totalSuccessCount}/7 ảnh, đang chuyển thẻ Trello "${card.name}" sang cột MOCKUP: ${targetListId}`,
      );
      await moveTrelloCard(card.id, targetListId, apiKey, token);
      movedToTargetList = true;
    } catch (err) {
      console.warn(
        "[API generate-mockups] Cảnh báo không thể chuyển thẻ Trello sang cột MOCKUP:",
        err,
      );
    }
  }

  return {
    success: requestedUploadsSucceeded,
    cardId: card.id,
    cardName: card.name,
    sku: parsedTitle.sku,
    itemName: parsedTitle.itemName,
    dimensions,
    model: selectedModel,
    quality: isImageApiModel(selectedModel) ? selectedQuality : null,
    sourceImagesCount: 1,
    generatedMockupsCount: successfulIndexes.size - 1,
    newlyGeneratedMockupsCount: mockups.length - 1,
    requestedMockupsCount: requestedMockupIndexes.length,
    providerResponseCount: providerResponses.length,
    providerResponses,
    mockupsCount: 7,
    attachments: uploadedAttachments.sort((a, b) => a.index - b.index),
    movedToTargetList,
  };
}

function createStreamingResponse(input: GenerateMockupsInput, scope: DataScope) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let writable = true;
      const send = (event: unknown) => {
        if (!writable) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          writable = false;
        }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);

      try {
        const result = await runMockupGeneration(
          input,
          scope,
          send as ProgressReporter,
        );
        send({ type: "complete", data: result });
      } catch (error) {
        const normalized = normalizeGenerationError(error);
        const baseMessage =
          normalized instanceof ApiError
            ? normalized.message
            : process.env.NODE_ENV === "production"
              ? "Không thể tự động tạo mockup."
              : normalized instanceof Error
                ? normalized.message
                : "Không thể tự động tạo mockup.";
        send({
          type: "error",
          error: `${baseMessage} Các ảnh đã upload thành công vẫn được giữ trên Trello; bấm chạy lại để tiếp tục các ảnh còn thiếu.`,
        });
      } finally {
        clearInterval(heartbeat);
        if (writable) {
          writable = false;
          controller.close();
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function normalizeGenerationError(error: unknown) {
  const providerError = classifyMockupGenerationError(error);
  return providerError
    ? new ApiError(providerError.message, providerError.status)
    : error;
}
