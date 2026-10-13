import Link from "next/link";
import { ArrowRight, Database, LogOut, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";

type Membership = {
  tenant_id: string;
  role: "owner" | "operator" | "viewer";
};

type Tenant = {
  id: string;
  name: string;
  status: "active" | "paused" | "archived";
  timezone: string;
};

export default async function WorkspacePage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) redirect("/login");

  const { data: membershipData, error: membershipError } = await supabase
    .from("hc_memberships")
    .select("tenant_id, role")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const membership = membershipData as Membership | null;

  let tenant: Tenant | null = null;
  if (membership) {
    const { data } = await supabase
      .from("hc_tenants")
      .select("id, name, status, timezone")
      .eq("id", membership.tenant_id)
      .maybeSingle();
    tenant = data as Tenant | null;
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link href="/" aria-label="HelloCrew home">
          <Brand />
        </Link>
        <form action={signOut}>
          <button className="button outline compact" type="submit">
            Sign out <LogOut size={16} />
          </button>
        </form>
      </header>
      <section className="workspace-hero">
        <span className="eyebrow">PROTECTED OWNER WORKSPACE</span>
        <h1>
          Hello, {String(claimsData.claims.email ?? "there").split("@")[0]}.
        </h1>
        <p>
          Your authenticated tenant boundary is active. Durable editor saves are
          the next connection step; the practice studio remains browser-local.
        </p>
      </section>
      {membershipError || !membership || !tenant ? (
        <section className="workspace-alert" role="alert">
          <ShieldCheck size={22} />
          <div>
            <h2>Workspace provisioning needs attention</h2>
            <p>
              Your identity is verified, but no active HelloCrew membership was
              found. Sign out and contact the project owner before adding data.
            </p>
          </div>
        </section>
      ) : (
        <section className="workspace-grid">
          <article className="workspace-card primary-card">
            <span className="workspace-card-icon">{tenant.name.charAt(0)}</span>
            <div>
              <span className="eyebrow">YOUR WORKSPACE</span>
              <h2>{tenant.name}</h2>
              <p>
                {membership.role} · {tenant.status} · {tenant.timezone}
              </p>
            </div>
          </article>
          <article className="workspace-card">
            <Database size={24} />
            <div>
              <h2>Supabase connected</h2>
              <p>
                Tenant membership and workspace identity were read through your
                verified session and row-level policies.
              </p>
            </div>
          </article>
          <article className="workspace-card next-card">
            <ShieldCheck size={24} />
            <div>
              <h2>Practice remains separate</h2>
              <p>
                No live AI, external action, or customer data is enabled by
                signing in.
              </p>
              <Link href="/app">
                Open practice studio <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
