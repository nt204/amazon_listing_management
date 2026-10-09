import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { deleteLegalEntity, updateLegalEntity } from "@/lib/accounting/accounting-db";

const updateLegalEntitySchema = z.object({
  name: z.string().trim().min(1, "Legal Entity name is required").max(100).optional(),
  country: z.string().trim().min(1, "Country is required").max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    await authorize(request, "write", "accounting");
    const { id } = await params;
    const body = await readJsonBody(request, 10_000);
    const parsed = updateLegalEntitySchema.parse(body);
    const updated = await updateLegalEntity(id, parsed);
    if (!updated) {
      return Response.json({ error: "Legal entity not found." }, { status: 404 });
    }
    return Response.json({ entity: updated });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update legal entity.");
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await authorize(request, "write", "accounting");
    const { id } = await params;
    const success = await deleteLegalEntity(id);
    if (!success) {
      return Response.json({ error: "Legal entity not found or could not be deleted." }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete legal entity.");
  }
}
