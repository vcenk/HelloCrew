import { Suspense } from "react";

import { ConnectionsView } from "@/components/dashboard/connections";

export default function Page() {
  return (
    <Suspense>
      <ConnectionsView />
    </Suspense>
  );
}
