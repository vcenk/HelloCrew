import type { NextConfig } from "next";

const commonSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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

const widgetScriptSources =
  process.env.NODE_ENV === "development"
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";

const config: NextConfig = {
  poweredByHeader: false,
  // Allow opening the dev server as 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: commonSecurityHeaders,
      },
      ...frameDeniedRoutes.map((source) => ({
        source,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      })),
      {
        source: "/widget/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src ${widgetScriptSources}; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors *; base-uri 'none'; form-action 'none'`,
          },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
