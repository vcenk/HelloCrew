import { redirect } from "next/navigation";

import { HomeView } from "@/components/dashboard/home";

const legacySections: Record<string, string> = {
  home: "/app",
  assistant: "/app/assistant",
  workflows: "/app/workflows",
  conversations: "/app/inbox",
  channels: "/app/channels",
  settings: "/app/settings",
};

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const section = (await searchParams).section;
  const target =
    typeof section === "string" ? legacySections[section] : undefined;
  if (target && target !== "/app") redirect(target);
  return <HomeView />;
}
