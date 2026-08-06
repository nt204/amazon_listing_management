import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/eng"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
