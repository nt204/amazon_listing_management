import type { ListingInput } from "@/lib/types";

export async function prepareImageUpload(file: File): Promise<ListingInput["images"][number]> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    type: file.type,
    data_url: dataUrl,
  };
}

/**
 * Chuyển đổi URL hình ảnh (Amazon CDN, Trello, Google Drive, R2, S3...)
 * thành thumbnail kích thước nhỏ đã được downscale tối ưu để giảm lag và tải tức thì.
 */
export function getOptimizedThumbnailUrl(url: string | null | undefined, w = 64): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // 1. Amazon CDN image resizing (cực nhanh, ~2KB, không tốn tài nguyên server)
  if (trimmed.includes("media-amazon.com") || trimmed.includes("images-amazon.com")) {
    if (/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    if (/\/images\/I\/[A-Za-z0-9%_+-]+\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    return trimmed;
  }

  // 2. Các nguồn khác (Trello, Google Drive, S3, R2...): nén WebP kích thước w qua mockup-proxy
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/accounting/inventory/mockup-proxy?w=${w}&url=${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}
