import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";

import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";
import { createWorkflowRecord } from "../lib/workflow-lifecycle";
import { workflowTemplates } from "../lib/workflow";
import {
  isWorkspaceDocumentKey,
  validateWorkspaceDocument,
} from "../lib/workspace-documents";
import { loadWorkspace, saveWorkspaceDocument } from "../app/app/actions";

describe("workspace document validation", () => {
  it("accepts each editor's real document shape", () => {
    expect(
      validateWorkspaceDocument("assistant_identity", sampleAssistantIdentity),
    ).toEqual(sampleAssistantIdentity);
    const knowledge = createKnowledgeStoreFromBusiness(sampleBusiness);
    expect(validateWorkspaceDocument("knowledge", knowledge)).toEqual(
      knowledge,
    );
    const store = {
      formatVersion: 2,
      workflows: [createWorkflowRecord(workflowTemplates[0].workflow)],
    };
    expect(validateWorkspaceDocument("workflows", store)).not.toBeNull();
  });

  it("rejects malformed, oversized or partially invalid documents", () => {
    expect(
      validateWorkspaceDocument("assistant_identity", { name: "" }),
    ).toBeNull();
    expect(
      validateWorkspaceDocument("knowledge", { formatVersion: 9 }),
    ).toBeNull();
    expect(
      validateWorkspaceDocument("workflows", { workflows: [{ bad: true }] }),
    ).toBeNull();
    expect(
      validateWorkspaceDocument("assistant_identity", {
        ...sampleAssistantIdentity,
        role: "x".repeat(500_000),
      }),
    ).toBeNull();
    expect(isWorkspaceDocumentKey("tenants")).toBe(false);
  });
});

describe("workspace actions without Supabase", () => {
  it("fall back to browser-only mode instead of failing", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      expect(await loadWorkspace()).toEqual({ status: "unavailable" });
      expect(await saveWorkspaceDocument("knowledge", 0, {})).toMatchObject({
        ok: false,
        reason: "signed_out",
      });
    } finally {
      if (url) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });
});
