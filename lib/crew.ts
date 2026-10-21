import { z } from "zod";

// The crew: agents with one job each. Today only the website receptionist is
// live; other jobs are listed so the dashboard can show what is coming.
export const CREW_STORAGE_KEY = "hellocrew:crew:v1";

export const skillModes = ["off", "ask", "auto"] as const;
export type SkillMode = (typeof skillModes)[number];

export type SkillId = "answer" | "booking" | "handoff" | "leads";

export type SkillDefinition = {
  id: SkillId;
  title: string;
  summary: string;
  // Modes the owner may choose today. "auto" for bookings needs a calendar.
  allowed: readonly SkillMode[];
  defaultMode: SkillMode;
  locked?: string;
  comingSoon?: boolean;
};

export const receptionistSkills: readonly SkillDefinition[] = [
  {
    id: "answer",
    title: "Answer questions",
    summary: "Hours, prices, services and policies, only from your knowledge.",
    allowed: ["auto"],
    defaultMode: "auto",
    locked: "Always on: this is the receptionist’s main job.",
  },
  {
    id: "booking",
    title: "Booking requests",
    summary: "Collects the service, time and name, then asks you to approve.",
    allowed: ["off", "ask"],
    defaultMode: "ask",
    locked: "Booking on its own needs a connected calendar.",
  },
  {
    id: "handoff",
    title: "Pass to a person",
    summary: "Complaints, refunds, sensitive topics, or when a customer asks.",
    allowed: ["off", "auto"],
    defaultMode: "auto",
  },
  {
    id: "leads",
    title: "Capture leads",
    summary: "Takes a name and phone or email when someone wants a quote, a call back, or an answer it doesn’t have.",
    allowed: ["off", "auto"],
    defaultMode: "auto",
    locked: "Uses live AI. Leads appear on Today.",
  },
];

export const crewJobs = [
  { job: "receptionist", title: "Receptionist", channels: "Website, Messenger, Instagram, WhatsApp", available: true, href: "/app/crew/receptionist" },
  { job: "reviews", title: "Reputation manager", channels: "Google reviews, Facebook and Instagram comments", available: true, href: "/app/crew/reputation" },
  { job: "phone", title: "Phone receptionist", channels: "Phone calls", available: false, href: null },
] as const;

// When the Reputation manager may post a public reply without the owner.
export const postingModes = ["ask", "positive", "auto"] as const;
export type PostingMode = (typeof postingModes)[number];
export const postingModeLabel: Record<PostingMode, string> = {
  ask: "Ask me first",
  positive: "Positive on its own",
  auto: "Always on its own",
};
export const postingModeHelp: Record<PostingMode, string> = {
  ask: "Every reply waits for your OK.",
  positive: "Thank-yous and simple questions post on their own. Complaints and reviews under 4 stars wait for you.",
  auto: "Every reply posts on its own. You can still see and delete them on the platform.",
};

const skillsSchema = z
  .object({
    answer: z.enum(skillModes),
    booking: z.enum(skillModes),
    handoff: z.enum(skillModes),
    leads: z.enum(skillModes),
  })
  .strict();

const memberSchema = z
  .object({
    id: z.literal("receptionist"),
    job: z.literal("receptionist"),
    skills: skillsSchema,
  })
  .strict();

export const crewStoreSchema = z
  .object({
    formatVersion: z.literal(1),
    members: z.array(memberSchema).min(1).max(1),
    reputation: z.object({ posting: z.enum(postingModes) }).strict().optional(),
  })
  .strict();

export type CrewStore = z.infer<typeof crewStoreSchema>;
export type CrewMember = CrewStore["members"][number];

export const defaultCrew: CrewStore = {
  formatVersion: 1,
  members: [
    {
      id: "receptionist",
      job: "receptionist",
      skills: { answer: "auto", booking: "ask", handoff: "auto", leads: "auto" },
    },
  ],
};

// Normalizes a stored crew, clamping every skill to a mode allowed today.
export function parseCrewStore(input: unknown): CrewStore {
  const parsed = crewStoreSchema.safeParse(input);
  if (!parsed.success) return structuredClone(defaultCrew);
  const member = parsed.data.members[0];
  const skills = { ...member.skills };
  for (const skill of receptionistSkills)
    if (!skill.allowed.includes(skills[skill.id])) skills[skill.id] = skill.defaultMode;
  return {
    formatVersion: 1,
    members: [{ ...member, skills }],
    reputation: { posting: parsed.data.reputation?.posting ?? "ask" },
  };
}

export function postingModeOf(store: CrewStore): PostingMode {
  return store.reputation?.posting ?? "ask";
}

export function setPostingMode(store: CrewStore, posting: PostingMode): CrewStore {
  return { ...store, reputation: { posting } };
}

// Decides whether a drafted public reply may go out without the owner.
// "positive" needs a clearly positive or neutral item: 4+ stars for reviews,
// and the drafting model's tone check for comments.
export function mayAutoPost(
  mode: PostingMode,
  item: { rating?: number | null; positive?: boolean; tone: "positive" | "neutral" | "negative" },
) {
  if (mode === "auto") return true;
  if (mode === "ask") return false;
  if (item.tone === "negative") return false;
  if (item.rating != null) return item.rating >= 4;
  if (item.positive === false) return false;
  return true;
}

export function setSkillMode(store: CrewStore, skill: SkillId, mode: SkillMode): CrewStore {
  const definition = receptionistSkills.find((s) => s.id === skill);
  if (!definition || !definition.allowed.includes(mode)) return store;
  const [member] = store.members;
  return { ...store, members: [{ ...member, skills: { ...member.skills, [skill]: mode } }] };
}
