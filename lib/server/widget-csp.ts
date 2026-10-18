import "server-only";

import { getWidgetInstallation } from "@/lib/widget";
import { loadPublicInstallation } from "./widget-installations";

const scriptSources =
  process.env.NODE_ENV === "development"
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";

export function widgetCsp(frameAncestors: string) {
  return `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'none'`;
}

// The public demo may be embedded anywhere. A workspace widget only on its
// allowed websites (and HelloCrew's own test page); unknown ids nowhere.
export async function frameAncestorsFor(installationId: string) {
  if (getWidgetInstallation(installationId)) return "*";
  const installation = await loadPublicInstallation(installationId).catch(() => null);
  if (!installation) return "'none'";
  return ["'self'", ...installation.allowedOrigins].join(" ");
}
