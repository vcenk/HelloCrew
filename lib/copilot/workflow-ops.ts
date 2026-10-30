import { z } from "zod";

import { workflowKinds, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow";
import { nodeJobDefinitions } from "@/lib/workflow-jobs";

/**
 * The only edits the Copilot can make to a workflow.
 *
 * A closed list on purpose. The model never submits a structure, a patch
 * path, a config key or a node kind of its own: it names one of these, with
 * values checked against the job definitions the builder itself uses, and
 * deterministic code does the editing. Anything it asks for that is not here
 * simply does not happen.
 */

const nodeId = z.string().min(1).max(80);

export const workflowOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_name"), name: z.string().trim().min(1).max(80) }),
  z.object({
    op: z.literal("add_node"),
    kind: z.enum(workflowKinds),
    label: z.string().trim().min(1).max(80).optional(),
    /** Insert after this node, taking over its outgoing connections. */
    after: nodeId.optional(),
  }),
  z.object({
    op: z.literal("update_node"),
    nodeId,
    /** Keys are checked against that node kind's own fields. */
    config: z.record(
      z.string().max(60),
      z.union([z.string().max(400), z.number(), z.boolean()]),
    ),
  }),
  z.object({ op: z.literal("remove_node"), nodeId }),
  z.object({ op: z.literal("connect"), source: nodeId, target: nodeId }),
  z.object({ op: z.literal("disconnect"), edgeId: z.string().min(1).max(80) }),
  z.object({
    op: z.literal("move_node"),
    nodeId,
    position: z.object({ x: z.number(), y: z.number() }),
  }),
]);

export type WorkflowOperation = z.infer<typeof workflowOperationSchema>;

export type OperationOutcome = {
  operation: WorkflowOperation;
  /** What changed, in the owner's words. */
  describes: string;
  /** Set when the operation could not be applied, and why. */
  refused?: string;
};

export type ApplyResult = {
  workflow: WorkflowDefinition;
  outcomes: OperationOutcome[];
};

const freshId = (prefix: string, taken: ReadonlySet<string>) => {
  for (let index = 1; ; index++) {
    const candidate = `${prefix}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** A config value the builder's own field definition would accept. */
function checkConfig(
  kind: WorkflowNode["kind"],
  config: Record<string, string | number | boolean>,
): { ok: true } | { ok: false; reason: string } {
  const fields = nodeJobDefinitions[kind]?.fields ?? [];
  const byKey = new Map(fields.map((field) => [field.key, field]));

  for (const [key, value] of Object.entries(config)) {
    const field = byKey.get(key);
    if (!field)
      return {
        ok: false,
        reason: `“${key}” is not a setting on this step. It has: ${
          fields.map((f) => f.key).join(", ") || "no settings"
        }.`,
      };
    if (field.type === "number" && typeof value !== "number")
      return { ok: false, reason: `“${field.label}” is a number.` };
    if (field.type === "toggle" && typeof value !== "boolean")
      return { ok: false, reason: `“${field.label}” is on or off.` };
    if (field.type === "select") {
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!allowed.includes(String(value)))
        return {
          ok: false,
          reason: `“${field.label}” must be one of: ${allowed.join(", ")}.`,
        };
    }
  }
  return { ok: true };
}

/**
 * Applies operations in order to a copy of the workflow.
 *
 * Never throws and never half-applies a single operation: one that cannot be
 * carried out is recorded as refused, with a reason the owner can read, and
 * the rest still run. The caller validates the result before anything is
 * saved, so a refusal is information rather than a failure.
 */
export function applyWorkflowOperations(
  input: WorkflowDefinition,
  operations: readonly WorkflowOperation[],
): ApplyResult {
  let workflow: WorkflowDefinition = structuredClone(input);
  const outcomes: OperationOutcome[] = [];

  const refuse = (operation: WorkflowOperation, reason: string) =>
    outcomes.push({ operation, describes: reason, refused: reason });
  const did = (operation: WorkflowOperation, describes: string) =>
    outcomes.push({ operation, describes });

  for (const operation of operations) {
    const nodes = workflow.nodes;
    const find = (id: string) => nodes.find((node) => node.id === id);

    switch (operation.op) {
      case "set_name": {
        workflow = { ...workflow, name: operation.name };
        did(operation, `Renamed the workflow to “${operation.name}”.`);
        break;
      }

      case "add_node": {
        const job = nodeJobDefinitions[operation.kind];
        const id = freshId(
          operation.kind.replace(/\./g, "-"),
          new Set(nodes.map((node) => node.id)),
        );
        const anchor = operation.after ? find(operation.after) : undefined;
        if (operation.after && !anchor) {
          refuse(operation, `There is no step called “${operation.after}”.`);
          break;
        }
        const node: WorkflowNode = {
          id,
          kind: operation.kind,
          label: operation.label ?? job?.title ?? operation.kind,
          description: job?.summary ?? "",
          position: anchor
            ? { x: anchor.position.x + 220, y: anchor.position.y }
            : { x: 80 + nodes.length * 220, y: 120 },
          config: {},
        };

        // Inserted into the flow rather than dropped beside it: a new step
        // nobody connected is an unreachable node, which will not validate.
        const rewired = anchor
          ? workflow.edges.map((edge) =>
              edge.source === anchor.id ? { ...edge, source: id } : edge,
            )
          : workflow.edges;
        workflow = {
          ...workflow,
          nodes: [...nodes, node],
          edges: anchor
            ? [
                ...rewired,
                { id: freshId("edge", new Set(workflow.edges.map((e) => e.id))), source: anchor.id, target: id },
              ]
            : workflow.edges,
        };
        did(operation, `Added “${node.label}”${anchor ? ` after “${anchor.label}”` : ""}.`);
        break;
      }

      case "update_node": {
        const node = find(operation.nodeId);
        if (!node) {
          refuse(operation, `There is no step called “${operation.nodeId}”.`);
          break;
        }
        const checked = checkConfig(node.kind, operation.config);
        if (!checked.ok) {
          refuse(operation, checked.reason);
          break;
        }
        workflow = {
          ...workflow,
          nodes: nodes.map((candidate) =>
            candidate.id === node.id
              ? { ...candidate, config: { ...candidate.config, ...operation.config } }
              : candidate,
          ),
        };
        did(operation, `Changed ${Object.keys(operation.config).join(", ")} on “${node.label}”.`);
        break;
      }

      case "remove_node": {
        const node = find(operation.nodeId);
        if (!node) {
          refuse(operation, `There is no step called “${operation.nodeId}”.`);
          break;
        }
        // Bridged rather than cut: deleting a step in the middle would strand
        // everything after it, and the workflow would stop validating for a
        // reason that has nothing to do with what was asked.
        const incoming = workflow.edges.filter((edge) => edge.target === node.id);
        const outgoing = workflow.edges.filter((edge) => edge.source === node.id);
        const kept = workflow.edges.filter(
          (edge) => edge.source !== node.id && edge.target !== node.id,
        );
        const taken = new Set(workflow.edges.map((edge) => edge.id));
        const bridges = incoming.flatMap((from) =>
          outgoing.map((to) => {
            const id = freshId("edge", taken);
            taken.add(id);
            return { id, source: from.source, target: to.target };
          }),
        );
        workflow = {
          ...workflow,
          nodes: nodes.filter((candidate) => candidate.id !== node.id),
          edges: [...kept, ...bridges],
        };
        did(operation, `Removed “${node.label}”.`);
        break;
      }

      case "connect": {
        const source = find(operation.source);
        const target = find(operation.target);
        if (!source || !target) {
          refuse(operation, "One of those steps does not exist.");
          break;
        }
        if (
          workflow.edges.some(
            (edge) => edge.source === source.id && edge.target === target.id,
          )
        ) {
          refuse(operation, `“${source.label}” already leads to “${target.label}”.`);
          break;
        }
        workflow = {
          ...workflow,
          edges: [
            ...workflow.edges,
            {
              id: freshId("edge", new Set(workflow.edges.map((edge) => edge.id))),
              source: source.id,
              target: target.id,
            },
          ],
        };
        did(operation, `Connected “${source.label}” to “${target.label}”.`);
        break;
      }

      case "disconnect": {
        const edge = workflow.edges.find((candidate) => candidate.id === operation.edgeId);
        if (!edge) {
          refuse(operation, "That connection no longer exists.");
          break;
        }
        workflow = {
          ...workflow,
          edges: workflow.edges.filter((candidate) => candidate.id !== edge.id),
        };
        did(operation, "Removed a connection.");
        break;
      }

      case "move_node": {
        const node = find(operation.nodeId);
        if (!node) {
          refuse(operation, `There is no step called “${operation.nodeId}”.`);
          break;
        }
        workflow = {
          ...workflow,
          nodes: nodes.map((candidate) =>
            candidate.id === node.id
              ? { ...candidate, position: operation.position }
              : candidate,
          ),
        };
        did(operation, `Moved “${node.label}”.`);
        break;
      }
    }
  }

  return { workflow, outcomes };
}
