import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WidgetFrame } from "@/components/widget-frame";
import {
  DEMO_WIDGET_INSTALLATION_ID,
  getWidgetInstallation,
} from "@/lib/widget";

export const metadata: Metadata = {
  title: "HelloCrew website chat",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return [{ installationId: DEMO_WIDGET_INSTALLATION_ID }];
}

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ installationId: string }>;
}) {
  const { installationId } = await params;
  const installation = getWidgetInstallation(installationId);
  if (!installation) notFound();

  return <WidgetFrame installation={installation} />;
}
