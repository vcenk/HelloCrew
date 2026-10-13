import type { WorkflowKind } from "./workflow";

export type JobField = {
  key: string;
  label: string;
  help: string;
  type: "text" | "number" | "select" | "toggle";
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
};

export type NodeJobDefinition = {
  jobId: string;
  title: string;
  summary: string;
  outcome: string;
  fields: JobField[];
  requiredIntegration: "none" | "openai" | "booking" | "google_business";
  effect: "read_only" | "internal_write" | "external_write";
  approvalPolicy: "none" | "required";
  timeoutMs: number;
  maxRetries: number;
  idempotency: string;
  audit: string;
  demoSupported: true;
  liveSupported: boolean;
};

type JobPresentation = Pick<
  NodeJobDefinition,
  "title" | "summary" | "outcome" | "fields"
>;

const nodeJobContent: Record<WorkflowKind, JobPresentation> = {
  "trigger.website": {
    title: "Listen for a website message",
    summary:
      "This node starts one assistant run when a visitor sends a message in the website chat.",
    outcome: "A new conversation enters the workflow.",
    fields: [
      {
        key: "greeting",
        label: "Welcome message",
        help: "Shown before the visitor sends their first message.",
        type: "text",
      },
      {
        key: "availability",
        label: "When chat is available",
        help: "Outside-hours behavior can route directly to the inbox later.",
        type: "select",
        options: [
          { label: "Always", value: "always" },
          { label: "Business hours", value: "business_hours" },
        ],
      },
    ],
  },
  "trigger.google_review": {
    title: "Listen for a Google review",
    summary:
      "This node starts one run when Google reports a new or updated review for a connected business location.",
    outcome:
      "The review text, star rating, language, and location enter the workflow.",
    fields: [
      {
        key: "connection",
        label: "Google connection",
        help: "Google Business Profile OAuth is connected separately. It is not active in this prototype.",
        type: "select",
        options: [
          { label: "Not connected", value: "Not connected" },
          {
            label: "Google Business Profile — later",
            value: "Google Business Profile — later",
          },
        ],
      },
      {
        key: "events",
        label: "Review events",
        help: "Updated reviews are reprocessed so the proposed reply stays relevant.",
        type: "select",
        options: [
          {
            label: "New and updated reviews",
            value: "New and updated reviews",
          },
          { label: "New reviews only", value: "New reviews only" },
        ],
      },
      {
        key: "locations",
        label: "Business locations",
        help: "Choose which connected locations this workflow will watch.",
        type: "text",
      },
    ],
  },
  "knowledge.search": {
    title: "Find approved business information",
    summary:
      "This node searches only the selected FAQs, services, website pages, and documents for this workspace.",
    outcome: "Relevant source passages are passed to the response node.",
    fields: [
      {
        key: "sources",
        label: "Knowledge to search",
        help: "Choose the business information this workflow may use.",
        type: "select",
        options: [
          {
            label: "Services, FAQs and documents",
            value: "Services, FAQs and documents",
          },
          {
            label: "Services, policies and preparation notes",
            value: "Services, policies and preparation notes",
          },
          { label: "Services and FAQs", value: "Services and FAQs" },
          { label: "FAQs only", value: "FAQs only" },
          { label: "Documents only", value: "Documents only" },
        ],
      },
      {
        key: "resultLimit",
        label: "Maximum sources",
        help: "A small result set keeps answers focused and less expensive.",
        type: "number",
        min: 1,
        max: 10,
        step: 1,
      },
    ],
  },
  "ai.respond": {
    title: "Write a grounded response",
    summary:
      "This node turns approved source information into a customer-facing answer. It may not invent missing details.",
    outcome: "A draft answer is sent to the confidence check.",
    fields: [
      {
        key: "tone",
        label: "Response style",
        help: "The assistant still follows safety and grounding rules.",
        type: "select",
        options: [
          { label: "Friendly and concise", value: "Friendly and concise" },
          {
            label: "Calm and professional",
            value: "Calm and professional",
          },
          {
            label: "Warm and conversational",
            value: "Warm and conversational",
          },
        ],
      },
      {
        key: "languages",
        label: "Supported languages",
        help: "Use comma-separated language codes. Initial target: EN, FA, ZH.",
        type: "text",
      },
      {
        key: "model",
        label: "Model policy",
        help: "HelloCrew will select the least expensive model that passes quality checks.",
        type: "select",
        options: [
          {
            label: "Managed for cost and quality",
            value: "Managed for cost and quality",
          },
          { label: "Higher quality", value: "Higher quality" },
        ],
      },
    ],
  },
  "logic.confidence": {
    title: "Check whether the answer is safe to send",
    summary:
      "This node compares answer confidence with a threshold and routes uncertain conversations to a person.",
    outcome: "Confident answers continue; uncertain answers go to the inbox.",
    fields: [
      {
        key: "threshold",
        label: "Minimum confidence",
        help: "Higher values send more conversations to a person.",
        type: "number",
        min: 0.5,
        max: 0.95,
        step: 0.05,
      },
    ],
  },
  "logic.review_risk": {
    title: "Check the rating and review risk",
    summary:
      "This node detects low ratings and sensitive topics before anything is posted publicly.",
    outcome:
      "Every review can be drafted; risky reviews also create a follow-up task.",
    fields: [
      {
        key: "followUpBelowStars",
        label: "Follow up below",
        help: "Reviews below this star rating are sent to the team for recovery.",
        type: "number",
        min: 2,
        max: 5,
        step: 1,
      },
      {
        key: "sensitiveTopics",
        label: "Sensitive topics",
        help: "Comma-separated topics that should always get personal attention.",
        type: "text",
      },
    ],
  },
  "approval.owner": {
    title: "Ask a team member for approval",
    summary:
      "This node pauses the workflow before an external action. Approval is tied to the exact proposed action.",
    outcome:
      "Approved requests continue; rejected or expired requests do nothing.",
    fields: [
      {
        key: "approvalFor",
        label: "What needs approval",
        help: "Shown to the team member reviewing the request.",
        type: "text",
      },
      {
        key: "timeoutMinutes",
        label: "Approval expires after",
        help: "Expired approvals cannot be reused.",
        type: "number",
        min: 5,
        max: 1440,
        step: 5,
      },
    ],
  },
  "action.booking": {
    title: "Create or request an appointment",
    summary:
      "This node sends an approved booking request to the configured provider. It stays disabled until an integration is connected.",
    outcome: "The provider result is returned to the reply node.",
    fields: [
      {
        key: "provider",
        label: "Booking provider",
        help: "Credentials are connected separately and never stored in the workflow.",
        type: "select",
        options: [
          { label: "Not connected", value: "Not connected" },
          { label: "Phorest", value: "Phorest" },
          { label: "Cal.com", value: "Cal.com" },
          { label: "Booking link", value: "Booking link" },
        ],
      },
      {
        key: "mode",
        label: "Action mode",
        help: "Live booking always requires approval in the first release.",
        type: "select",
        options: [
          { label: "Approval required", value: "approval_required" },
          { label: "Prepare request only", value: "prepare_only" },
        ],
      },
    ],
  },
  "action.google_review_reply": {
    title: "Post the approved Google reply",
    summary:
      "This node posts or updates the business’s reply through the Google Business Profile API. It stays disabled until Google is connected.",
    outcome: "The approved public reply is attached to the original review.",
    fields: [
      {
        key: "provider",
        label: "Review provider",
        help: "OAuth credentials are connected separately and are never stored in the workflow.",
        type: "select",
        options: [
          {
            label: "Google Business Profile — not connected",
            value: "Google Business Profile — not connected",
          },
        ],
      },
      {
        key: "mode",
        label: "Publishing mode",
        help: "The first release always requires a team member to approve the exact public reply.",
        type: "select",
        options: [
          { label: "Approval required", value: "approval_required" },
          { label: "Draft only", value: "draft_only" },
        ],
      },
    ],
  },
  "handoff.inbox": {
    title: "Send the conversation to a person",
    summary:
      "This node packages the customer question, known facts, and reason for handoff for the team.",
    outcome: "A handoff item appears in the chosen team destination.",
    fields: [
      {
        key: "destination",
        label: "Team destination",
        help: "Only the dashboard inbox is available in the current prototype.",
        type: "select",
        options: [
          { label: "Dashboard inbox", value: "Dashboard inbox" },
          { label: "Manager email — later", value: "Manager email" },
          { label: "Callback queue — later", value: "Callback queue" },
        ],
      },
    ],
  },
  "handoff.review_follow_up": {
    title: "Create a review follow-up task",
    summary:
      "This node creates an internal task with the review, customer context, and the reason it needs attention.",
    outcome: "A recovery or escalation task appears in the dashboard inbox.",
    fields: [
      {
        key: "destination",
        label: "Team destination",
        help: "The initial version uses the HelloCrew dashboard inbox.",
        type: "select",
        options: [
          { label: "Dashboard inbox", value: "Dashboard inbox" },
          { label: "Manager email — later", value: "Manager email — later" },
        ],
      },
      {
        key: "dueHours",
        label: "Follow up within (hours)",
        help: "This is an internal due time, not a promise sent to the reviewer.",
        type: "number",
        min: 1,
        max: 168,
        step: 1,
      },
      {
        key: "rule",
        label: "Create a task when",
        help: "Describe the risk rule so owners understand why a task was created.",
        type: "text",
      },
    ],
  },
  "output.reply": {
    title: "Send the final website reply",
    summary:
      "This node returns the approved answer or action result to the original website conversation.",
    outcome: "The visitor sees the final message in the website chat.",
    fields: [
      {
        key: "closingMessage",
        label: "Optional closing line",
        help: "Leave empty to let the assistant close naturally.",
        type: "text",
      },
      {
        key: "showSources",
        label: "Show source labels",
        help: "Useful for testing; customer-facing source display can be decided later.",
        type: "toggle",
      },
    ],
  },
  "output.review_complete": {
    title: "Record the review outcome",
    summary:
      "This node records which reply was approved, who approved it, and whether Google accepted the update.",
    outcome: "The review run closes with an auditable status.",
    fields: [
      {
        key: "status",
        label: "Successful status",
        help: "Shown in the workflow run history after Google accepts the reply.",
        type: "text",
      },
      {
        key: "keepAuditTrail",
        label: "Keep approval record",
        help: "Keeps the proposal and approval decision in the workspace audit trail.",
        type: "toggle",
      },
    ],
  },
};

type JobRuntimePolicy = Omit<
  NodeJobDefinition,
  "title" | "summary" | "outcome" | "fields"
>;

const defaultPolicy: JobRuntimePolicy = {
  jobId: "unassigned",
  requiredIntegration: "none",
  effect: "read_only",
  approvalPolicy: "none",
  timeoutMs: 10_000,
  maxRetries: 1,
  idempotency: "workflow_run_id + node_id",
  audit: "Record timing, outcome, and redacted error details.",
  demoSupported: true,
  liveSupported: false,
};

const runtimePolicies: Record<WorkflowKind, Partial<JobRuntimePolicy>> = {
  "trigger.website": { jobId: "website.message.received", liveSupported: true },
  "trigger.google_review": {
    jobId: "google.review.received",
    requiredIntegration: "google_business",
  },
  "knowledge.search": {
    jobId: "knowledge.search",
    timeoutMs: 8_000,
    liveSupported: true,
  },
  "ai.respond": {
    jobId: "ai.response.draft",
    requiredIntegration: "openai",
    timeoutMs: 30_000,
    maxRetries: 2,
  },
  "logic.confidence": { jobId: "routing.confidence.check" },
  "logic.review_risk": { jobId: "routing.review.risk" },
  "approval.owner": {
    jobId: "approval.owner.request",
    effect: "internal_write",
    approvalPolicy: "required",
    timeoutMs: 86_400_000,
    idempotency: "workflow_run_id + proposal_hash",
    liveSupported: true,
  },
  "action.booking": {
    jobId: "booking.create",
    requiredIntegration: "booking",
    effect: "external_write",
    approvalPolicy: "required",
    timeoutMs: 20_000,
    maxRetries: 2,
    idempotency: "workspace_id + approved_proposal_id",
  },
  "action.google_review_reply": {
    jobId: "google.review.reply.publish",
    requiredIntegration: "google_business",
    effect: "external_write",
    approvalPolicy: "required",
    timeoutMs: 20_000,
    maxRetries: 2,
    idempotency: "location_id + review_id + approved_reply_hash",
  },
  "handoff.inbox": {
    jobId: "inbox.handoff.create",
    effect: "internal_write",
    liveSupported: true,
  },
  "handoff.review_follow_up": {
    jobId: "inbox.review_follow_up.create",
    effect: "internal_write",
    liveSupported: true,
  },
  "output.reply": {
    jobId: "website.reply.send",
    effect: "internal_write",
    liveSupported: true,
  },
  "output.review_complete": {
    jobId: "review.run.complete",
    effect: "internal_write",
    liveSupported: true,
  },
};

export const nodeJobDefinitions = Object.fromEntries(
  Object.entries(nodeJobContent).map(([kind, content]) => [
    kind,
    { ...defaultPolicy, ...runtimePolicies[kind as WorkflowKind], ...content },
  ]),
) as Record<WorkflowKind, NodeJobDefinition>;
