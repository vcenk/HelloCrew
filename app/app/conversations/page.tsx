import { Suspense } from "react";

import { ConversationsView } from "@/components/dashboard/conversations";

export default function Page() {
  return (
    <Suspense>
      <ConversationsView />
    </Suspense>
  );
}
