import { Suspense } from "react";

import { KnowledgeView } from "@/components/dashboard/knowledge";

// Reading a file and suggesting items can take a little while.
export const maxDuration = 120;

export default function Page() {
  return (
    <Suspense>
      <KnowledgeView />
    </Suspense>
  );
}
