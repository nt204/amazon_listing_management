import { NextResponse } from "next/server";
import { listBrandProfiles, saveBrandProfile } from "@/lib/db";
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
