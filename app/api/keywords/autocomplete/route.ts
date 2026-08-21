import { NextResponse } from "next/server";
import { getCategorizedAutocompleteSeeds } from "@/lib/amazon-autocomplete";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = String(body?.query || "").trim();
    const marketplace = String(body?.marketplace || "US").toUpperCase();

    if (!query) {
      return NextResponse.json(
        { error: "Vui lòng nhập Keyword chính hoặc tên sản phẩm để trích xuất seed." },
        { status: 400 }
      );
    }

    const result = await getCategorizedAutocompleteSeeds(query, marketplace);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch autocomplete seeds:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không thể lấy gợi ý từ Amazon Autocomplete.",
      },
      { status: 500 }
    );
  }
}
