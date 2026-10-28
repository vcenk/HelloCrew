import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";

import { ZodError } from "zod";

import type { Activity } from "@/lib/demo";
import type { AgentContext } from "./context";
import { buildSystemPrompt } from "./prompt";
import {
  buildTools,
  effectsByName,
  type Handoff,
  type Lead,
  type PendingApproval,
  type TurnEffects,
} from "./tools";
import {
  leftAnApproval,
  type IntegrationId,
  type ToolContract,
} from "./tool-contract";

/** What the model is told about a rejected tool call, in its own terms. */
function reasonFor(error: unknown): string {
  if (error instanceof ZodError)
    return error.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join(".")} — ${issue.message}` : issue.message,
      )
      .join("; ");
  return error instanceof Error && error.message
    ? error.message
    : "they did not pass validation";
}

export const MAX_MODEL_ROUNDS = 3;
export const MAX_HISTORY_MESSAGES = 20;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AgentTurnResult = {
  reply: string;
  activity: Activity[];
  approvals: PendingApproval[];
  handoffs: Handoff[];
  leads: Lead[];
  usage: { inputTokens: number; outputTokens: number; modelRounds: number };
  // True when the crew had no approved answer, so the owner can teach one.
  unanswered: boolean;
};

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  rounds: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  activity: Annotation<Activity[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

function toolLabel(name: string) {
  return (
    {
      search_knowledge: "Searched approved knowledge",
      get_business_details: "Read business details",
      request_booking: "Prepared a booking request",
      handoff_to_human: "Passed to a person",
      capture_lead: "Saved a lead",
    }[name] ?? name
  );
}

export type AgentTurnOptions = {
  /** Integrations the business has actually connected. */
  connected?: ReadonlySet<IntegrationId>;
  /** Contracts those integrations bring, e.g. the calendar tools. */
  extraContracts?: ToolContract[];
};

export function buildAgentGraph(
  model: BaseChatModel,
  context: AgentContext,
  effects: TurnEffects,
  options: AgentTurnOptions = {},
) {
  const { connected, extraContracts = [] } = options;
  const tools = buildTools(context, effects, connected, extraContracts);
  const byName = new Map<string, StructuredToolInterface>(
    tools.map((t) => [t.name, t]),
  );
  // Effects come from the contracts offered this turn, so a tool can never be
  // runnable without a declared effect.
  const effectOf = effectsByName(context, effects, connected, extraContracts);
  if (!model.bindTools) throw new Error("Model does not support tools.");
  const withTools = model.bindTools(tools);
  const system = new SystemMessage(buildSystemPrompt(context, connected));

  async function agent(state: typeof AgentState.State) {
    // On the last allowed round the model must answer without more tools.
    const runnable = state.rounds + 1 >= MAX_MODEL_ROUNDS ? model : withTools;
    const response = await runnable.invoke([system, ...state.messages]);
    return { messages: [response], rounds: state.rounds + 1 };
  }

  // Policy gate: only registered tools run, with schema-validated arguments.
  // Effects that need the owner are recorded, never executed here.
  async function runTools(state: typeof AgentState.State) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const results: BaseMessage[] = [];
    const activity: Activity[] = [];
    for (const call of last.tool_calls ?? []) {
      const selected = byName.get(call.name);
      const id = call.id ?? crypto.randomUUID();
      if (!selected || !(call.name in effectOf)) {
        results.push(
          new ToolMessage({ tool_call_id: id, content: "Tool not available." }),
        );
        activity.push({
          label: "Blocked an unknown tool",
          detail: call.name,
          kind: "error",
        });
        continue;
      }
      try {
        const output = String(await selected.invoke(call.args));
        results.push(new ToolMessage({ tool_call_id: id, content: output }));
        // A tool allowed to ask for approval has not necessarily asked: the
        // slot may have gone, or the request may be one already waiting. The
        // trace follows what the call did, not what it was permitted to do.
        const pending =
          effectOf[call.name] === "needs_approval" && leftAnApproval(output);
        activity.push({
          label: toolLabel(call.name),
          detail: pending
            ? "Waiting for your approval. Nothing was booked."
            : effectOf[call.name] === "needs_approval"
              ? "Nothing was sent for your approval."
              : call.name === "search_knowledge"
                ? `Query: ${String((call.args as { query?: string }).query ?? "")}`
                : "Ran with your approved information.",
          kind: pending ? "approval" : "tool",
        });
      } catch (error) {
        // Say what was wrong. "The tool rejected those arguments" gives the
        // model nothing to correct, so it either gives up or guesses again —
        // and a booking tool that fails silently loses a real customer.
        const reason = reasonFor(error);
        results.push(
          new ToolMessage({
            tool_call_id: id,
            content: `The tool rejected those arguments: ${reason}. Correct them and call it again.`,
          }),
        );
        activity.push({
          label: `${toolLabel(call.name)} failed`,
          detail: reason,
          kind: "error",
        });
      }
    }
    return { messages: results, activity };
  }

  return new StateGraph(AgentState)
    .addNode("agent", agent)
    .addNode("tools", runTools)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => {
      const last = state.messages[state.messages.length - 1] as AIMessage;
      return last.tool_calls?.length && state.rounds < MAX_MODEL_ROUNDS
        ? "tools"
        : END;
    })
    .addEdge("tools", "agent")
    .compile();
}

function textOf(message: BaseMessage | undefined): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part.type === "text" && "text" in part
          ? String(part.text)
          : "",
    )
    .join("");
}

export async function runAgentTurn(
  model: BaseChatModel,
  context: AgentContext,
  history: ChatTurn[],
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  const effects: TurnEffects = { approvals: [], handoffs: [], leads: [] };
  const graph = buildAgentGraph(model, context, effects, options);
  const messages = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((turn) =>
      turn.role === "user"
        ? new HumanMessage(turn.content)
        : new AIMessage(turn.content),
    );
  const output = await graph.invoke(
    { messages, rounds: 0, activity: [] },
    { recursionLimit: MAX_MODEL_ROUNDS * 2 + 2 },
  );

  let inputTokens = 0;
  let outputTokens = 0;
  for (const message of output.messages) {
    const usage = (message as AIMessage).usage_metadata;
    if (usage) {
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
    }
  }
  const finalMessage = [...output.messages]
    .reverse()
    .find((m) => m instanceof AIMessage || m.getType() === "ai");
  const reply = textOf(finalMessage).trim() || context.identity.fallback;

  const fallbackStart = context.identity.fallback.slice(0, 32).toLowerCase();
  const unanswered =
    (fallbackStart.length > 10 && reply.toLowerCase().includes(fallbackStart)) ||
    output.messages.some(
      (m) =>
        m.getType() === "tool" &&
        String(m.content) === "No approved information matches.",
    );

  return {
    reply,
    unanswered,
    activity: [
      ...output.activity,
      {
        label: "Reply written",
        detail: `${output.rounds} model call${output.rounds === 1 ? "" : "s"}, grounded in your approved knowledge.`,
        kind: "done",
      },
    ],
    approvals: effects.approvals,
    handoffs: effects.handoffs,
    leads: effects.leads,
    usage: { inputTokens, outputTokens, modelRounds: output.rounds },
  };
}
