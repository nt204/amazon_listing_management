import { NextResponse } from "next/server";
import { deleteBrandProfile, listBrandProfiles, saveBrandProfile } from "@/lib/db";

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_brands"));
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Thiếu ID thương hiệu" }, { status: 400 });
    const success = await deleteBrandProfile(scope, id);
    return NextResponse.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa thương hiệu.");
  }
}
import { brandProfileSchema } from "@/lib/schemas";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    return NextResponse.json({ brands: await listBrandProfiles(scope) });
  } catch (error) {
    return routeErrorResponse(error, "Could not load brand profiles.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_brands"));
    const { name, guidelines } = brandProfileSchema.parse(await request.json());
    return NextResponse.json(
      { brand: await saveBrandProfile(scope, name, guidelines) },
      { status: 201 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Could not save brand profile.");
  }
}
