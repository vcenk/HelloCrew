import type { AssistantPurpose } from "./assistant";

export type WorkflowRecommendation = {
  templateId: string;
  fit: "best" | "good";
  reason: string;
};

const recommendations: Record<
  AssistantPurpose,
  readonly WorkflowRecommendation[]
> = {
  "customer-support": [
    {
      templateId: "service-concierge",
      fit: "best",
      reason: "Built for approved FAQs, service guidance, and human follow-up.",
    },
    {
      templateId: "clinic-front-desk",
      fit: "good",
      reason:
        "A careful alternative for administrative questions and escalation.",
    },
  ],
  receptionist: [
    {
      templateId: "service-concierge",
      fit: "best",
      reason:
        "A broad welcome-and-direct flow for services, FAQs, and handoff.",
    },
    {
      templateId: "salon-reception",
      fit: "good",
      reason:
        "Adds booking preparation when reception also manages appointments.",
    },
  ],
  booking: [
    {
      templateId: "salon-reception",
      fit: "best",
      reason:
        "Combines service answers, booking preparation, approval, and handoff.",
    },
    {
      templateId: "clinic-front-desk",
      fit: "good",
      reason:
        "A stricter appointment flow for businesses that need staff review.",
    },
  ],
  sales: [
    {
      templateId: "service-concierge",
      fit: "best",
      reason:
        "Explains approved offers and guides interested visitors to a next step.",
    },
    {
      templateId: "salon-reception",
      fit: "good",
      reason: "Useful when the next sales step is a reviewed booking request.",
    },
  ],
  custom: [
    {
      templateId: "service-concierge",
      fit: "best",
      reason:
        "The most flexible starting point for approved answers and handoff.",
    },
  ],
};

export function getWorkflowRecommendations(purpose: AssistantPurpose) {
  return recommendations[purpose];
}
