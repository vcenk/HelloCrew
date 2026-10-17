import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// The owner workspace now lives in the dashboard; keep this URL as an entry point.
export default async function WorkspacePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  redirect("/app");
}
