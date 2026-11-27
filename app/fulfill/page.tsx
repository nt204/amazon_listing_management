import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveActorFromHeaders } from "@/lib/auth-server";
import { AccessStatusScreen } from "@/components/access-status-screen";
import { FulfillPortal } from "@/components/fulfill/fulfill-portal";
import { canAccessFulfill } from "@/lib/fulfill/access";

export const metadata: Metadata = {
  title: "Fulfill | FBA Production and Shipments",
  description: "Track FBA production, supplier payments, and shipments.",
};

export default async function FulfillPage() {
  const headerStore = await headers();
  const { actor, status, email } = await resolveActorFromHeaders(headerStore);

  if (status !== "approved" || !actor) {
    return <AccessStatusScreen status={status} email={email} />;
  }

  // Tạm khoá để phát triển: chỉ email trong FULFILL_ALLOWED_EMAILS (lib/fulfill/access.ts)
  if (!canAccessFulfill(actor)) {
    return <AccessStatusScreen status="no_features" email={email} />;
  }

  return (
    <div lang="en" className="fulfill-root min-h-dvh">
      <FulfillPortal actor={actor} />
    </div>
  );
}
