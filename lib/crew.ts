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
    summary: "Asks for a name and email when someone wants a quote or call back.",
    allowed: ["off"],
    defaultMode: "off",
    comingSoon: true,
  },
];

export const crewJobs = [
  { job: "receptionist", title: "Website receptionist", channels: "Website chat", available: true },
  { job: "whatsapp", title: "WhatsApp receptionist", channels: "WhatsApp Business", available: false },
  { job: "reviews", title: "Review manager", channels: "Google reviews", available: false },
  { job: "phone", title: "Phone receptionist", channels: "Phone calls", available: false },
] as const;

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
  .object({ formatVersion: z.literal(1), members: z.array(memberSchema).min(1).max(1) })
  .strict();

export type CrewStore = z.infer<typeof crewStoreSchema>;
export type CrewMember = CrewStore["members"][number];

export const defaultCrew: CrewStore = {
  formatVersion: 1,
  members: [
    {
      id: "receptionist",
      job: "receptionist",
      skills: { answer: "auto", booking: "ask", handoff: "auto", leads: "off" },
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
  return { formatVersion: 1, members: [{ ...member, skills }] };
}

export function setSkillMode(store: CrewStore, skill: SkillId, mode: SkillMode): CrewStore {
  const definition = receptionistSkills.find((s) => s.id === skill);
  if (!definition || !definition.allowed.includes(mode)) return store;
  const [member] = store.members;
  return { ...store, members: [{ ...member, skills: { ...member.skills, [skill]: mode } }] };
}
