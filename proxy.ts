import { NextResponse, type NextRequest } from "next/server";

import { frameAncestorsFor, widgetCsp } from "@/lib/server/widget-csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/widget/")) {
    const id = decodeURIComponent(pathname.slice("/widget/".length).split("/")[0] ?? "");
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", widgetCsp(await frameAncestorsFor(id)));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/",
    "/app",
    "/app/:path*",
    "/workspace/:path*",
    "/login",
    "/auth/:path*",
    "/widget/:path*",
  ],
};
