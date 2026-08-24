import { setAppSetting, getAppSetting } from "@/lib/db";

export interface Helium10Config {
  cookies: string;
  updatedAt: string;
  status: "configured" | "not_configured" | "expired";
  lastTestedAt?: string;
}

export function parseHelium10Cookies(raw: string): Array<{ name: string; value: string }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // 1. Check if JSON array
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: Record<string, unknown>) => {
            const name = String(item.name || "").trim();
            const value = String(item.value || "").trim();
            return name && value ? { name, value } : null;
          })
          .filter(Boolean) as Array<{ name: string; value: string }>;
      }
    } catch {}
  }

  // 2. Cookie header format (key=value; key2=val2)
  return trimmed
    .split(";")
    .map((pair) => {
      const [k, ...v] = pair.trim().split("=");
      if (!k || v.length === 0) return null;
      return { name: k.trim(), value: v.join("=").trim() };
    })
    .filter(Boolean) as Array<{ name: string; value: string }>;
}

export function buildHelium10CookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function getHelium10Config(): Promise<Helium10Config> {
  try {
    const setting = await getAppSetting("helium10_config");
    if (setting && typeof setting === "object" && "cookies" in setting) {
      return setting as unknown as Helium10Config;
    }
  } catch {}

  const envCookie = process.env.HELIUM10_COOKIES?.trim();
  if (envCookie) {
    return {
      cookies: envCookie,
      updatedAt: new Date().toISOString(),
      status: "configured",
    };
  }

  return {
    status: "not_configured",
    cookies: "",
    updatedAt: new Date().toISOString(),
  };
}

export async function saveHelium10Cookies(rawCookies: string): Promise<Helium10Config> {
  const parsed = parseHelium10Cookies(rawCookies);
  if (parsed.length === 0) {
    throw new Error("Format cookie không hợp lệ. Vui lòng dán chuỗi JSON cookie hoặc chuỗi header key=value.");
  }

  const config: Helium10Config = {
    cookies: rawCookies.trim(),
    updatedAt: new Date().toISOString(),
    status: "configured",
    lastTestedAt: new Date().toISOString(),
  };

  await setAppSetting("helium10_config", config as unknown as Record<string, unknown>);
  return config;
}
