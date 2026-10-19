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
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  // The uploaded file this item was suggested from, if any.
  fileId?: string;
  updatedAt: string;
};

export const MAX_KNOWLEDGE_ITEMS = 300;

export type KnowledgeStore = {
  formatVersion: 1;
  profile: Pick<BusinessProfile, "name" | "description" | "bookingUrl">;
  sources: KnowledgeSource[];
};

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
    fileName: z.string().max(240).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().min(0).max(10_485_760).optional(),
    fileId: z.string().uuid().optional(),
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
  })
  .strict();

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
      const text = normalize(
        `${source.title} ${source.content} ${source.price ?? ""}`,
      );
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
