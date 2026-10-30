"use client";

import {
  persistLocal,
  WORKSPACE_PULLED_EVENT,
} from "@/lib/workspace-documents";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Bot,
  BookOpen,
  CalendarPlus,
  Check,
  CircleAlert,
  Clock3,
  CopyPlus,
  FolderOpen,
  GitBranch,
  Globe,
  Hand,
  History,
  Inbox,
  LayoutTemplate,
  ListTodo,
  MessageSquareReply,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { nodeJobDefinitions, type JobField } from "@/lib/workflow-jobs";
import {
  WORKFLOW_STORAGE_VERSION,
  createWorkflowRecord,
  parseWorkflowStore,
  publishWorkflowVersion,
  saveWorkflowDraft,
  setWorkflowArchived,
  type WorkflowRecord,
} from "@/lib/workflow-lifecycle";
import {
  compilePracticePlan,
  type WorkflowTestPlan,
} from "@/lib/workflow-runner";
import {
  createWorkflowFromTemplate,
  salonReceptionWorkflow,
  validateWorkflow,
  workflowTemplates,
  type WorkflowDefinition,
  type WorkflowKind,
  type WorkflowTemplate,
} from "@/lib/workflow";
import {
  getAssistantPurposePreset,
  type AssistantPurpose,
} from "@/lib/assistant";
import {
  getWorkflowRecommendations,
  type WorkflowRecommendation,
} from "@/lib/workflow-recommendations";
import {
  LEGACY_WORKFLOW_STORAGE_KEY,
  WORKFLOW_STORAGE_KEY,
  summarizeWorkflowReadiness,
  type WorkflowReadiness,
} from "@/lib/workflow-readiness";

type CanvasData = {
  kind: WorkflowKind;
  label: string;
  description: string;
  config: Record<string, string | number | boolean>;
  [key: string]: unknown;
};

type CanvasNode = Node<CanvasData, "workflow">;
type EditorDraft = WorkflowRecord;
type SavedWorkflow = WorkflowRecord;

const palette: {
  kind: WorkflowKind;
  label: string;
  description: string;
  icon: typeof Globe;
  group: "Start" | "Think" | "Act" | "Finish";
}[] = [
  {
    kind: "trigger.website",
    label: "Website message",
    description: "Starts with a website visitor.",
    icon: Globe,
    group: "Start",
  },
  {
    kind: "trigger.google_review",
    label: "Google review",
    description: "Starts with a new or updated review.",
    icon: Star,
    group: "Start",
  },
  {
    kind: "knowledge.search",
    label: "Search knowledge",
    description: "Finds approved business facts.",
    icon: BookOpen,
    group: "Think",
  },
  {
    kind: "ai.respond",
    label: "Draft response",
    description: "Creates a grounded answer.",
    icon: Bot,
    group: "Think",
  },
  {
    kind: "logic.confidence",
    label: "Check confidence",
    description: "Chooses the safest next step.",
    icon: GitBranch,
    group: "Think",
  },
  {
    kind: "logic.review_risk",
    label: "Check review risk",
    description: "Routes low ratings and sensitive topics.",
    icon: CircleAlert,
    group: "Think",
  },
  {
    kind: "approval.owner",
    label: "Owner approval",
    description: "Pauses for a human decision.",
    icon: Hand,
    group: "Act",
  },
  {
    kind: "action.booking",
    label: "Create booking",
    description: "Calls a connected calendar.",
    icon: CalendarPlus,
    group: "Act",
  },
  {
    kind: "action.google_review_reply",
    label: "Post review reply",
    description: "Updates the approved Google reply.",
    icon: Send,
    group: "Act",
  },
  {
    kind: "handoff.inbox",
    label: "Human inbox",
    description: "Hands context to the team.",
    icon: Inbox,
    group: "Finish",
  },
  {
    kind: "handoff.review_follow_up",
    label: "Review follow-up",
    description: "Creates an internal recovery task.",
    icon: ListTodo,
    group: "Finish",
  },
  {
    kind: "output.reply",
    label: "Send reply",
    description: "Returns the final response.",
    icon: MessageSquareReply,
    group: "Finish",
  },
  {
    kind: "output.review_complete",
    label: "Record review outcome",
    description: "Closes the run with an audit record.",
    icon: BadgeCheck,
    group: "Finish",
  },
];

const iconByKind = Object.fromEntries(
  palette.map((item) => [item.kind, item.icon]),
) as Record<WorkflowKind, typeof Globe>;

const categoryByKind: Record<WorkflowKind, string> = {
  "trigger.website": "trigger",
  "trigger.google_review": "trigger",
  "knowledge.search": "knowledge",
  "ai.respond": "ai",
  "logic.confidence": "logic",
  "logic.review_risk": "logic",
  "approval.owner": "approval",
  "action.booking": "action",
  "action.google_review_reply": "action",
  "handoff.inbox": "handoff",
  "handoff.review_follow_up": "handoff",
  "output.reply": "output",
  "output.review_complete": "output",
};

function toCanvasNodes(workflow: WorkflowDefinition): CanvasNode[] {
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position,
    data: {
      kind: node.kind,
      label: node.label,
      description: node.description,
      config: node.config,
    },
  }));
}

function toCanvasEdges(workflow: WorkflowDefinition): Edge[] {
  return workflow.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    animated: edge.source.includes("message"),
  }));
}

function WorkflowCard({ data, selected }: NodeProps<CanvasNode>) {
  const Icon = iconByKind[data.kind];
  const isTrigger = data.kind.startsWith("trigger.");
  const isDestination =
    data.kind.startsWith("output.") || data.kind.startsWith("handoff.");
  return (
    <div
      className={`workflow-node ${categoryByKind[data.kind]} ${selected ? "selected" : ""}`}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <span className="workflow-node-icon">
        <Icon size={17} />
      </span>
      <div>
        <small>{data.kind.split(".")[0]}</small>
        <strong>{data.label}</strong>
        <span>{data.description}</span>
      </div>
      {!isDestination && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowCard };

function readSavedWorkflows(): SavedWorkflow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem(WORKFLOW_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_WORKFLOW_STORAGE_KEY);
    if (!raw) return [];
    return parseWorkflowStore(JSON.parse(raw)).workflows;
  } catch {
    return [];
  }
}

function JobFieldControl({
  field,
  value,
  onChange,
}: {
  field: JobField;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  if (field.type === "select")
    return (
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Choose an option
        </option>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (field.type === "number")
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  if (field.type === "toggle")
    return (
      <span className="job-toggle">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {value === true ? "On" : "Off"}
      </span>
    );
  return (
    <input
      value={typeof value === "string" ? value : ""}
      maxLength={180}
      placeholder="Add your information"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function BuilderCanvas({
  draft,
  onBack,
  onSave,
  onPublish,
}: {
  draft: EditorDraft;
  onBack: () => void;
  onSave: (draft: EditorDraft) => void;
  onPublish: (draft: EditorDraft, workflow: WorkflowDefinition) => void;
}) {
  const [name, setName] = useState(draft.workflow.name);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toCanvasNodes(draft.workflow),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    toCanvasEdges(draft.workflow),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    draft.workflow.nodes[0]?.id ?? null,
  );
  const [saved, setSaved] = useState(false);
  const [testPlan, setTestPlan] = useState<WorkflowTestPlan | null>(null);

  const definition = useMemo<WorkflowDefinition>(
    () => ({
      ...draft.workflow,
      name,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        label: node.data.label,
        description: node.data.description,
        position: node.position,
        config: node.data.config,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(typeof edge.label === "string" ? { label: edge.label } : {}),
      })),
    }),
    [draft.workflow, edges, name, nodes],
  );
  const issues = useMemo(() => validateWorkflow(definition), [definition]);
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedJob = selected
    ? nodeJobDefinitions[selected.data.kind]
    : undefined;

  const onConnect = useCallback(
    (connection: Connection) => {
      if (draft.structureLocked) return;
      setSaved(false);
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `connection-${crypto.randomUUID()}`,
            type: "smoothstep",
          },
          current,
        ),
      );
    },
    [draft.structureLocked, setEdges],
  );

  function addNode(kind: WorkflowKind) {
    if (draft.structureLocked) return;
    const template = palette.find((item) => item.kind === kind)!;
    const id = `${kind.replace(".", "-")}-${crypto.randomUUID().slice(0, 8)}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: "workflow",
        position: {
          x: 160 + current.length * 36,
          y: 180 + current.length * 22,
        },
        data: {
          kind,
          label: template.label,
          description: template.description,
          config: {},
        },
      },
    ]);
    setSelectedId(id);
    setSaved(false);
  }

  function updateSelected(field: "label" | "description", value: string) {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? { ...node, data: { ...node.data, [field]: value } }
          : node,
      ),
    );
    setSaved(false);
  }

  function updateConfig(key: string, value: string | number | boolean) {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? {
              ...node,
              data: {
                ...node.data,
                config: { ...node.data.config, [key]: value },
              },
            }
          : node,
      ),
    );
    setSaved(false);
  }

  function removeSelected() {
    if (!selectedId || draft.structureLocked) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedId && edge.target !== selectedId,
      ),
    );
    setSelectedId(null);
    setSaved(false);
  }

  function resetTemplate() {
    setName(draft.workflow.name);
    setNodes(toCanvasNodes(draft.workflow));
    setEdges(toCanvasEdges(draft.workflow));
    setSelectedId(draft.workflow.nodes[0]?.id ?? null);
    setSaved(false);
  }

  function saveDraft() {
    if (issues.length > 0) return;
    onSave(saveWorkflowDraft(draft, definition));
    setSaved(true);
  }

  function publishDraft() {
    if (issues.length > 0) return;
    onPublish(draft, definition);
    setSaved(true);
  }

  function testWorkflow() {
    if (issues.length > 0) return;
    setTestPlan(compilePracticePlan(definition));
  }

  return (
    <section className="workflow-builder" aria-label="Workflow builder">
      <div className="workflow-toolbar workflow-editor-toolbar">
        <button className="workflow-back" onClick={onBack}>
          <ArrowLeft size={16} /> My workflows
        </button>
        <div className="workflow-title-editor">
          <span className="badge pale">
            {draft.structureLocked ? "Guided template" : "Advanced workflow"}
          </span>
          <label>
            Workflow name
            <input
              value={name}
              maxLength={100}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <p>
            {draft.structureLocked
              ? "The safe path is locked. Select each step and add your business information."
              : "Build the path, then configure the job inside every node."}
          </p>
        </div>
        <div className="workflow-toolbar-actions">
          <button className="button outline compact" onClick={resetTemplate}>
            <RotateCcw size={15} /> Reset
          </button>
          <button
            className="button outline compact"
            onClick={testWorkflow}
            disabled={issues.length > 0 || name.trim().length === 0}
          >
            <Play size={15} /> Test safely
          </button>
          <button
            className="button dark compact"
            onClick={saveDraft}
            disabled={issues.length > 0 || name.trim().length === 0}
          >
            {saved ? <Check size={15} /> : <Save size={15} />}
            {saved ? "Saved to My workflows" : "Save workflow"}
          </button>
          <button
            className="button dark compact publish-button"
            onClick={publishDraft}
            disabled={issues.length > 0 || name.trim().length === 0}
          >
            <Rocket size={15} /> Publish v{draft.publishedVersions.length + 1}
          </button>
        </div>
      </div>

      <div className="workflow-workspace">
        <aside className="node-library" aria-label="Workflow steps">
          <div className="builder-panel-heading">
            <span>
              {draft.structureLocked ? "Template steps" : "Node library"}
            </span>
            <small>
              {draft.structureLocked ? "Select to configure" : "Click to add"}
            </small>
          </div>
          {draft.structureLocked ? (
            <div className="template-step-list">
              {nodes.map((node, index) => {
                const Icon = iconByKind[node.data.kind];
                return (
                  <button
                    key={node.id}
                    className={selectedId === node.id ? "active" : ""}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <span className={categoryByKind[node.data.kind]}>
                      <Icon size={16} />
                    </span>
                    <span>
                      <small>Step {index + 1}</small>
                      {node.data.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            (["Start", "Think", "Act", "Finish"] as const).map((group) => (
              <div className="node-group" key={group}>
                <strong>{group}</strong>
                {palette
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button key={item.kind} onClick={() => addNode(item.kind)}>
                      <span className={categoryByKind[item.kind]}>
                        <item.icon size={16} />
                      </span>
                      <span>
                        {item.label}
                        <small>{item.description}</small>
                      </span>
                      <Plus size={14} />
                    </button>
                  ))}
              </div>
            ))
          )}
        </aside>

        <div className="workflow-canvas" aria-label="Workflow canvas">
          <ReactFlow<CanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              setSaved(false);
            }}
            onEdgesChange={(changes) => {
              if (!draft.structureLocked) onEdgesChange(changes);
              setSaved(false);
            }}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={!draft.structureLocked}
            nodesDraggable={!draft.structureLocked}
            edgesReconnectable={!draft.structureLocked}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.5}
            deleteKeyCode={
              draft.structureLocked ? null : ["Backspace", "Delete"]
            }
            proOptions={{ hideAttribution: true }}
          >
            <Background
              color="#cbd4cb"
              gap={22}
              size={1.2}
              variant={BackgroundVariant.Dots}
            />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
                const kind = (node.data as CanvasData).kind;
                return kind.startsWith("action.") ? "#d8b84e" : "#315b48";
              }}
              maskColor="rgba(247, 246, 239, .75)"
            />
          </ReactFlow>
          <div className="canvas-hint">
            {draft.structureLocked
              ? "Safe structure locked · Select a node to configure its job"
              : "Drag nodes · Pull from a dot to connect"}
          </div>
        </div>

        <aside className="node-inspector" aria-label="Node job settings">
          <div className="builder-panel-heading">
            <span>Node job</span>
            <small>{selected ? "1 selected" : "Nothing selected"}</small>
          </div>
          {selected && selectedJob ? (
            <>
              <div className="job-heading">
                <span
                  className={`inspector-icon ${categoryByKind[selected.data.kind]}`}
                >
                  {(() => {
                    const Icon = iconByKind[selected.data.kind];
                    return <Icon size={18} />;
                  })()}
                </span>
                <div>
                  <small>Its job</small>
                  <strong>{selectedJob.title}</strong>
                </div>
              </div>
              <p className="job-summary">{selectedJob.summary}</p>
              <div className="job-outcome">
                <Check size={14} />
                <span>
                  <strong>Produces</strong>
                  {selectedJob.outcome}
                </span>
              </div>
              <div className="job-contract" aria-label="Job safety contract">
                <span>{selectedJob.jobId}</span>
                <dl>
                  <div>
                    <dt>Effect</dt>
                    <dd>{selectedJob.effect.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Approval</dt>
                    <dd>{selectedJob.approvalPolicy}</dd>
                  </div>
                  <div>
                    <dt>Integration</dt>
                    <dd>
                      {selectedJob.requiredIntegration.replaceAll("_", " ")}
                    </dd>
                  </div>
                </dl>
                <small>
                  Allowlisted job · {selectedJob.maxRetries} retr
                  {selectedJob.maxRetries === 1 ? "y" : "ies"} · no user code
                </small>
              </div>
              <div className="job-fields">
                {selectedJob.fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <JobFieldControl
                      field={field}
                      value={selected.data.config[field.key]}
                      onChange={(value) => updateConfig(field.key, value)}
                    />
                    <small>{field.help}</small>
                  </label>
                ))}
              </div>
              {!draft.structureLocked && (
                <details className="advanced-node-details">
                  <summary>Advanced node details</summary>
                  <label>
                    Node name
                    <input
                      value={selected.data.label}
                      maxLength={80}
                      onChange={(event) =>
                        updateSelected("label", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Canvas description
                    <textarea
                      value={selected.data.description}
                      maxLength={240}
                      onChange={(event) =>
                        updateSelected("description", event.target.value)
                      }
                    />
                  </label>
                  <button className="delete-node" onClick={removeSelected}>
                    <Trash2 size={15} /> Remove node
                  </button>
                </details>
              )}
            </>
          ) : (
            <div className="inspector-empty">
              <GitBranch size={28} />
              <strong>Select a node</strong>
              <p>Its job and editable business information will appear here.</p>
            </div>
          )}
        </aside>
      </div>

      <div
        className={`workflow-health ${issues.length > 0 ? "has-issues" : ""}`}
      >
        <span className="workflow-health-icon">
          {issues.length > 0 ? (
            <CircleAlert size={19} />
          ) : (
            <ShieldCheck size={19} />
          )}
        </span>
        <div>
          <strong>
            {issues.length > 0
              ? `${issues.length} item${issues.length === 1 ? "" : "s"} to fix`
              : "Ready to save as a safe draft"}
          </strong>
          {issues.length > 0 ? (
            <ul>
              {issues.slice(0, 4).map((issue, index) => (
                <li
                  key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Every path starts correctly, reaches an outcome, and external
              actions are protected by approval.
            </p>
          )}
        </div>
      </div>
      {testPlan && (
        <section
          className="workflow-test-panel"
          aria-label="Practice test plan"
        >
          <div className="workflow-test-heading">
            <span>
              <Play size={17} /> Safe test plan
            </span>
            <strong>0 external writes</strong>
          </div>
          <p>
            This dry run compiles only registered jobs. Integrations stay off
            and approval nodes pause instead of performing an action.
          </p>
          <ol>
            {testPlan.steps.map((step) => (
              <li key={step.nodeId}>
                <span className={`test-step-state ${step.state}`} />
                <div>
                  <strong>{step.label}</strong>
                  <small>
                    {step.jobId} · {step.detail}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}

function TemplateCard({
  template,
  recommendation,
  onUse,
}: {
  template: WorkflowTemplate;
  recommendation?: WorkflowRecommendation;
  onUse: () => void;
}) {
  return (
    <article
      className={`workflow-library-card ${recommendation ? `recommended ${recommendation.fit}` : ""}`}
    >
      <div className="template-card-top">
        <span className="template-card-icon">
          {template.category === "Clinic" ? (
            <ShieldCheck size={21} />
          ) : template.category === "Salon" ? (
            <Sparkles size={21} />
          ) : template.category === "Reputation" ? (
            <Star size={21} />
          ) : (
            <MessageSquareReply size={21} />
          )}
        </span>
        <div className="template-card-badges">
          {recommendation && (
            <span className={`template-fit ${recommendation.fit}`}>
              {recommendation.fit === "best" ? "Recommended" : "Good fit"}
            </span>
          )}
          <span className="badge neutral">{template.category}</span>
        </div>
      </div>
      <h3>{template.name}</h3>
      <p>{template.description}</p>
      {recommendation && (
        <p className="template-recommendation-reason">
          <Sparkles size={13} aria-hidden="true" /> {recommendation.reason}
        </p>
      )}
      <div className="template-meta">
        <span>
          <Clock3 size={14} /> About {template.setupMinutes} min
        </span>
        <span>
          <GitBranch size={14} /> {template.workflow.nodes.length} safe steps
        </span>
      </div>
      <div className="template-editable">
        <strong>You personalize</strong>
        <span>{template.editableSummary}</span>
      </div>
      <button className="button dark compact" onClick={onUse}>
        Use this template <CopyPlus size={16} />
      </button>
    </article>
  );
}

function WorkflowLibrary({
  assistantPurpose,
  workflows,
  onUseTemplate,
  onOpen,
  onCreateCustom,
  onArchive,
  onDelete,
}: {
  assistantPurpose: AssistantPurpose;
  workflows: SavedWorkflow[];
  onUseTemplate: (templateId: string) => void;
  onOpen: (workflow: SavedWorkflow) => void;
  onCreateCustom: () => void;
  onArchive: (workflowId: string, archived: boolean) => void;
  onDelete: (workflowId: string) => void;
}) {
  const [tab, setTab] = useState<"mine" | "templates">(
    workflows.length > 0 ? "mine" : "templates",
  );
  const purposePreset =
    getAssistantPurposePreset(assistantPurpose) ??
    getAssistantPurposePreset("custom")!;
  const recommendations = getWorkflowRecommendations(assistantPurpose);
  const recommendationByTemplate = new Map(
    recommendations.map((recommendation) => [
      recommendation.templateId,
      recommendation,
    ]),
  );
  const orderedTemplates = [...workflowTemplates].sort((left, right) => {
    const fitScore = (templateId: string) => {
      const fit = recommendationByTemplate.get(templateId)?.fit;
      return fit === "best" ? 0 : fit === "good" ? 1 : 2;
    };
    return fitScore(left.id) - fitScore(right.id);
  });
  const bestRecommendation = recommendations[0];
  const bestTemplate = workflowTemplates.find(
    (template) => template.id === bestRecommendation?.templateId,
  );
  return (
    <section className="workflow-library" aria-label="Workflow library">
      <div className="workflow-library-bar">
        <div className="workflow-library-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "mine"}
            className={tab === "mine" ? "active" : ""}
            onClick={() => setTab("mine")}
          >
            <FolderOpen size={16} /> My workflows
            <span>{workflows.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "templates"}
            className={tab === "templates" ? "active" : ""}
            onClick={() => setTab("templates")}
          >
            <LayoutTemplate size={16} /> Template library
            <span>{workflowTemplates.length}</span>
          </button>
        </div>
        <button className="button outline compact" onClick={onCreateCustom}>
          <Plus size={16} /> Create custom workflow
        </button>
      </div>

      {tab === "templates" ? (
        <>
          <div className="workflow-library-heading-row">
            <div className="workflow-library-intro">
              <span className="eyebrow">READY-TO-USE STARTING POINTS</span>
              <h2>Choose the closest fit.</h2>
              <p>
                The safe workflow structure is already prepared. Users only add
                their own business information and choose connected services.
              </p>
            </div>
            {bestTemplate && bestRecommendation && (
              <aside className="workflow-purpose-recommendation">
                <span className="workflow-recommendation-icon">
                  <Sparkles size={18} aria-hidden="true" />
                </span>
                <div>
                  <span className="eyebrow">
                    RECOMMENDED FOR {purposePreset.label.toUpperCase()}
                  </span>
                  <h3>{bestTemplate.name} is the closest fit.</h3>
                  <p>{bestRecommendation.reason}</p>
                  <small>
                    Suggestion only · Nothing is added until you choose a
                    template.
                  </small>
                </div>
              </aside>
            )}
          </div>
          <div className="workflow-template-grid">
            {orderedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                recommendation={recommendationByTemplate.get(template.id)}
                onUse={() => onUseTemplate(template.id)}
              />
            ))}
          </div>
        </>
      ) : workflows.length > 0 ? (
        <div className="my-workflow-grid">
          {workflows.map((item) => {
            const template = workflowTemplates.find(
              (candidate) => candidate.id === item.sourceTemplateId,
            );
            return (
              <article className="my-workflow-card" key={item.workflow.id}>
                <span
                  className={`workflow-status-mark ${item.structureLocked ? "guided" : "custom"}`}
                >
                  {item.structureLocked ? (
                    <LayoutTemplate size={18} />
                  ) : (
                    <GitBranch size={18} />
                  )}
                </span>
                <div>
                  <div className="workflow-card-badges">
                    <span className="badge pale">
                      {template?.name ?? "Custom workflow"}
                    </span>
                    <span className={`workflow-lifecycle ${item.lifecycle}`}>
                      {item.lifecycle}
                    </span>
                  </div>
                  <h3>{item.workflow.name}</h3>
                  <p>
                    {item.workflow.nodes.length} steps · Saved{" "}
                    {new Date(item.updatedAt).toLocaleDateString()} ·{" "}
                    {item.publishedVersions.length === 0
                      ? "No published versions"
                      : `${item.publishedVersions.length} published version${item.publishedVersions.length === 1 ? "" : "s"}`}
                  </p>
                  {item.publishedVersions.length > 0 && (
                    <details className="version-history">
                      <summary>
                        <History size={14} /> Version history
                      </summary>
                      <ul>
                        {[...item.publishedVersions]
                          .reverse()
                          .map((version) => (
                            <li key={version.version}>
                              <strong>Version {version.version}</strong>
                              <span>
                                {version.nodes.length} steps · immutable
                              </span>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="my-workflow-actions">
                  <button
                    className="button dark compact"
                    onClick={() => onOpen(item)}
                    disabled={item.compatibility === "incompatible"}
                  >
                    <Pencil size={15} /> Edit information
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${item.lifecycle === "archived" ? "Restore" : "Archive"} ${item.workflow.name}`}
                    title={
                      item.lifecycle === "archived"
                        ? "Restore workflow"
                        : "Archive workflow"
                    }
                    onClick={() =>
                      onArchive(item.workflow.id, item.lifecycle !== "archived")
                    }
                  >
                    <Archive size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${item.workflow.name}`}
                    onClick={() => onDelete(item.workflow.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="workflow-library-empty">
          <span>
            <FolderOpen size={28} />
          </span>
          <h2>No saved workflows yet.</h2>
          <p>
            Start with a ready template. Your personalized copy will appear here
            after you save it.
          </p>
          <button
            className="button dark compact"
            onClick={() => setTab("templates")}
          >
            Browse templates
          </button>
        </div>
      )}
    </section>
  );
}

export function WorkflowBuilder({
  assistantPurpose,
  onReadinessChange,
}: {
  assistantPurpose: AssistantPurpose;
  onReadinessChange: (readiness: WorkflowReadiness) => void;
}) {
  const [workflows, setWorkflows] =
    useState<SavedWorkflow[]>(readSavedWorkflows);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  /** A newer copy of the workflow that is open, waiting to be taken. */
  const [incoming, setIncoming] = useState<EditorDraft | null>(null);

  // The Copilot writes workflows on the server, and the sync takes the new
  // copy into this browser. Without this the library keeps showing the one
  // it read when the page opened, and an owner who just asked for a change
  // is looking at the version before it.
  useEffect(() => {
    const onPulled = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key !== "workflows") return;
      const latest = readSavedWorkflows();
      setWorkflows(latest);
      onReadinessChange(summarizeWorkflowReadiness(latest));

      // The open editor is not replaced outright: doing that underneath
      // somebody mid-edit would throw away what they are typing. It is
      // offered instead, so taking it is their decision.
      if (!editor) return;
      const fresh = latest.find(
        (item) => item.workflow.id === editor.workflow.id,
      );
      setIncoming(
        fresh &&
          JSON.stringify(fresh.workflow) !== JSON.stringify(editor.workflow)
          ? fresh
          : null,
      );
    };
    window.addEventListener(WORKSPACE_PULLED_EVENT, onPulled);
    return () => window.removeEventListener(WORKSPACE_PULLED_EVENT, onPulled);
  }, [editor, onReadinessChange]);

  function persist(next: SavedWorkflow[]) {
    setWorkflows(next);
    onReadinessChange(summarizeWorkflowReadiness(next));
    persistLocal("workflows", {
      formatVersion: WORKFLOW_STORAGE_VERSION,
      workflows: next,
    });
  }

  function useTemplate(templateId: string) {
    const workflow = createWorkflowFromTemplate(
      templateId,
      `workflow-${crypto.randomUUID()}`,
    );
    if (!workflow) return;
    setEditor(
      createWorkflowRecord(workflow, {
        sourceTemplateId: templateId,
        structureLocked: true,
      }),
    );
  }

  function createCustom() {
    setEditor(
      createWorkflowRecord(
        {
          ...structuredClone(salonReceptionWorkflow),
          id: `workflow-${crypto.randomUUID()}`,
          name: "Untitled custom workflow",
        },
        { structureLocked: false },
      ),
    );
  }

  function saveWorkflow(draft: EditorDraft) {
    const next = [
      draft,
      ...workflows.filter((item) => item.workflow.id !== draft.workflow.id),
    ];
    persist(next);
    setEditor(draft);
  }

  function publishWorkflow(draft: EditorDraft, definition: WorkflowDefinition) {
    const published = publishWorkflowVersion(draft, definition);
    saveWorkflow(published);
  }

  function archiveWorkflow(workflowId: string, archived: boolean) {
    persist(
      workflows.map((item) =>
        item.workflow.id === workflowId
          ? setWorkflowArchived(item, archived)
          : item,
      ),
    );
  }

  function deleteWorkflow(workflowId: string) {
    persist(workflows.filter((item) => item.workflow.id !== workflowId));
  }

  return (
    <ReactFlowProvider>
      {editor ? (
        <>
          {incoming && (
            <p className="workflow-pulled-notice" role="status">
              <RefreshCw size={14} aria-hidden="true" />
              <span>
                “{incoming.workflow.name}” was changed somewhere else — in the
                Copilot, or in another tab.
              </span>
              <button
                type="button"
                className="button dark compact"
                onClick={() => {
                  setEditor(incoming);
                  setIncoming(null);
                }}
              >
                Load that version
              </button>
              <button
                type="button"
                className="button outline compact"
                onClick={() => setIncoming(null)}
              >
                Keep editing
              </button>
            </p>
          )}
          <BuilderCanvas
            // Remounted so the canvas seeds itself from the copy just taken;
            // its node and edge state is initialised from the draft once.
            key={`${editor.workflow.id}:${editor.updatedAt}`}
            draft={editor}
            onBack={() => {
              setEditor(null);
              setIncoming(null);
            }}
            onSave={saveWorkflow}
            onPublish={publishWorkflow}
          />
        </>
      ) : (
        <WorkflowLibrary
          assistantPurpose={assistantPurpose}
          workflows={workflows}
          onUseTemplate={useTemplate}
          onOpen={(workflow) => setEditor(workflow)}
          onCreateCustom={createCustom}
          onArchive={archiveWorkflow}
          onDelete={deleteWorkflow}
        />
      )}
    </ReactFlowProvider>
  );
}
