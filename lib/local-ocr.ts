import "server-only";

import Tesseract from "tesseract.js";
import englishData from "@tesseract.js-data/eng";
import { consolidateOcrLines, parseOcrTextFallback, parseOcrTsv } from "@/lib/ocr";
import { getRuleProfile } from "@/lib/rules";
import type { ListingInput } from "@/lib/types";
import type { LocalOcrResult, OcrLine } from "@/lib/ocr";

function environmentBoolean(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function environmentNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function imageBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Unsupported OCR image payload.");
  return Buffer.from(match[1], "base64");
}

function emptyResult(
  language: string,
  status: LocalOcrResult["status"],
  warnings: string[] = [],
): LocalOcrResult {
  return {
    engine: "tesseract",
    language,
    status,
    imagesProcessed: 0,
    lines: [],
    warnings,
  };
}

export async function extractLocalOcr(
  input: ListingInput,
  signal?: AbortSignal,
): Promise<LocalOcrResult> {
  const configured = getRuleProfile(input).ocr;
  const enabled = environmentBoolean(process.env.LOCAL_OCR_ENABLED, configured.enabled);
  const language = process.env.LOCAL_OCR_LANGUAGE?.trim() || configured.language;
  const pageSegmentationNames = [...new Set(
    process.env.LOCAL_OCR_PAGE_SEGMENTATION_MODE?.trim()
      ? [process.env.LOCAL_OCR_PAGE_SEGMENTATION_MODE.trim()]
      : [configured.page_segmentation_mode, ...configured.additional_page_segmentation_modes],
  )];
  const pageSegmentations = pageSegmentationNames.map((name) => ({
    name,
    value: Tesseract.PSM[name as keyof typeof Tesseract.PSM],
  }));
  if (!enabled) return emptyResult(language, "disabled");
  if (signal?.aborted) throw signal.reason || new Error("OCR cancelled.");

  const customLanguagePath = process.env.LOCAL_OCR_LANGUAGE_PATH?.trim();
  if (!customLanguagePath && language !== englishData.code) {
    return emptyResult(language, "failed", [
      `OCR language '${language}' requires LOCAL_OCR_LANGUAGE_PATH with matching trained data.`,
    ]);
  }
  if (pageSegmentations.some((mode) => !mode.value)) {
    return emptyResult(language, "failed", [
      `Unsupported OCR page segmentation mode '${pageSegmentations.find((mode) => !mode.value)?.name}'.`,
    ]);
  }

  const maximumImages = Math.min(input.images.length, Math.floor(environmentNumber(
    process.env.LOCAL_OCR_MAX_IMAGES,
    configured.maximum_images,
    1,
    input.images.length,
  )));
  const timeoutMs = environmentNumber(
    process.env.LOCAL_OCR_TIMEOUT_MS,
    configured.timeout_ms,
    1_000,
    120_000,
  );
  const recognitionRules = {
    ...configured,
    minimum_word_confidence: environmentNumber(
      process.env.LOCAL_OCR_MIN_WORD_CONFIDENCE,
      configured.minimum_word_confidence,
      0,
      100,
    ),
    minimum_line_confidence: environmentNumber(
      process.env.LOCAL_OCR_MIN_LINE_CONFIDENCE,
      configured.minimum_line_confidence,
      0,
      100,
    ),
  };
  const images = input.images.slice(0, maximumImages);
  const warnings: string[] = [];
  const lines: OcrLine[] = [];
  const processedImages = new Set<number>();
  let worker: Tesseract.Worker | undefined;
  let workerPromise: Promise<Tesseract.Worker> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const terminate = () => {
    if (worker) return worker.terminate().catch(() => undefined);
    workerPromise?.then((created) => created.terminate()).catch(() => undefined);
    return Promise.resolve();
  };

  const work = async () => {
    workerPromise = Tesseract.createWorker(
      language,
      Tesseract.OEM.LSTM_ONLY,
      {
        langPath: customLanguagePath || englishData.langPath,
        gzip: customLanguagePath
          ? environmentBoolean(process.env.LOCAL_OCR_LANGUAGE_GZIP, true)
          : englishData.gzip,
        cacheMethod: "readOnly",
      },
    );
    worker = await workerPromise;
    for (const mode of pageSegmentations) {
      await worker.setParameters({
        tessedit_pageseg_mode: mode.value,
        preserve_interword_spaces: "1",
        debug_file: "/dev/null",
      });
      for (const [index, image] of images.entries()) {
        if (signal?.aborted) throw signal.reason || new Error("OCR cancelled.");
        try {
          const recognition = await worker.recognize(
            imageBuffer(image.data_url),
            {},
            { text: true, tsv: true },
            `listing-image-${index + 1}-${mode.name.toLowerCase()}`,
          );
          processedImages.add(index + 1);
          const parsed = recognition.data.tsv
            ? parseOcrTsv(recognition.data.tsv, index + 1, recognitionRules)
            : parseOcrTextFallback(
                recognition.data.text,
                recognition.data.confidence,
                index + 1,
                recognitionRules,
              );
          lines.push(...parsed);
        } catch (error) {
          if (signal?.aborted) throw signal.reason || error;
          warnings.push(`Could not read text from image ${index + 1} with ${mode.name} segmentation.`);
        }
      }
    }

    return {
      engine: "tesseract" as const,
      language,
      status: warnings.length ? "partial" as const : "success" as const,
      imagesProcessed: processedImages.size,
      lines: consolidateOcrLines(lines, recognitionRules),
      warnings,
    };
  };

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Local OCR timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(signal?.reason || new Error("OCR cancelled."));
    signal?.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([work(), timeout, aborted]);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return {
      ...emptyResult(language, processedImages.size ? "partial" : "failed", [
        error instanceof Error && /timed out/i.test(error.message)
          ? error.message
          : "Local OCR could not complete.",
      ]),
      imagesProcessed: processedImages.size,
      lines: consolidateOcrLines(lines, recognitionRules),
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    await terminate();
  }
}
