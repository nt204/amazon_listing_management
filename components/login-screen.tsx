"use client";

import { AccessStatusScreen } from "@/components/access-status-screen";

export function LoginScreen() {
  return <AccessStatusScreen status="unauthenticated" email={null} />;
}
