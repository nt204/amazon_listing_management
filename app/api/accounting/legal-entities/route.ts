import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { createLegalEntity, listLegalEntities } from "@/lib/accounting/accounting-db";

const legalEntitySchema = z.object({
  name: z.string().trim().min(1, "Legal Entity name is required").max(100),
  country: z.string().trim().min(1, "Country is required").max(100).default("United States"),
  status: z.enum(["active", "inactive"]).default("active"),
});

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const entities = await listLegalEntities();
    return Response.json({ entities });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load legal entities.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const body = await readJsonBody(request, 10_000);
    const parsed = legalEntitySchema.parse(body);
    const entity = await createLegalEntity(parsed);
    return Response.json({ entity }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Failed to create legal entity.");
  }
}
