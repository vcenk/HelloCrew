"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { AssistantSetup } from "@/components/knowledge-manager";
import { WebsiteChatGuide } from "@/components/website-chat-guide";
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

const routeFor = {
  "Your assistant": "/app/assistant",
  Workflows: "/app/workflows",
  Conversations: "/app/inbox",
} as const;

export function AssistantView() {
  const { business, identity, saveIdentity, setBusiness, conversation, toast } =
    useDashboard();
  return (
    <div className="legacy-host">
      <PageHeader
        title="Assistant"
        description="Who your assistant is, which business it speaks for, and the facts it’s allowed to use."
      />
      <AssistantSetup
        business={business}
        disabled={conversation.busy}
        identity={identity}
        onIdentitySave={(next) => {
          saveIdentity(next);
          toast("Identity saved");
        }}
        onSave={setBusiness}
      />
    </div>
  );
}

export function WorkflowsView() {
  const { identity, setWorkflowReadiness } = useDashboard();
  return (
    <div className="legacy-host">
      <PageHeader
        title="Workflows"
        description="Pick what your assistant handles, and where it stops to ask you first."
      />
      <WorkflowBuilder
        assistantPurpose={identity.purpose}
        onReadinessChange={setWorkflowReadiness}
      />
    </div>
  );
}

export function ChannelsView() {
  const router = useRouter();
  const { business, identity, workflowReadiness, conversation } =
    useDashboard();
  return (
    <div className="legacy-host">
      <PageHeader
        title="Channels"
        description="Preview the website chat and get the snippet to install it."
      />
      <WebsiteChatGuide
        business={business}
        conversationReviewed={conversation.messages.some(
          (m) => m.role === "assistant",
        )}
        identity={identity}
        onNavigate={(target) => router.push(routeFor[target])}
        workflowReadiness={workflowReadiness}
      />
    </div>
  );
}
