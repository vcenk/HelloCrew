import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WidgetFrame } from "@/components/widget-frame";
import { loadWidgetPage } from "@/lib/server/widget-installations";

export const metadata: Metadata = {
  title: "HelloCrew website chat",
  robots: { index: false, follow: false },
};

// Rendered per request so name, greeting and on/off changes show at once.
export const dynamic = "force-dynamic";

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ installationId: string }>;
}) {
  const { installationId } = await params;
  const installation = await loadWidgetPage(installationId);
  if (!installation) notFound();

  // Only what the chat window needs; never the tenant id or allowed sites.
  return (
    <WidgetFrame
      installation={{
        id: installation.id,
        mode: installation.mode,
        business: installation.business,
        identity: installation.identity,
        modelProvider: installation.modelProvider,
        suggestedQuestions: installation.suggestedQuestions,
      }}
    />
  );
}
