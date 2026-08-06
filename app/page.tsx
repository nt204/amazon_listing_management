import { headers } from "next/headers";
import { ListingWorkspace } from "@/components/listing-workspace";
import { LoginScreen } from "@/components/login-screen";
import { actorFromCookieHeader, isAuthenticationRequired } from "@/lib/auth";

export default async function Home() {
  if (isAuthenticationRequired()) {
    const headerStore = await headers();
    if (!actorFromCookieHeader(headerStore.get("cookie"))) return <LoginScreen />;
  }
  return <ListingWorkspace />;
}
