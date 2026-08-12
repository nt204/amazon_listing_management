import { z } from "zod";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { detectRasterImageMimeType } from "@/lib/image-processing";
import {
  assertTrelloAttachmentUrl,
  downloadTrelloAttachment,
} from "@/lib/trello";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().min(1),
  name: z.string().trim().max(255).optional(),
  apiKey: z.string().optional(),
  token: z.string().optional(),
});

function downloadFilename(name: string | undefined, mimeType: string) {
  const extension =
    mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const stem = (name || "mockup")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150) || "mockup";
  return `${stem}${extension}`;
}

export async function POST(request: Request) {
  try {
    authorize(request, "read");
    const input = requestSchema.parse(await request.json());
    const url = assertTrelloAttachmentUrl(input.url);
    const apiKey = input.apiKey || process.env.TRELLO_API_KEY || "";
    const token = input.token || process.env.TRELLO_TOKEN || "";
    if (!apiKey || !token) {
      return Response.json(
        { error: "Thiếu Trello API Key hoặc Token để tải ảnh gốc." },
        { status: 400 },
      );
    }
    const bytes = await downloadTrelloAttachment(url, apiKey, token, 25_000_000);
    const mimeType = detectRasterImageMimeType(bytes);
    const filename = downloadFilename(input.name, mimeType);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải ảnh gốc từ Trello.", 500);
  }
}
