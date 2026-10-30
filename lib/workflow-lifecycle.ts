import {
  parseWorkflowDefinition,
  validateWorkflow,
  type WorkflowDefinition,
} from "./workflow";

export const WORKFLOW_STORAGE_VERSION = 2;

export type WorkflowLifecycle = "draft" | "published" | "archived";
export type WorkflowCompatibility = "current" | "incompatible";

export type WorkflowRecord = {
  formatVersion: number;
  workflow: WorkflowDefinition;
  sourceTemplateId?: string;
  structureLocked: boolean;
  lifecycle: WorkflowLifecycle;
  compatibility: WorkflowCompatibility;
  publishedVersions: WorkflowDefinition[];
  createdAt: string;
  updatedAt: string;
  /**
   * When a version was last published.
   *
   * Separate from updatedAt, which moves every time a draft is saved. Which
   * workflow serves live customers must not change because somebody opened an
   * old one in the builder and typed a character. Optional so records written
   * before this existed still load.
   */
  lastPublishedAt?: string;
};

type LegacyWorkflowRecord = {
  workflow?: unknown;
  sourceTemplateId?: unknown;
  structureLocked?: unknown;
  savedAt?: unknown;
};

export type WorkflowStore = {
  formatVersion: typeof WORKFLOW_STORAGE_VERSION;
  workflows: WorkflowRecord[];
};

function isoNow(now?: string) {
  return now ?? new Date().toISOString();
}

export function createWorkflowRecord(
  workflow: WorkflowDefinition,
  options: {
    sourceTemplateId?: string;
    structureLocked?: boolean;
    now?: string;
  } = {},
): WorkflowRecord {
  const timestamp = isoNow(options.now);
  return {
    formatVersion: WORKFLOW_STORAGE_VERSION,
    workflow: { ...structuredClone(workflow), status: "draft" },
    sourceTemplateId: options.sourceTemplateId,
    structureLocked: options.structureLocked ?? true,
    lifecycle: "draft",
    compatibility: "current",
    publishedVersions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function saveWorkflowDraft(
  record: WorkflowRecord,
  workflow: WorkflowDefinition,
  now?: string,
): WorkflowRecord {
  if (record.compatibility === "incompatible") return record;
  return {
    ...record,
    workflow: {
      ...structuredClone(workflow),
      status: record.lifecycle === "archived" ? "archived" : "draft",
    },
    lifecycle: record.lifecycle === "archived" ? "archived" : record.lifecycle,
    updatedAt: isoNow(now),
  };
}

export function publishWorkflowVersion(
  record: WorkflowRecord,
  workflow: WorkflowDefinition = record.workflow,
  now?: string,
): WorkflowRecord {
  if (record.compatibility === "incompatible")
    throw new Error("This workflow was saved by a newer HelloCrew version.");
  const issues = validateWorkflow(workflow);
  if (issues.length > 0)
    throw new Error("Fix workflow validation issues before publishing.");

  const nextVersion =
    Math.max(0, ...record.publishedVersions.map((item) => item.version)) + 1;
  const published: WorkflowDefinition = {
    ...structuredClone(workflow),
    version: nextVersion,
    status: "published",
  };
  const at = isoNow(now);
  return {
    ...record,
    workflow: {
      ...structuredClone(workflow),
      version: nextVersion,
      status: "draft",
    },
    lifecycle: "published",
    publishedVersions: [...record.publishedVersions, published],
    updatedAt: at,
    lastPublishedAt: at,
  };
}

export function setWorkflowArchived(
  record: WorkflowRecord,
  archived: boolean,
  now?: string,
): WorkflowRecord {
  const lifecycle: WorkflowLifecycle = archived
    ? "archived"
    : record.publishedVersions.length > 0
      ? "published"
      : "draft";
  return {
    ...record,
    lifecycle,
    workflow: {
      ...record.workflow,
      status: archived ? "archived" : "draft",
    },
    updatedAt: isoNow(now),
  };
}

function parseRecord(input: unknown): WorkflowRecord | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<WorkflowRecord>;
  const workflow = parseWorkflowDefinition(candidate.workflow);
  if (!workflow.success) return null;

  if (
    typeof candidate.formatVersion === "number" &&
    candidate.formatVersion > WORKFLOW_STORAGE_VERSION
  ) {
    const timestamp =
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date(0).toISOString();
    return {
      formatVersion: candidate.formatVersion,
      workflow: workflow.data,
      sourceTemplateId:
        typeof candidate.sourceTemplateId === "string"
          ? candidate.sourceTemplateId
          : undefined,
      structureLocked: candidate.structureLocked !== false,
      lifecycle: candidate.lifecycle ?? "draft",
      compatibility: "incompatible",
      publishedVersions: [],
      createdAt:
        typeof candidate.createdAt === "string"
          ? candidate.createdAt
          : timestamp,
      updatedAt: timestamp,
    };
  }

  const publishedVersions = Array.isArray(candidate.publishedVersions)
    ? candidate.publishedVersions.flatMap((item) => {
        const parsed = parseWorkflowDefinition(item);
        return parsed.success && parsed.data.status === "published"
          ? [parsed.data]
          : [];
      })
    : [];
  const timestamp =
    typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : new Date(0).toISOString();
  const lifecycle: WorkflowLifecycle =
    candidate.lifecycle === "archived" ||
    candidate.lifecycle === "published" ||
    candidate.lifecycle === "draft"
      ? candidate.lifecycle
      : publishedVersions.length > 0
        ? "published"
        : "draft";

  return {
    formatVersion: WORKFLOW_STORAGE_VERSION,
    workflow: workflow.data,
    sourceTemplateId:
      typeof candidate.sourceTemplateId === "string"
        ? candidate.sourceTemplateId
        : undefined,
    structureLocked: candidate.structureLocked !== false,
    lifecycle,
    compatibility: "current",
    publishedVersions,
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    updatedAt: timestamp,
    ...(typeof candidate.lastPublishedAt === "string"
      ? { lastPublishedAt: candidate.lastPublishedAt }
      : {}),
  };
}

function migrateLegacyRecord(input: unknown): WorkflowRecord | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as LegacyWorkflowRecord;
  const workflow = parseWorkflowDefinition(candidate.workflow);
  if (!workflow.success || typeof candidate.savedAt !== "string") return null;
  return createWorkflowRecord(workflow.data, {
    sourceTemplateId:
      typeof candidate.sourceTemplateId === "string"
        ? candidate.sourceTemplateId
        : undefined,
    structureLocked: candidate.structureLocked !== false,
    now: candidate.savedAt,
  });
}

export function parseWorkflowStore(input: unknown): WorkflowStore {
  if (Array.isArray(input)) {
    return {
      formatVersion: WORKFLOW_STORAGE_VERSION,
      workflows: input.flatMap((item) => {
        const migrated = migrateLegacyRecord(item);
        return migrated ? [migrated] : [];
      }),
    };
  }

  if (!input || typeof input !== "object")
    return { formatVersion: WORKFLOW_STORAGE_VERSION, workflows: [] };
  const candidate = input as { workflows?: unknown };
  if (!Array.isArray(candidate.workflows))
    return { formatVersion: WORKFLOW_STORAGE_VERSION, workflows: [] };
  return {
    formatVersion: WORKFLOW_STORAGE_VERSION,
    workflows: candidate.workflows.flatMap((item) => {
      const parsed = parseRecord(item);
      return parsed ? [parsed] : [];
    }),
  };
}
