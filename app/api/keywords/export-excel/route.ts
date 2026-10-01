import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api-guard";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      productTitle?: string;
      keywordParts?: Array<{
        partNumber: number;
        name: string;
        totalVolume: number;
        keywords: Array<{
          keyword: string;
          type: string;
          relevance: number;
          search_volume?: number | null;
          organic_rank?: number | null;
          cpc?: number | null;
        }>;
      }>;
      negativeCandidates?: Array<{
        keyword: string;
        type: string;
        relevance: number;
        search_volume?: number | null;
        cpc?: number | null;
      }>;
    };

    const productTitle = String(body.productTitle || "Amazon_Keywords").trim();
    const keywordParts = Array.isArray(body.keywordParts) ? body.keywordParts : [];
    const negativeCandidates = Array.isArray(body.negativeCandidates) ? body.negativeCandidates : [];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Amazon Listing Management";
    workbook.created = new Date();

    // 1. MASTER SHEET: Tổng Hợp Toàn Bộ Từ Khóa
    const masterSheet = workbook.addWorksheet("Tổng Hợp Tất Cả");
    masterSheet.columns = [
      { header: "Part / Nhóm", key: "part", width: 24 },
      { header: "Từ Khóa", key: "keyword", width: 32 },
      { header: "Phân Loại", key: "type", width: 16 },
      { header: "Relevance (%)", key: "relevance", width: 15 },
      { header: "Search Volume", key: "volume", width: 16 },
      { header: "Rank Organic", key: "rank", width: 14 },
      { header: "CPC ($)", key: "cpc", width: 12 },
      { header: "Negative?", key: "negative", width: 14 },
    ];

    // Master Header styling (Indigo)
    const masterHeaderRow = masterSheet.getRow(1);
    masterHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    masterHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4338CA" }, // Indigo-700
    };
    masterHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
    masterHeaderRow.height = 26;

    // Add Parts keywords
    for (const part of keywordParts) {
      for (const k of part.keywords) {
        masterSheet.addRow({
          part: part.name,
          keyword: k.keyword,
          type: k.type,
          relevance: k.relevance,
          volume: k.search_volume || 0,
          rank: k.organic_rank ? `#${k.organic_rank}` : "—",
          cpc: k.cpc ? `$${k.cpc.toFixed(2)}` : "—",
          negative: "Hợp Lệ",
        });
      }
    }

    // Add Negative keywords to master
    for (const k of negativeCandidates) {
      masterSheet.addRow({
        part: "Negative Candidates",
        keyword: k.keyword,
        type: k.type === "WRONG_PRODUCT" ? "Sai Sản Phẩm" : "AI Phủ Định",
        relevance: k.relevance,
        volume: k.search_volume || 0,
        rank: "—",
        cpc: k.cpc ? `$${k.cpc.toFixed(2)}` : "—",
        negative: "CÓ (Phủ Định)",
      });
    }

    // Format numbers
    masterSheet.getColumn("volume").numFmt = "#,##0";
    masterSheet.getColumn("relevance").numFmt = '0"%"';

    // 2. INDIVIDUAL SHEETS PER PART
    for (const part of keywordParts) {
      const cleanSheetName = part.name.slice(0, 31).replace(/[:\\\/\?\*\[\]]/g, "_");
      const sheet = workbook.addWorksheet(cleanSheetName);
      sheet.columns = [
        { header: "#", key: "idx", width: 6 },
        { header: "Từ Khóa", key: "keyword", width: 32 },
        { header: "Phân Loại", key: "type", width: 16 },
        { header: "Relevance (%)", key: "relevance", width: 15 },
        { header: "Search Volume", key: "volume", width: 16 },
        { header: "Rank Organic", key: "rank", width: 14 },
        { header: "CPC ($)", key: "cpc", width: 12 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF059669" }, // Emerald-600
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 26;

      sheet.getColumn("volume").numFmt = "#,##0";
      sheet.getColumn("relevance").numFmt = '0"%"';

      part.keywords.forEach((k, idx) => {
        sheet.addRow({
          idx: idx + 1,
          keyword: k.keyword,
          type: k.type,
          relevance: k.relevance,
          volume: k.search_volume || 0,
          rank: k.organic_rank ? `#${k.organic_rank}` : "—",
          cpc: k.cpc ? `$${k.cpc.toFixed(2)}` : "—",
        });
      });
    }

    // 3. NEGATIVE SHEET
    if (negativeCandidates.length > 0) {
      const negSheet = workbook.addWorksheet("Negative Candidates");
      negSheet.columns = [
        { header: "#", key: "idx", width: 6 },
        { header: "Từ Khóa Negative", key: "keyword", width: 32 },
        { header: "Lý Do Nhận Diện", key: "reason", width: 20 },
        { header: "Search Volume", key: "volume", width: 16 },
        { header: "CPC ($)", key: "cpc", width: 12 },
      ];

      const negHeaderRow = negSheet.getRow(1);
      negHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      negHeaderRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE11D48" }, // Rose-600
      };
      negHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
      negHeaderRow.height = 26;

      negSheet.getColumn("volume").numFmt = "#,##0";

      negativeCandidates.forEach((k, idx) => {
        negSheet.addRow({
          idx: idx + 1,
          keyword: k.keyword,
          reason: k.type === "WRONG_PRODUCT" ? "Sai Loại Sản Phẩm" : "AI Flagged",
          volume: k.search_volume || 0,
          cpc: k.cpc ? `$${k.cpc.toFixed(2)}` : "—",
        });
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const cleanFileName = productTitle.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, "_").slice(0, 35);
    const fileName = `${cleanFileName}_Keyword_Parts.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Export Excel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi xuất file Excel." },
      { status: 500 }
    );
  }
}
