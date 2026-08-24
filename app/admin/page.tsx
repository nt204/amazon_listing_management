import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromCookieHeader } from "@/lib/auth";
import { AdminConsole } from "@/components/admin-console";

export default async function AdminPage() {
  const headerStore = await headers();
  const actor = actorFromCookieHeader(headerStore.get("cookie"));
  if (!actor) redirect("/");
  if (actor.role !== "admin") redirect("/");
  return <AdminConsole actor={actor} />;
}
