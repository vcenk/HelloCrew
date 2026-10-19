import { Suspense } from "react";

import { ChannelsTab } from "@/components/dashboard/crew";

export default function Page() {
  return (
    <Suspense>
      <ChannelsTab />
    </Suspense>
  );
}
