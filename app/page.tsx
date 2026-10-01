import { headers } from "next/headers";
import { AccessStatusScreen } from "@/components/access-status-screen";
import { ListingWorkspace } from "@/components/listing-workspace";
import { resolveActorFromHeaders } from "@/lib/auth-server";

type WorkspaceView = "listing" | "mockups" | "sellersprite" | "ppc";

function resolveAllowedView(
  candidateView: string | string[] | undefined,
  allowedFeatures: string[] = ["listing", "mockups", "sellersprite", "ppc"],
): WorkspaceView | null {
  const candidate = (Array.isArray(candidateView) ? candidateView[0] : candidateView) as WorkspaceView;
  const validViews: WorkspaceView[] = ["listing", "mockups", "sellersprite", "ppc"];

  // Nếu người dùng chọn một view hợp lệ và có quyền, cho phép
  if (candidate && validViews.includes(candidate) && allowedFeatures.includes(candidate)) {
    return candidate;
  }

  // Nếu không, tìm view đầu tiên mà người dùng có quyền
  for (const view of validViews) {
    if (allowedFeatures.includes(view)) return view;
  }

  return null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const headerStore = await headers();
  const { actor, status, email } = await resolveActorFromHeaders(headerStore);

  if (status !== "approved" || !actor) {
    return <AccessStatusScreen status={status} email={email} />;
  }

  const features = actor.allowedFeatures ??
    (actor.role === "admin" ? ["listing", "mockups", "sellersprite", "ppc"] : []);

  if (features.length === 0) {
    return <AccessStatusScreen status="no_features" email={email} />;
  }

  const initialView = resolveAllowedView((await searchParams).view, features) || "listing";

  return <ListingWorkspace actor={actor} initialView={initialView} />;
}
