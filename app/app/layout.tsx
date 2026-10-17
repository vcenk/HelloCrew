import type { Metadata } from "next";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "./dashboard.css";
import "./legacy-dark.css";

import { DashboardProvider } from "@/components/dashboard/provider";
import { DashboardShell } from "@/components/dashboard/shell";

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
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}
