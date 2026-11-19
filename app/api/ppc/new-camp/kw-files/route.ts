import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getKwFile, searchKwFiles } from "@/lib/ppc/new-camp-db";
import { createKeywordTemplate } from "@/lib/ppc/new-camp-generator";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET ?query=… tìm file keyword đã lưu; GET ?id=… tải file về. */
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const params = new URL(request.url).searchParams;
    if (params.has("template")) {
      return new Response(new Uint8Array(await createKeywordTemplate()), {
        headers: {
          "Content-Type": XLSX_TYPE,
          "Content-Disposition": `attachment; filename="Mau_file_keyword_Chia_Part.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const id = Number(params.get("id"));
    if (params.has("id")) {
      if (!Number.isInteger(id) || id <= 0) throw new ApiError("ID file không hợp lệ.", 400);
      const file = await getKwFile(actor.teamId, id);
      if (!file) throw new ApiError("Không tìm thấy file keyword.", 404);
      return new Response(new Uint8Array(file.data), {
        headers: {
          "Content-Type": XLSX_TYPE,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const query = (params.get("query") || "").trim();
    if (query.length < 2) return Response.json({ success: true, data: [] });
    return Response.json({ success: true, data: await searchKwFiles(actor.teamId, query) });
  } catch (error) {
    return routeErrorResponse(error, "Không tìm được file keyword.", 500);
  }
}
