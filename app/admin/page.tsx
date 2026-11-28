import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { getSystemSchedules } from "@/lib/admin/system-schedules";
import { resolveActorFromHeaders } from "@/lib/auth-server";

export default async function AdminPage() {
  const headerStore = await headers();
  const { actor } = await resolveActorFromHeaders(headerStore);

  if (!actor || actor.role !== "admin") {
    redirect("/");
  }

  return <AdminConsole actor={actor} schedules={getSystemSchedules()} />;
}
