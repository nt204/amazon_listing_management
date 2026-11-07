import "server-only";

import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const MIN_COMPRESS_BYTES = 2048;

/**
 * Response JSON nén gzip khi trình duyệt nhận gzip. Log nginx cho thấy JSON của route handler đi ra không nén
 * (VD /api/ppc/sku-economics 3,3 MB = đúng kích thước JSON gốc), trong khi JSON lặp tên trường mỗi dòng
 * nén được ~10 lần. Next / nginx / Cloudflare thấy Content-Encoding đã có thì không nén lại.
 * Nén bằng threadpool của zlib (không chặn event loop như gzipSync).
 */
export async function compressedJson(request: Request, data: unknown, init: ResponseInit = {}): Promise<Response> {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.append("Vary", "Accept-Encoding");

  const acceptsGzip = /\bgzip\b/i.test(request.headers.get("accept-encoding") || "");
  if (!acceptsGzip || Buffer.byteLength(body) < MIN_COMPRESS_BYTES) {
    return new Response(body, { ...init, headers });
  }
  const compressed = await gzipAsync(body, { level: 5 });
  headers.set("Content-Encoding", "gzip");
  headers.set("Content-Length", String(compressed.byteLength));
  return new Response(new Uint8Array(compressed), { ...init, headers });
}
