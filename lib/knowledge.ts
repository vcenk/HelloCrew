import { z } from "zod";

import { bookingLinkSchema, type BusinessProfile } from "./business";

export const knowledgeKinds = [
  "hours",
  "service",
  "faq",
  "policy",
  "document",
] as const;
export const knowledgeLanguages = ["en", "fa", "zh"] as const;
export const knowledgeStatuses = ["draft", "approved", "outdated"] as const;
export const knowledgeOrigins = ["manual", "upload", "website"] as const;

export type KnowledgeKind = (typeof knowledgeKinds)[number];
export type KnowledgeLanguage = (typeof knowledgeLanguages)[number];
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];
export type KnowledgeOrigin = (typeof knowledgeOrigins)[number];

export type KnowledgeSource = {
  id: string;
  kind: KnowledgeKind;
  language: KnowledgeLanguage;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  title: string;
  content: string;
  price?: string;
  /**
   * How long this service takes, in minutes.
   *
   * On the source rather than anywhere else because the owner is already
   * here approving what the crew may say: a service's length is a fact
   * about the business, like its price.
   */
  minutes?: number;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  // The uploaded file this item was suggested from, if any.
  fileId?: string;
  // A suggested change to this existing item (from refreshing a link).
  replacesId?: string;
  // Prices that depend on who does it (or another option like length).
  options?: PriceOption[];
  // Team members this item applies to; empty means everyone.
  staffIds?: string[];
  updatedAt: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  about: string;
  active: boolean;
};

export type PriceOption = {
  staffId?: string;
  label?: string;
  price: string;
  duration?: string;
};

export const MAX_KNOWLEDGE_ITEMS = 300;
export const MAX_TEAM = 50;

export type KnowledgeStore = {
  formatVersion: 1;
  profile: Pick<BusinessProfile, "name" | "description" | "bookingUrl">;
  sources: KnowledgeSource[];
  team?: TeamMember[];
};

const teamMemberSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: z.string().trim().min(1).max(60),
    role: z.string().trim().max(80),
    about: z.string().trim().max(400),
    active: z.boolean(),
  })
  .strict();

const priceOptionSchema = z
  .object({
    staffId: z.string().min(1).max(60).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    price: z.string().trim().min(1).max(40),
    duration: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine((o) => o.staffId || o.label, "Each option needs a team member or a name.");

const sourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(knowledgeKinds),
    language: z.enum(knowledgeLanguages),
    status: z.enum(knowledgeStatuses),
    origin: z.enum(knowledgeOrigins),
    title: z.string().trim().min(1).max(180),
    content: z.string().trim().min(1).max(12_000),
    price: z.string().max(100).optional(),
    minutes: z.number().int().min(5).max(480).optional(),
    fileName: z.string().max(240).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().min(0).max(10_485_760).optional(),
    fileId: z.string().uuid().optional(),
    replacesId: z.string().min(1).max(100).optional(),
    options: z.array(priceOptionSchema).max(12).optional(),
    staffIds: z.array(z.string().min(1).max(60)).max(20).optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const storeSchema = z
  .object({
    formatVersion: z.literal(1),
    profile: z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(400),
        bookingUrl: bookingLinkSchema,
      })
      .strict(),
    sources: z.array(sourceSchema).max(300),
    team: z.array(teamMemberSchema).max(50).optional(),
  })
  .strict();

export function activeTeam(store: KnowledgeStore) {
  return (store.team ?? []).filter((m) => m.active);
}

export function optionLabel(option: PriceOption, team: TeamMember[]) {
  const member = option.staffId ? team.find((m) => m.id === option.staffId) : undefined;
  if (member) return member.role ? `${member.name} (${member.role})` : member.name;
  return option.label ?? "Option";
}

// Options that still point at someone on the team (or a named option).
export function visibleOptions(source: KnowledgeSource, team: TeamMember[]) {
  return (source.options ?? []).filter((o) => !o.staffId || team.some((m) => m.id === o.staffId && m.active));
}

// "$40–$60" from option prices; falls back to listing them.
export function priceSummary(options: PriceOption[]): string {
  const prices = options.map((o) => o.price.trim()).filter(Boolean);
  if (prices.length === 0) return "";
  const parsed = prices.map((p) => p.match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)\s*([^\d]*)$/));
  if (parsed.every(Boolean)) {
    const prefix = parsed[0]![1].trim();
    const suffix = parsed[0]![3].trim();
    if (parsed.every((m) => m![1].trim() === prefix && m![3].trim() === suffix)) {
      const values = parsed.map((m) => Number(m![2].replace(/,/g, "")));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const fmt = (n: number) => `${prefix}${Number.isInteger(n) ? n : n.toFixed(2)}${suffix ? ` ${suffix}` : ""}`;
      return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
    }
  }
  return [...new Set(prices)].join(" / ").slice(0, 80);
}

// One line of text per item for search and the AI: title, price, details,
// price options and who it applies to.
export function describeSource(source: KnowledgeSource, team: TeamMember[]) {
  const options = visibleOptions(source, team);
  const staff = (source.staffIds ?? [])
    .map((id) => team.find((m) => m.id === id && m.active)?.name)
    .filter(Boolean);
  return [
    `${source.title}${source.price ? ` (${source.price})` : ""}: ${source.content}`,
    options.length
      ? `Prices: ${options.map((o) => `${optionLabel(o, team)} ${o.price}${o.duration ? `, ${o.duration}` : ""}`).join("; ")}.`
      : "",
    staff.length ? `Applies to: ${staff.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseKnowledgeStore(input: unknown) {
  return storeSchema.safeParse(input);
}

export function createKnowledgeStoreFromBusiness(
  business: BusinessProfile,
  now = new Date().toISOString(),
): KnowledgeStore {
  return {
    formatVersion: 1,
    profile: {
      name: business.name,
      description: business.description,
      bookingUrl: business.bookingUrl,
    },
    sources: [
      {
        id: "source-hours-en",
        kind: "hours",
        language: "en",
        status: "approved",
        origin: "manual",
        title: "Opening hours",
        content: business.hours,
        updatedAt: now,
      },
      ...business.services.map((service, index) => ({
        id: `source-service-${index + 1}`,
        kind: "service" as const,
        language: "en" as const,
        status: "approved" as const,
        origin: "manual" as const,
        title: service.name,
        content: `${service.name} is available for ${service.price}.`,
        price: service.price,
        updatedAt: now,
      })),
      ...business.faqs.map((faq, index) => ({
        id: `source-faq-${index + 1}`,
        kind: "faq" as const,
        language: "en" as const,
        status: "approved" as const,
        origin: "manual" as const,
        title: faq.question,
        content: faq.answer,
        updatedAt: now,
      })),
      {
        id: "source-policy-cancellation",
        kind: "policy",
        language: "en",
        status: "draft",
        origin: "manual",
        title: "Cancellation policy",
        content: "Add the business cancellation policy before approving it.",
        updatedAt: now,
      },
    ],
  };
}

export function businessFromKnowledge(store: KnowledgeStore): BusinessProfile {
  const approved = store.sources.filter(
    (source) => source.status === "approved",
  );
  // The practice profile has tighter limits than the knowledge store.
  const services = approved
    .filter((source) => source.kind === "service" && source.price)
    .slice(0, 8)
    .map((source) => ({
      name: source.title.slice(0, 80),
      price: source.price!.slice(0, 80),
      ...(source.minutes ? { minutes: source.minutes } : {}),
    }));
  const faqs = approved
    .filter((source) => source.kind === "faq")
    .slice(-8)
    .map((source) => ({
      question: source.title.slice(0, 160),
      answer: source.content.slice(0, 500),
    }));
  const hours =
    approved.find(
      (source) => source.kind === "hours" && source.language === "en",
    ) ?? approved.find((source) => source.kind === "hours");
  return {
    ...store.profile,
    hours: (hours?.content ?? "No approved opening hours are available.").slice(0, 200),
    services,
    faqs,
  };
}

export type KnowledgeMatch = {
  source: KnowledgeSource;
  score: number;
  reason: string;
};

export function searchApprovedKnowledge(
  store: KnowledgeStore,
  query: string,
  language?: KnowledgeLanguage,
): KnowledgeMatch[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const queryTokens = new Set(normalizedQuery.split(" "));

  return store.sources
    .filter(
      (source) =>
        source.status === "approved" &&
        (!language || source.language === language),
    )
    .flatMap((source) => {
      const title = normalize(source.title);
      const text = normalize(describeSource(source, store.team ?? []));
      const textTokens = new Set(text.split(" "));
      const overlap = [...queryTokens].filter((token) =>
        textTokens.has(token),
      ).length;
      const exactFaq = source.kind === "faq" && title === normalizedQuery;
      const titleMatch =
        title === normalizedQuery || normalizedQuery.includes(title);
      const score = exactFaq
        ? 1
        : titleMatch
          ? 0.9
          : overlap / queryTokens.size;
      if (score <= 0) return [];
      return [
        {
          source,
          score,
          reason: exactFaq
            ? "Exact approved FAQ"
            : titleMatch
              ? "Approved title match"
              : "Approved keyword match",
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.source.title.localeCompare(b.source.title),
    )
    .slice(0, 5);
}

export function countLanguageCoverage(store: KnowledgeStore) {
  return Object.fromEntries(
    knowledgeLanguages.map((language) => [
      language,
      store.sources.filter(
        (source) =>
          source.language === language && source.status === "approved",
      ).length,
    ]),
  ) as Record<KnowledgeLanguage, number>;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
