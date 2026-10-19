import { Suspense } from "react";

import { ReputationView } from "@/components/dashboard/connections";

export default function Page() {
  return (
    <Suspense>
      <ReputationView />
    </Suspense>
  );
}
