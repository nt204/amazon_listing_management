import { headers } from "next/headers";
import { ListingWorkspace } from "@/components/listing-workspace";
import { LoginScreen } from "@/components/login-screen";
import { actorFromCookieHeader, isAuthenticationRequired } from "@/lib/auth";

type WorkspaceView = "listing" | "mockups" | "sellersprite" | "ppc";

function workspaceView(value: string | string[] | undefined): WorkspaceView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "mockups" || candidate === "sellersprite" || candidate === "ppc"
    ? candidate
    : "listing";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const headerStore = await headers();
  const actor = actorFromCookieHeader(headerStore.get("cookie"));
  if (isAuthenticationRequired() && !actor) return <LoginScreen />;
  if (!actor) return <LoginScreen />;
  const initialView = workspaceView((await searchParams).view);
  return <ListingWorkspace actor={actor} initialView={initialView} />;
}
