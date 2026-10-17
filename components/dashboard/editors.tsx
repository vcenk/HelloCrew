"use client";

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";

import { useDashboard } from "./provider";
import { PageHeader } from "./ui";

const WorkflowBuilder = dynamic(
  () => import("@/components/workflow-builder").then((m) => m.WorkflowBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="ui-loading" role="status">
        <LoaderCircle className="spin" size={18} /> Loading the workflow canvas
      </div>
    ),
  },
);

export function WorkflowsView() {
  const { identity, setWorkflowReadiness } = useDashboard();
  return (
    <div className="legacy-host">
      <PageHeader
        title="Workflow editor"
        description="Advanced: fine-tune each step your receptionist follows and where it stops to ask you first."
      />
      <WorkflowBuilder
        assistantPurpose={identity.purpose}
        onReadinessChange={setWorkflowReadiness}
      />
    </div>
  );
}
