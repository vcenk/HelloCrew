"use client";

import { useCallback, useMemo, useState } from "react";
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
  Bot,
  BookOpen,
  CalendarPlus,
  Check,
  CircleAlert,
  GitBranch,
  Globe,
  Hand,
  Inbox,
  MessageSquareReply,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  salonReceptionWorkflow,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowKind,
} from "@/lib/workflow";

type CanvasData = {
  kind: WorkflowKind;
  label: string;
  description: string;
  config: Record<string, string | number | boolean>;
  [key: string]: unknown;
};

type CanvasNode = Node<CanvasData, "workflow">;

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
    kind: "handoff.inbox",
    label: "Human inbox",
    description: "Hands context to the team.",
    icon: Inbox,
    group: "Finish",
  },
  {
    kind: "output.reply",
    label: "Send reply",
    description: "Returns the final response.",
    icon: MessageSquareReply,
    group: "Finish",
  },
];

const iconByKind = Object.fromEntries(
  palette.map((item) => [item.kind, item.icon]),
) as Record<WorkflowKind, typeof Globe>;

const categoryByKind: Record<WorkflowKind, string> = {
  "trigger.website": "trigger",
  "knowledge.search": "knowledge",
  "ai.respond": "ai",
  "logic.confidence": "logic",
  "approval.owner": "approval",
  "action.booking": "action",
  "handoff.inbox": "handoff",
  "output.reply": "output",
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
    animated: edge.source === "website-message",
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

function BuilderCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toCanvasNodes(salonReceptionWorkflow),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    toCanvasEdges(salonReceptionWorkflow),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const definition = useMemo<WorkflowDefinition>(
    () => ({
      ...salonReceptionWorkflow,
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
    [edges, nodes],
  );
  const issues = useMemo(() => validateWorkflow(definition), [definition]);
  const selected = nodes.find((node) => node.id === selectedId);

  const onConnect = useCallback(
    (connection: Connection) => {
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
    [setEdges],
  );

  function addNode(kind: WorkflowKind) {
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

  function removeSelected() {
    if (!selectedId) return;
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
    setNodes(toCanvasNodes(salonReceptionWorkflow));
    setEdges(toCanvasEdges(salonReceptionWorkflow));
    setSelectedId(null);
    setSaved(false);
  }

  function saveDraft() {
    if (issues.length > 0) return;
    localStorage.setItem(
      "hellocrew:workflow-draft:v1",
      JSON.stringify(definition),
    );
    setSaved(true);
  }

  return (
    <section className="workflow-builder" aria-label="Workflow builder">
      <div className="workflow-toolbar">
        <div>
          <span className="badge pale">Local draft · Version 1</span>
          <h2>Salon reception assistant</h2>
          <p>Website questions, safe booking requests, and human backup.</p>
        </div>
        <div className="workflow-toolbar-actions">
          <button className="button outline compact" onClick={resetTemplate}>
            <RotateCcw size={15} /> Reset template
          </button>
          <button
            className="button dark compact"
            onClick={saveDraft}
            disabled={issues.length > 0}
          >
            {saved ? <Check size={15} /> : <Save size={15} />}
            {saved ? "Saved in this browser" : "Save local draft"}
          </button>
        </div>
      </div>

      <div className="workflow-workspace">
        <aside className="node-library" aria-label="Node library">
          <div className="builder-panel-heading">
            <span>Node library</span>
            <small>Click to add</small>
          </div>
          {(["Start", "Think", "Act", "Finish"] as const).map((group) => (
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
          ))}
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
              onEdgesChange(changes);
              setSaved(false);
            }}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.5}
            deleteKeyCode={["Backspace", "Delete"]}
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
            Drag nodes · Pull from a dot to connect
          </div>
        </div>

        <aside className="node-inspector" aria-label="Node settings">
          <div className="builder-panel-heading">
            <span>Settings</span>
            <small>{selected ? "1 selected" : "Nothing selected"}</small>
          </div>
          {selected ? (
            <>
              <span
                className={`inspector-icon ${categoryByKind[selected.data.kind]}`}
              >
                {(() => {
                  const Icon = iconByKind[selected.data.kind];
                  return <Icon size={18} />;
                })()}
              </span>
              <label>
                Name
                <input
                  value={selected.data.label}
                  maxLength={80}
                  onChange={(event) =>
                    updateSelected("label", event.target.value)
                  }
                />
              </label>
              <label>
                What it does
                <textarea
                  value={selected.data.description}
                  maxLength={240}
                  onChange={(event) =>
                    updateSelected("description", event.target.value)
                  }
                />
              </label>
              <div className="node-config-preview">
                <strong>Configuration</strong>
                {Object.keys(selected.data.config).length > 0 ? (
                  <dl>
                    {Object.entries(selected.data.config).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                ) : (
                  <p>Provider settings will appear here after connection.</p>
                )}
              </div>
              <button className="delete-node" onClick={removeSelected}>
                <Trash2 size={15} /> Remove node
              </button>
            </>
          ) : (
            <div className="inspector-empty">
              <GitBranch size={28} />
              <strong>Select a node</strong>
              <p>Edit its label and review its safe defaults here.</p>
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
              Every path starts correctly, reaches an outcome, and booking is
              protected by owner approval.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <BuilderCanvas />
    </ReactFlowProvider>
  );
}
