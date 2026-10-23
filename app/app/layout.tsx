import type { Metadata } from "next";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "./dashboard.css";
import "./legacy-dark.css";

import { DashboardProvider } from "@/components/dashboard/provider";
import { DashboardShell } from "@/components/dashboard/shell";
import { UnsavedChangesProvider } from "@/components/dashboard/unsaved-changes";

export const metadata: Metadata = {
  title: "Dashboard · HelloCrew",
  description: "Set up, test and supervise your HelloCrew assistant.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      {/* Above the shell, so the sidebar's own links can be guarded too. */}
      <UnsavedChangesProvider>
        <DashboardShell>{children}</DashboardShell>
      </UnsavedChangesProvider>
    </DashboardProvider>
  );
}
