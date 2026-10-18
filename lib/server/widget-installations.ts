import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAgentContext } from "@/lib/agent/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  getWidgetInstallation as getDemoInstallation,
  PUBLIC_WIDGET_ID,
  type WidgetInstallation,
} from "@/lib/widget";

export type PublicInstallation = WidgetInstallation & {
  tenantId: string;
  allowedOrigins: string[];
};

export function newPublicWidgetId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(20);
  return `w-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

export function newVisitorToken() {
  return randomBytes(32).toString("base64url");
}

export function hashVisitorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Service-role client for anonymous website traffic, or null when the server
// has no secret key (the widget then only serves the public demo).
export function widgetAdminClient(): SupabaseClient | null {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret || !isSupabaseConfigured()) return null;
  return createAdminClient(secret);
}

const cache = new Map<string, { at: number; value: PublicInstallation | null }>();
const CACHE_MS = 30_000;

// Loads an enabled installation with the workspace's identity and knowledge.
export async function loadPublicInstallation(
  publicId: string,
  admin = widgetAdminClient(),
): Promise<PublicInstallation | null> {
  if (!PUBLIC_WIDGET_ID.test(publicId) || !admin) return null;
  const hit = cache.get(publicId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const { data } = await admin
    .from("hc_widget_installations")
    .select("tenant_id, public_id, allowed_origins, enabled")
    .eq("public_id", publicId)
    .maybeSingle();
  let value: PublicInstallation | null = null;
  if (data?.enabled) {
    const context = await loadAgentContext(admin, { tenantId: data.tenant_id as string });
    const questions = [
      "When are you open?",
      context.business.services[0] ? `How much is ${context.business.services[0].name.toLowerCase()}?` : null,
      context.business.faqs[0]?.question ?? null,
    ].filter((q): q is string => Boolean(q));
    value = {
      id: publicId,
      mode: "workspace",
      tenantId: data.tenant_id as string,
      allowedOrigins: (data.allowed_origins as string[]) ?? [],
      business: context.business,
      identity: context.identity,
      modelProvider: "practice",
      suggestedQuestions: questions.slice(0, 3),
    };
  }
  cache.set(publicId, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

export function forgetInstallation(publicId: string) {
  cache.delete(publicId);
}

export async function loadWidgetPage(publicId: string) {
  const demo = getDemoInstallation(publicId);
  if (demo) return demo;
  return loadPublicInstallation(publicId);
}
