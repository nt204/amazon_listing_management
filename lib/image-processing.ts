import sharp, { type Metadata } from "sharp";
import type { ListingInput } from "@/lib/types";

const DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const AI_MAX_DIMENSION = 1_600;
const AI_JPEG_QUALITY = 82;
const PREVIEW_MAX_DIMENSION = 640;
const PREVIEW_WEBP_QUALITY = 78;
export const IMAGE_DERIVATIVE_VERSION = "1";

export interface StoredImageDerivatives {
  originalBytes: Buffer;
  originalMimeType: string;
  originalName: string;
  width: number | null;
  height: number | null;
  aiBytes: Buffer;
  aiMimeType: string;
  previewBytes: Buffer;
  previewMimeType: string;
  previewWidth: number | null;
  previewHeight: number | null;
}

export function parseImageDataUrl(value: string) {
  const match = value.match(DATA_URL_PATTERN);
  if (!match) throw new Error("Dữ liệu ảnh phải là PNG, JPEG hoặc WEBP hợp lệ.");
  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

export function detectRasterImageMimeType(bytes: Uint8Array): string {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  throw new Error("Tệp không phải ảnh PNG, JPEG hoặc WEBP hợp lệ.");
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function filenameForMimeType(name: string, mimeType: string) {
  const stem = name.replace(/\.[A-Za-z0-9]+$/, "").trim() || "product-image";
  return `${stem}${extensionForMimeType(mimeType)}`;
}

function orientedDimensions(metadata: Metadata) {
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
  return {
    width: rotated ? metadata.height || null : metadata.width || null,
    height: rotated ? metadata.width || null : metadata.height || null,
  };
}

export async function createAiImageDerivative(bytes: Buffer) {
  const output = await sharp(bytes, { failOn: "warning" })
    .rotate()
    .resize({
      width: AI_MAX_DIMENSION,
      height: AI_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({
      quality: AI_JPEG_QUALITY,
      chromaSubsampling: "4:4:4",
      mozjpeg: true,
    })
    .toBuffer();
  return {
    bytes: output,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${output.toString("base64")}`,
  };
}

/**
 * Keeps the exact upload as the master while giving OCR/AI a bounded derivative.
 * The master is never resized or re-encoded.
 */
export async function prepareListingImagesForAi(input: ListingInput): Promise<ListingInput> {
  return {
    ...input,
    images: await Promise.all(
      input.images.map(async (image) => {
        const masterDataUrl = image.original_data_url || image.data_url;
        const master = parseImageDataUrl(masterDataUrl);
        const detectedMimeType = detectRasterImageMimeType(master.bytes);
        const optimized = await createAiImageDerivative(master.bytes);
        return {
          ...image,
          name: filenameForMimeType(image.name, detectedMimeType),
          type: optimized.mimeType,
          data_url: optimized.dataUrl,
          original_data_url: masterDataUrl,
        };
      }),
    ),
  };
}

export async function createStoredImageDerivatives(
  image: ListingInput["images"][number],
): Promise<StoredImageDerivatives> {
  const original = parseImageDataUrl(image.original_data_url || image.data_url);
  const originalMimeType = detectRasterImageMimeType(original.bytes);
  const metadata = await sharp(original.bytes, { failOn: "warning" }).metadata();
  const dimensions = orientedDimensions(metadata);

  const ai = parseImageDataUrl(image.data_url);
  const aiMimeType = detectRasterImageMimeType(ai.bytes);
  const preview = await sharp(original.bytes, { failOn: "warning" })
    .rotate()
    .resize({
      width: PREVIEW_MAX_DIMENSION,
      height: PREVIEW_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PREVIEW_WEBP_QUALITY, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  return {
    originalBytes: original.bytes,
    originalMimeType,
    originalName: filenameForMimeType(image.name, originalMimeType),
    width: dimensions.width,
    height: dimensions.height,
    aiBytes: ai.bytes,
    aiMimeType,
    previewBytes: preview.data,
    previewMimeType: "image/webp",
    previewWidth: preview.info.width,
    previewHeight: preview.info.height,
  };
}
