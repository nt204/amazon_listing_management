import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessStatusScreen } from "@/components/access-status-screen";
import { ListingWorkspace } from "@/components/listing-workspace";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { DEFAULT_UI_PREFERENCES, getUiPreferences } from "@/lib/ui-preferences";

type WorkspaceView = "listing" | "mockups" | "sellersprite" | "ppc" | "accounting" | "kanban" | "fulfill";

function resolveAllowedView(
  candidateView: string | string[] | undefined,
  allowedFeatures: string[] = ["listing", "mockups", "sellersprite", "ppc", "accounting", "fulfill"],
): WorkspaceView | null {
  const candidate = (Array.isArray(candidateView) ? candidateView[0] : candidateView) as WorkspaceView;
  const validViews: WorkspaceView[] = ["listing", "mockups", "sellersprite", "ppc", "accounting", "kanban", "fulfill"];

  // Cho phép view kanban và fulfill cho người dùng được cấp quyền hoặc admin
  if (candidate === "kanban" || candidate === "fulfill") {
    return candidate;
  }

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
    (actor.role === "admin" ? ["listing", "mockups", "sellersprite", "ppc", "accounting"] : []);

  if (features.length === 0) {
    return <AccessStatusScreen status="no_features" email={email} />;
  }

  const host = headerStore.get("host") || "";
  const search = await searchParams;
  if (search.view === "fulfill" || host.startsWith("fulfill.")) {
    redirect("/fulfill");
  }
  let initialView = resolveAllowedView(search.view, features);
  if (!initialView) {
    initialView = "listing";
  }

  const uiPreferences = await getUiPreferences(actor).catch(() => DEFAULT_UI_PREFERENCES);

  return <ListingWorkspace actor={actor} initialView={initialView} initialSidebarDark={uiPreferences.sidebarDark} />;
}
