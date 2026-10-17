import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantLimits = {
  liveAiEnabled: boolean;
  monthlyBudgetMicroUsd: number;
};

export async function getTenantLimits(
  admin: SupabaseClient,
  tenantId: string,
): Promise<TenantLimits> {
  const { data, error } = await admin
    .from("hc_tenant_limits")
    .select("live_ai_enabled, monthly_budget_micro_usd")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("Could not read workspace limits.");
  return {
    liveAiEnabled: Boolean(data?.live_ai_enabled),
    monthlyBudgetMicroUsd: Number(data?.monthly_budget_micro_usd ?? 5_000_000),
  };
}

export async function setLiveAiEnabled(
  admin: SupabaseClient,
  tenantId: string,
  enabled: boolean,
) {
  const { error } = await admin.from("hc_tenant_limits").upsert(
    {
      tenant_id: tenantId,
      live_ai_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error("Could not update live AI setting.");
}

export async function monthSpendMicroUsd(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("hc_month_spend", {
    p_tenant_id: tenantId,
  });
  if (error) throw new Error("Could not read usage.");
  return Number(data ?? 0);
}

export async function reserveUsage(
  admin: SupabaseClient,
  tenantId: string,
  requestId: string,
  worstCaseMicroUsd: number,
  platformCapMicroUsd: bigint,
): Promise<string | null> {
  const { data, error } = await admin.rpc("hc_reserve_usage", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
    p_worst_case_micro_usd: worstCaseMicroUsd,
    p_platform_cap_micro_usd: Number(platformCapMicroUsd),
  });
  if (error) throw new Error("Could not reserve usage.");
  return (data as string | null) ?? null;
}

// actualMicroUsd null => outcome unknown; the reservation stays fully charged.
export async function settleUsage(
  admin: SupabaseClient,
  tenantId: string,
  reservationId: string,
  actualMicroUsd: number | null,
) {
  await admin.rpc("hc_settle_usage", {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    p_actual_micro_usd: actualMicroUsd,
  });
}
