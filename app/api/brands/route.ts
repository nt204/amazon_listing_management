import { NextResponse } from "next/server";
import { listBrandProfiles, saveBrandProfile } from "@/lib/db";
import { brandProfileSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ brands: await listBrandProfiles() });
}

export async function POST(request: Request) {
  try {
    const { name, guidelines } = brandProfileSchema.parse(await request.json());
    return NextResponse.json(
      { brand: await saveBrandProfile(name, guidelines) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save brand profile." },
      { status: 400 },
    );
  }
}
