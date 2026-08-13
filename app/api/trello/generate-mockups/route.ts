import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import {
  fetchTrelloCardDetail,
  selectTrelloImageAttachments,
  downloadTrelloAttachment,
  attachFileToTrelloCard,
  moveTrelloCard,
  parseTrelloCardTitle,
  parseCardDimensions,
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
export const maxDuration = 300;

const mockupModelSchema = z.enum([
  "gpt-image-2",
  "gpt-image-2-c",
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
  selectedSteps: z
    .array(z.number().int().min(2).max(7))
    .min(1, "Hãy chọn ít nhất một concept mockup từ Content 2 đến Content 7.")
    .optional(),
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
}) => void;

const activeCardGenerations = new Set<string>();

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    const input = generateMockupsSchema.parse(await request.json());

    if (input.stream) {
      return createStreamingResponse(input);
    }

    return NextResponse.json(await runMockupGeneration(input));
  } catch (error) {
    return routeErrorResponse(
      normalizeGenerationError(error),
      "Không thể tự động tạo mockup.",
    );
  }
}

async function runMockupGeneration(
  input: GenerateMockupsInput,
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
    return await executeMockupGeneration(input, report);
  } finally {
    activeCardGenerations.delete(input.cardId);
  }
}

async function executeMockupGeneration(
  input: GenerateMockupsInput,
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
  const sourceAttachment = imageAttachments.find(
    (attachment) => mockupIndexFromAttachmentName(attachment.name) === null,
  );
  let designBuffer: Buffer | null = null;
  let mimeType = "image/jpeg";

  if (sourceAttachment) {
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
        "[API generate-mockups] Lỗi khi tải ảnh đính kèm Trello, dùng ảnh fallback:",
        err,
      );
    }
  }

  if (!designBuffer) {
    throw new ApiError("Thẻ Trello chưa có ảnh thiết kế đính kèm hợp lệ.", 400);
  }

  const uploadedAttachments: Array<{
    index: number;
    name: string;
    status: "success" | "failed";
    attachmentId?: string;
    url?: string;
    error?: string;
    existing?: boolean;
  }> = [
      {
        index: 1,
        name: "Mockup 1 - Full Design (Ảnh Gốc Đầu Vào)",
        attachmentId: sourceAttachment?.id,
        url: sourceAttachment?.url,
        status: "success",
        existing: true,
      },
      ...Array.from(existingGeneratedAttachments.entries()).map(
        ([index, attachment]) => ({
          index,
          name: attachment.name,
          attachmentId: attachment.id,
          url: attachment.url,
          status: "success" as const,
          existing: true,
        }),
      ),
    ];

  report?.({
    type: "progress",
    step: 1,
    name: uploadedAttachments[0].name,
    status: "success",
    phase: "upload",
    message: "Đã giữ nguyên ảnh thiết kế gốc trên Trello.",
  });
  for (const [index, attachment] of existingGeneratedAttachments) {
    report?.({
      type: "progress",
      step: index,
      name: attachment.name,
      status: "success",
      phase: "upload",
      message: `${attachment.name} đã có trên Trello, bỏ qua khi chạy tiếp.`,
    });
  }

  console.log(
    `[API generate-mockups] SKU "${parsedTitle.sku}": đã có ${existingGeneratedAttachments.size}/6 ảnh AI, đang tạo các ảnh còn thiếu...`,
  );

  const mockups = await generateAllMockups(
    {
      sku: parsedTitle.sku,
      itemName: parsedTitle.itemName,
      dimensions,
      inputDesignBuffer: designBuffer,
      inputMimeType: mimeType,
      model: selectedModel,
      quality: selectedQuality,
      skipIndexes: Array.from(existingGeneratedAttachments.keys()),
      selectedIndexes: input.selectedSteps,
      onMockupReady: async (mockup) => {
        report?.({
          type: "progress",
          step: mockup.index,
          name: mockup.name,
          status: "processing",
          phase: "upload",
          message: `Đã tạo xong, đang tải ${mockup.name} lên Trello...`,
        });
        try {
          const attachment = await attachFileToTrelloCard(
            card.id,
            mockup.buffer,
            mockup.type,
            mockup.mimeType,
            apiKey,
            token,
          );
          uploadedAttachments.push({
            index: mockup.index,
            name: mockup.name,
            attachmentId: attachment.id,
            url: attachment.url,
            status: "success",
          });
          report?.({
            type: "progress",
            step: mockup.index,
            name: mockup.name,
            status: "success",
            phase: "upload",
            message: `Đã tải ${mockup.name} lên Trello.`,
            attachmentUrl: attachment.url,
            attachmentId: attachment.id,
          });
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
      },
    },
    (step, name, status) => {
      report?.({
        type: "progress",
        step,
        name,
        // A generated image is not durable until Trello confirms the upload.
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
  let movedToTargetList = false;
  if (targetListId && allUploadsSucceeded) {
    try {
      console.log(
        `[API generate-mockups] Đang chuyển thẻ Trello ${card.id} sang cột MOCKUP: ${targetListId}`,
      );
      await moveTrelloCard(card.id, targetListId, apiKey, token);
      movedToTargetList = true;
    } catch (err) {
      console.warn(
        "[API generate-mockups] Cảnh báo không thể chuyển thẻ Trello:",
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

function createStreamingResponse(input: GenerateMockupsInput) {
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