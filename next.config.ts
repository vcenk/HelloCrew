import type { NextConfig } from "next";

const commonSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const frameDeniedRoutes = [
  "/",
  "/app",
  "/login",
  "/workspace",
  "/widget-test",
  "/auth/:path*",
  "/api/:path*",
];


const config: NextConfig = {
  poweredByHeader: false,
  // Loaded at runtime on the server rather than bundled (PDF reading).
  serverExternalPackages: ["unpdf"],
  // Allow opening the dev server as 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: commonSecurityHeaders,
      },
      // Website chat pages get their CSP (including which sites may embed
      // them) from proxy.ts; everything else may never be framed.
      {
        source: "/((?!widget/).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      ...frameDeniedRoutes.map((source) => ({
        source,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      })),
      {
        source: "/widget/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
