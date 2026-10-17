import { Suspense } from "react";

import { KnowledgeView } from "@/components/dashboard/knowledge";

export default function Page() {
  return (
    <Suspense>
      <KnowledgeView />
    </Suspense>
  );
}
