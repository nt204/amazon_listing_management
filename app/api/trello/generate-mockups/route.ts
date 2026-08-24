import { after, NextResponse } from "next/server";
import sharp from "sharp";
import { invalidateCachePattern } from "@/lib/redis";
import {
  ApiError,
  authorize,
  dataScope,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  authenticateMockupWorker,
  isAuthenticationRequired,
} from "@/lib/auth";
import {
  deleteTrelloImageDerivatives,
  getUserTrelloSettings,
  pruneExpiredTrelloImageDerivatives,
  saveTrelloImageDerivatives,
  type DataScope,
} from "@/lib/db";
import { createTrelloImageDerivatives } from "@/lib/image-processing";
import {
  acquireMockupCapacity,
  acquireMockupImageSlot,
  tryAcquireMockupCardLock,
} from "@/lib/mockup-capacity";
import {
  fetchTrelloCardDetail,
  selectTrelloImageAttachments,
  downloadTrelloAttachment,
  attachFileToTrelloCard,
  deleteTrelloCardAttachment,
  moveTrelloCard,
  parseTrelloCardTitle,
  parseCardDimensions,
  findRecentlyUploadedTrelloAttachment,
  isTrelloRequestTimeoutError,
  type TrelloAttachment,
} from "@/lib/trello";
import {
  MAX_AI_MOCKUPS_PER_PRODUCT,
  classifyMockupGenerationError,
  generateAllMockups,
  isCheapKeyAIImageModel,
  isImageApiModel,
  isOpenAIImageModel,
  mockupIndexFromAttachmentName,
  planMockupGeneration,
} from "@/lib/mockup-generator";
import {
  generateMockupsSchema,
  imageQualitySchema,
  mockupModelSchema,
  type GenerateMockupsInput,
} from "@/lib/mockup-request";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";
export const maxDuration = 600;

type PostResponseTask = () => Promise<void>;
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

function waitForUploadRecovery(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason || new DOMException("Tác vụ upload đã bị hủy.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function recoverTimedOutTrelloUpload(options: {
  cardId: string;
  fileName: string;
  fileBytes: number;
  uploadStartedAt: number;
  apiKey: string;
  token: string;
  signal?: AbortSignal;
}): Promise<TrelloAttachment | null> {
  for (const delayMs of [0, 2_500, 7_500]) {
    if (delayMs > 0) await waitForUploadRecovery(delayMs, options.signal);
    throwIfAborted(options.signal);
    try {
      const latestCard = await fetchTrelloCardDetail(
        options.cardId,
        options.apiKey,
        options.token,
        options.signal,
      );
      const recovered = findRecentlyUploadedTrelloAttachment(
        latestCard.attachments || [],
        {
          name: options.fileName,
          bytes: options.fileBytes,
          startedAt: options.uploadStartedAt,
        },
      );
      if (recovered) return recovered;
    } catch (error) {
      throwIfAborted(options.signal);
      console.warn(
        `[API generate-mockups] Chưa thể xác minh upload Trello của ${options.fileName}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const workerActor = authenticateMockupWorker(request);
    if (
      !workerActor &&
      process.env.NODE_ENV === "production" &&
      isAuthenticationRequired() &&
      process.env.ALLOW_DIRECT_MOCKUP_GENERATION !== "true"
    ) {
      throw new ApiError(
        "Production chỉ nhận tạo mockup qua hàng đợi bền vững.",
        403,
      );
    }
    const scope = dataScope(workerActor || authorize(request, "write"));
    const input = generateMockupsSchema.parse(await request.json());
    const postResponseTasks: PostResponseTask[] = [];
    after(async () => {
      const results = await Promise.allSettled(
        postResponseTasks.map((task) => task()),
      );
      const failedCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failedCount > 0) {
        console.warn(
          `[API generate-mockups] ${failedCount}/${results.length} tác vụ hậu xử lý ảnh thất bại.`,
        );
      }
      if (postResponseTasks.length > 0) {
        await invalidateCachePattern("trello:board:*");
      }
      const prunedPreviewCount = await pruneExpiredTrelloImageDerivatives({
        scope,
      }).catch((error) => {
        console.warn(
          "[API generate-mockups] Không thể dọn preview Trello quá hạn:",
          error instanceof Error ? error.message : String(error),
        );
        return 0;
      });
      if (prunedPreviewCount > 0) {
        console.info(
          `[API generate-mockups] Đã tự dọn ${prunedPreviewCount} preview Trello quá hạn.`,
        );
      }
    });

    if (input.stream) {
      return createStreamingResponse(
        input,
        scope,
        request.signal,
        postResponseTasks,
      );
    }

    return NextResponse.json(
      await runMockupGeneration(
        input,
        scope,
        undefined,
        request.signal,
        postResponseTasks,
      ),
    );
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
  signal?: AbortSignal,
  postResponseTasks: PostResponseTask[] = [],
) {
  throwIfAborted(signal);
  const requestedSteps = input.selectedSteps || Array.from(
    { length: MAX_AI_MOCKUPS_PER_PRODUCT },
    (_, index) => index + 2,
  );
  const cardLock = await tryAcquireMockupCardLock(
    input.cardId,
    requestedSteps,
  );
  if (!cardLock) {
    throw new ApiError(
      requestedSteps.length === 1
        ? `Mockup ${requestedSteps[0]} đang được tạo. Hệ thống đã chặn request trùng để tránh phát sinh thêm chi phí.`
        : "Một hoặc nhiều mockup đã chọn đang được tạo. Hệ thống đã chặn phần bị trùng để tránh phát sinh thêm chi phí.",
      409,
    );
  }
  const onAbort = () => {
    void cardLock.release();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await executeMockupGeneration(
      input,
      scope,
      report,
      signal,
      postResponseTasks,
    );
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await cardLock.release();
  }
}

async function executeMockupGeneration(
  input: GenerateMockupsInput,
  scope: DataScope,
  report?: ProgressReporter,
  signal?: AbortSignal,
  postResponseTasks: PostResponseTask[] = [],
) {
  const startedAt = Date.now();
  throwIfAborted(signal);
  const { cardId, model, quality } = input;

  const { apiKey, token } = getTrelloServerCredentials();
  const trelloSettings = await getUserTrelloSettings(scope);
  const targetListId = trelloSettings.mockupTargetListId;
  if (!trelloSettings.boardId || !targetListId) {
    throw new ApiError("Vui lòng cấu hình cột đích cho chức năng Mockup.", 400);
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
  const card = await fetchTrelloCardDetail(cardId, apiKey, token, signal);
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
  const configuredMaxSourceBytes = Number(
    process.env.MAX_IMAGE_BYTES || 15_000_000,
  );
  const maxSourceBytes = Number.isFinite(configuredMaxSourceBytes)
    ? Math.min(50_000_000, Math.max(1_000_000, configuredMaxSourceBytes))
    : 15_000_000;

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
        deleteTrelloCardAttachment(
          card.id,
          att.id,
          apiKey,
          token,
          signal,
        )
          .then(() =>
            deleteTrelloImageDerivatives(scope, card.id, [att.id]),
          )
          .catch(() => null),
      ),
    );
  }

  if (input.designDataUrl) {
    const match = input.designDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      designBuffer = Buffer.from(match[2], "base64");
      if (designBuffer.byteLength > maxSourceBytes) {
        throw new ApiError(
          `Ảnh thiết kế vượt quá giới hạn ${Math.round(maxSourceBytes / 1_000_000)} MB.`,
          413,
        );
      }
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
        maxSourceBytes,
        signal,
      );
      mimeType = sourceAttachment.mimeType || "image/jpeg";
    } catch (err) {
      throwIfAborted(signal);
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

  const forceRegenerate = Boolean(input.forceRegenerate);
  const {
    selectedStepSet,
    skipIndexes,
    existingAiCount,
    stepsToGenerate,
  } = planMockupGeneration({
    selectedSteps: input.selectedSteps,
    existingIndexes: Array.from(existingGeneratedAttachments.keys()),
    forceRegenerate,
  });

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
      selectedStepSet.has(index)
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

  if (stepsToGenerate.length === 0 && !forceRegenerate) {
    console.log(
      `[API generate-mockups] Thẻ "${card.name}" đã có đủ ${existingAiCount}/${MAX_AI_MOCKUPS_PER_PRODUCT} concept AI đính kèm trên Trello. Bỏ qua sinh mới.`,
    );
    let movedToTargetList = false;
    if (targetListId) {
      try {
        await moveTrelloCard(card.id, targetListId, apiKey, token, "top", signal);
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
      message: `Thẻ đã có đủ ${existingAiCount}/${MAX_AI_MOCKUPS_PER_PRODUCT} concept AI đính kèm trên Trello, đã tự động chuyển thẻ sang cột MOCKUP.`,
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

  const selectedIndexesForGen = stepsToGenerate;

  console.log(
    `[API generate-mockups] SKU "${parsedTitle.sku}": đang sinh thêm ${stepsToGenerate.length} concept AI... (đã có ${existingAiCount}/${MAX_AI_MOCKUPS_PER_PRODUCT} AI concept, forceRegenerate=${forceRegenerate})`,
  );

  const uploadTasks: Promise<void>[] = [];
  const queueStep = selectedIndexesForGen[0] || 2;
  const capacityLease = await acquireMockupCapacity(signal, () => {
    report?.({
      type: "progress",
      step: queueStep,
      name: "Hàng đợi tạo mockup",
      status: "processing",
      phase: "generation",
      message: "Đang chờ lượt tạo ảnh để hệ thống không bị quá tải...",
    });
  });

  let mockups: Awaited<ReturnType<typeof generateAllMockups>>;
  const generationStartedAt = Date.now();
  try {
    mockups = await generateAllMockups(
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
        signal,
        acquireImageSlot: acquireMockupImageSlot,
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
            const uploadLease = await acquireMockupImageSlot(
              signal,
              "trello-upload",
              () => {
                report?.({
                  type: "progress",
                  step: mockup.index,
                  name: mockup.name,
                  status: "processing",
                  phase: "upload",
                  message: `Đang chờ lượt tải ${mockup.name} lên Trello...`,
                });
              },
            );
            let attachment: TrelloAttachment;
            const uploadStartedAt = Date.now();
            try {
              try {
                attachment = await attachFileToTrelloCard(
                  card.id,
                  mockup.buffer,
                  mockup.type,
                  mockup.mimeType,
                  apiKey,
                  token,
                  signal,
                );
              } catch (uploadError) {
                if (signal?.aborted || !isTrelloRequestTimeoutError(uploadError)) {
                  throw uploadError;
                }
                const recovered = await recoverTimedOutTrelloUpload({
                  cardId: card.id,
                  fileName: mockup.type,
                  fileBytes: mockup.buffer.byteLength,
                  uploadStartedAt,
                  apiKey,
                  token,
                  signal,
                });
                if (!recovered) throw uploadError;
                attachment = recovered;
                console.warn(
                  `[API generate-mockups] Upload ${mockup.name} đã timeout ở client nhưng file đã có trên Trello; tiếp tục bằng attachment ${attachment.id}.`,
                );
              }
            } finally {
              await uploadLease.release();
            }

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

            const attachmentBaseUrl =
              `/api/trello/cards/${encodeURIComponent(card.id)}/attachments/${encodeURIComponent(attachment.id)}`;
            const previewUrl = `${attachmentBaseUrl}/preview`;
            const thumbnailUrl = `${attachmentBaseUrl}/thumbnail`;

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

            postResponseTasks.push(async () => {
              const derivatives = await createTrelloImageDerivatives(
                mockup.buffer,
              ).catch(() => null);
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
              await Promise.all(
                oldAttachments.map((oldAtt) =>
                  deleteTrelloCardAttachment(
                    card.id,
                    oldAtt.id,
                    apiKey,
                    token,
                  )
                    .then(() =>
                      deleteTrelloImageDerivatives(scope, card.id, [oldAtt.id]),
                    )
                    .catch((err) => {
                      console.warn(
                        `[API generate-mockups] Không thể xóa đính kèm cũ ID ${oldAtt.id} trên Trello:`,
                        err,
                      );
                    }),
                ),
              );
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
  } finally {
    await capacityLease.release();
    if (uploadTasks.length > 0) {
      await Promise.allSettled(uploadTasks);
      // A provider error can happen after sibling images have already uploaded.
      // Clear the board cache even on that partial-failure path so the UI does
      // not replace new attachments with stale, already-deleted URLs.
      await invalidateCachePattern("trello:board:*");
    }
  }

  const newlyGeneratedMockupsCount = mockups.filter(
    (mockup) => mockup.index !== 1,
  ).length;
  console.log(
    `[API generate-mockups] Đã xử lý xong ${newlyGeneratedMockupsCount} ảnh AI mới cho SKU "${parsedTitle.sku}".`,
  );

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
      await moveTrelloCard(card.id, targetListId, apiKey, token, "top", signal);
      movedToTargetList = true;
    } catch (err) {
      console.warn(
        "[API generate-mockups] Cảnh báo không thể chuyển thẻ Trello sang cột MOCKUP:",
        err,
      );
    }
  }

  const result = {
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
    newlyGeneratedMockupsCount,
    requestedMockupsCount: requestedMockupIndexes.length,
    providerResponseCount: providerResponses.length,
    providerResponses,
    mockupsCount: 7,
    attachments: uploadedAttachments.sort((a, b) => a.index - b.index),
    movedToTargetList,
    timing: {
      generationMs: Date.now() - generationStartedAt,
      totalMs: Date.now() - startedAt,
    },
  };
  console.info(
    "[API generate-mockups timing]",
    JSON.stringify({
      cardId: card.id,
      sku: parsedTitle.sku,
      model: selectedModel,
      generated: newlyGeneratedMockupsCount,
      ...result.timing,
    }),
  );
  return result;
}

function createStreamingResponse(
  input: GenerateMockupsInput,
  scope: DataScope,
  requestSignal: AbortSignal,
  postResponseTasks: PostResponseTask[],
) {
  const encoder = new TextEncoder();
  const workController = new AbortController();
  const abortWork = () => {
    if (!workController.signal.aborted) {
      workController.abort(
        requestSignal.reason ||
          new DOMException("Kết nối đã đóng.", "AbortError"),
      );
    }
  };
  requestSignal.addEventListener("abort", abortWork, { once: true });
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
          workController.signal,
          postResponseTasks,
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
        requestSignal.removeEventListener("abort", abortWork);
        if (writable) {
          writable = false;
          controller.close();
        }
      }
    },
    cancel() {
      abortWork();
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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw (
      signal.reason ||
      new DOMException("Tác vụ tạo mockup đã bị hủy.", "AbortError")
    );
  }
}

function normalizeGenerationError(error: unknown) {
  const providerError = classifyMockupGenerationError(error);
  return providerError
    ? new ApiError(providerError.message, providerError.status)
    : error;
}
