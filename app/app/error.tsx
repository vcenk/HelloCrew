"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button, EmptyState, PageHeader } from "@/components/dashboard/ui";

// Sits inside app/app/layout.tsx, so the sidebar, topbar and theme stay put
// while only the failing page is replaced.
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <PageHeader
        title="This page didn’t load"
        description="Your crew, knowledge and conversations are all still saved."
      />
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong here"
        action={
          <Button variant="primary" icon={RotateCcw} onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Try again to reload just this page. Everything else in the dashboard
        keeps working — pick another section from the menu any time.
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </EmptyState>
    </div>
  );
}
