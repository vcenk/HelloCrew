import { describe, expect, it } from "vitest";

import { assistantPurposes } from "../lib/assistant";
import { workflowTemplates } from "../lib/workflow";
import { getWorkflowRecommendations } from "../lib/workflow-recommendations";

describe("workflow recommendations", () => {
  it("provides a known best-fit template for every assistant purpose", () => {
    const templateIds = new Set(
      workflowTemplates.map((template) => template.id),
    );

    for (const purpose of assistantPurposes) {
      const recommendations = getWorkflowRecommendations(purpose);
      expect(recommendations[0]?.fit).toBe("best");
      expect(templateIds.has(recommendations[0]!.templateId)).toBe(true);
      expect(new Set(recommendations.map((item) => item.templateId)).size).toBe(
        recommendations.length,
      );
    }
  });

  it("matches booking assistants with the approval-gated booking starter", () => {
    expect(getWorkflowRecommendations("booking")[0]).toEqual(
      expect.objectContaining({
        templateId: "salon-reception",
        fit: "best",
      }),
    );
  });
});
