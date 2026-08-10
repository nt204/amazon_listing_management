import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function validateTrelloUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("Link ảnh Trello không hợp lệ.", 400);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    !(hostname === "trello.com" || hostname.endsWith(".trello.com"))
  ) {
    throw new ApiError("Chỉ chấp nhận link ảnh HTTPS thuộc Trello.", 400);
  }
  return url;
}

function detectImageType(bytes: Uint8Array, header: string | null) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (header && ["image/png", "image/jpeg", "image/webp"].includes(header.split(";")[0])) {
    return header.split(";")[0];
  }
  throw new ApiError("Tệp Trello không phải ảnh PNG, JPG hoặc WEBP.", 400);
}

function safeFilename(url: URL, contentType: string) {
  const source = decodeURIComponent(url.pathname.split("/").pop() || "product-image");
  const stem = source.replace(/\.[A-Za-z0-9]+$/, "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  const extension = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  return `${stem || "product-image"}${extension}`;
}

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const requested = new URL(request.url).searchParams.get("url") || "";
    let current = validateTrelloUrl(requested);
    let response: Response | undefined;

    for (let redirect = 0; redirect <= 5; redirect += 1) {
      response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: request.signal,
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        },
      });
      if (!REDIRECT_STATUSES.has(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new ApiError("Trello chuyển hướng nhưng không trả về địa chỉ ảnh.", 502);
      current = validateTrelloUrl(new URL(location, current).toString());
      response = undefined;
    }

    if (!response) throw new ApiError("Link ảnh Trello chuyển hướng quá nhiều lần.", 502);
    if (!response.ok) throw new ApiError(`Không tải được ảnh Trello (HTTP ${response.status}).`, 400);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new ApiError("Ảnh Trello vượt quá 12 MB.", 413);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError("Ảnh Trello vượt quá 12 MB.", 413);
    const contentType = detectImageType(bytes, response.headers.get("content-type"));
    const filename = safeFilename(current, contentType);
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải ảnh từ Trello.");
  }
}
