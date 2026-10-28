import type { AssistantIdentity } from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import type { WorkflowReadiness } from "@/lib/workflow-readiness";

export type LaunchStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  href: string;
  action: string;
};

export type LaunchInput = {
  identity: Pick<AssistantIdentity, "name" | "greeting">;
  business: Pick<BusinessProfile, "hours" | "services" | "faqs">;
  workflowReadiness: WorkflowReadiness;
  /** True once the owner has seen at least one reply from their crew. */
  tested: boolean;
  /**
   * The connected calendar, or null when there is none.
   *
   * Null means no step: a calendar is optional, and a workspace that books
   * by hand should not be shown a setup item it can never finish.
   */
  calendar: { name: string; timeZone: string; reviewed: boolean } | null;
};

/**
 * The launch checklist, as a plain function.
 *
 * Kept out of the provider so it can be tested without rendering: the hook
 * reads the dashboard's state and hands it here, and everything about what
 * counts as done lives in one place.
 */
export function launchSteps(input: LaunchInput): LaunchStep[] {
  const { identity, business, workflowReadiness, tested, calendar } = input;
  const facts =
    (business.hours ? 1 : 0) + business.services.length + business.faqs.length;

  const steps: LaunchStep[] = [
    {
      id: "assistant",
      title: "Meet your receptionist",
      detail: `${identity.name} has a name, a greeting and a safe fallback.`,
      done: Boolean(identity.name && identity.greeting),
      href: "/app/crew/receptionist/personality",
      action: "Edit personality",
    },
    {
      id: "knowledge",
      title: "Approve what your crew may say",
      detail:
        facts > 0
          ? `${facts} approved fact${facts === 1 ? "" : "s"}: hours, services and FAQs.`
          : "Add hours, services and FAQs, then approve them.",
      done: facts > 0,
      href: "/app/knowledge",
      action: "Review knowledge",
    },
    {
      id: "workflow",
      title: "Publish a workflow",
      detail:
        workflowReadiness.status === "published"
          ? `${workflowReadiness.name} v${workflowReadiness.version} is published.`
          : workflowReadiness.status === "draft"
            ? `${workflowReadiness.name} is still a draft.`
            : "Pick a template for bookings, questions or reviews.",
      done: workflowReadiness.status === "published",
      href: "/app/workflows",
      action:
        workflowReadiness.status === "missing"
          ? "Choose a template"
          : "Open workflow",
    },
  ];

  // Only for a workspace that connected one. The timezone was copied from
  // the calendar itself, so this is the step where somebody who knows the
  // business finally looks at it.
  if (calendar)
    steps.push({
      id: "calendar",
      title: "Check the times your crew offers",
      detail: calendar.reviewed
        ? `Offering times from ${calendar.name} in ${calendar.timeZone}.`
        : `${calendar.timeZone} was taken from ${calendar.name}. Confirm it is your business's timezone.`,
      done: calendar.reviewed,
      href: "/app/connections?open=google_calendar",
      action: calendar.reviewed ? "Open working hours" : "Check the timezone",
    });

  steps.push({
    id: "test",
    title: "Test a conversation",
    detail: tested
      ? "You’ve reviewed at least one reply."
      : "Ask a few customer questions and check the answers.",
    done: tested,
    href: "/app/conversations",
    action: "Start a test chat",
  });

  return steps;
}
