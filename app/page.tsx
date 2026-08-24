import { headers } from "next/headers";
import { ListingWorkspace } from "@/components/listing-workspace";
import { LoginScreen } from "@/components/login-screen";
import { actorFromCookieHeader, isAuthenticationRequired } from "@/lib/auth";

export default async function Home() {
  const headerStore = await headers();
  const actor = actorFromCookieHeader(headerStore.get("cookie"));
  if (isAuthenticationRequired() && !actor) return <LoginScreen />;
  if (!actor) return <LoginScreen />;
  return <ListingWorkspace actor={actor} />;
}
