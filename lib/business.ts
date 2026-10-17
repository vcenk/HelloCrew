import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
const matchableText = (max: number) =>
  text(max).refine(
    (value) => normalizeQuestion(value).length > 0,
    "Include at least one letter or number.",
  );
export const bookingLinkSchema = z
  .string()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use a full http or https link without credentials, or leave it empty.");
export const businessSchema = z
  .object({
    name: matchableText(80),
    description: text(400),
    hours: text(200),
    bookingUrl: bookingLinkSchema,
    services: z
      .array(z.object({ name: matchableText(80), price: text(80) }).strict())
      .min(1)
      .max(8),
    faqs: z
      .array(
        z.object({ question: matchableText(160), answer: text(500) }).strict(),
      )
      .max(8),
  })
  .strict();
export type BusinessProfile = z.infer<typeof businessSchema>;
export const sampleBusiness: BusinessProfile = {
  name: "Fictional creative studio",
  description: "A fictional neighborhood studio for creative projects.",
  hours: "Monday–Friday, 9am–5pm",
  bookingUrl: "https://example.com/book",
  services: [{ name: "Studio visit", price: "$40 USD" }],
  faqs: [
    {
      question: "Is parking available?",
      answer: "Our sample studio has two visitor parking spaces.",
    },
  ],
};
export const messageSchema = text(500);
export function normalizeQuestion(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Literal retrieval only: configuration is data, never instructions or tool code.
// Matching is intentionally conservative. Unknown questions never invent facts.
export function answerFromBusiness(
  profile: BusinessProfile,
  message: string,
): { reply: string; source: string } {
  const q = normalizeQuestion(message);
  const faq = profile.faqs.find(
    (item) => normalizeQuestion(item.question) === q,
  );
  if (faq)
    return {
      reply: `Saved FAQ answer (sample): ${faq.answer}`,
      source: "Saved FAQ",
    };
  if (/\b(price|prices|cost|much|services|service|quote)\b/.test(q)) {
    const named = profile.services.filter((s) => matchesService(q, s.name));
    if (named.length)
      return {
        reply: `Sample catalog entries: ${named.map((s) => `${s.name}: ${s.price}`).join("; ")}. These are listed sample prices, not a calculated total or a real offer.`,
        source: "Service catalog",
      };
    if (
      /^(what (are |services )?(your )?services|list( your)? services|services|prices|price list)$/.test(
        q,
      )
    )
      return {
        reply: `Sample catalog: ${profile.services.map((s) => `${s.name}: ${s.price}`).join("; ")}. These are fictional examples, not real offers.`,
        source: "Service catalog",
      };
    return unknownAnswer();
  }
  const businessName = normalizeQuestion(profile.name);
  if (
    q === "about" ||
    (businessName &&
      [
        `about ${businessName}`,
        `tell me about ${businessName}`,
        `what is ${businessName}`,
        `what does ${businessName} do`,
      ].includes(q))
  )
    return {
      reply: `Saved sample business description: ${profile.description}`,
      source: "Business description",
    };
  if (/\b(book|booking|appointment|reserve|reservation)\b/.test(q))
    return {
      reply: profile.bookingUrl
        ? `Sample booking link: ${profile.bookingUrl}\nThis only shows your configured link. I have not checked availability, opened the link, or made a booking.`
        : "No booking link is configured in this sample. I cannot check availability or make a booking.",
      source: "Booking link",
    };
  if (/\b(person|human|staff|agent)\b/.test(q))
    return {
      reply:
        "A person would need to help with that. This practice mode cannot send a handoff or contact anyone.",
      source: "Practice handoff policy",
    };
  if (/\b(hours|open|opening|close|closing)\b/.test(q))
    return {
      reply: `Saved sample hours: ${profile.hours}`,
      source: "Business hours",
    };
  const similar = closestFaq(profile, q);
  if (similar)
    return {
      reply: `Saved FAQ answer (sample): ${similar.answer}`,
      source: "Saved FAQ",
    };
  return unknownAnswer();
}

const stopWords = new Set(
  "a an the is are am do does did you your yours we our ours i me my can could would will should to of for in on at it this that there here be have has any some with and or please tell know what when where how".split(
    " ",
  ),
);

function contentWords(normalized: string) {
  return normalized
    .split(" ")
    .map((word) =>
      word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word,
    )
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

// Tolerant FAQ match: most of the saved question's content words must appear in
// the visitor's message. Deterministic and explainable; replaced by retrieval later.
function closestFaq(profile: BusinessProfile, normalizedQuestion: string) {
  const asked = new Set(contentWords(normalizedQuestion));
  if (asked.size === 0) return undefined;
  let best: { answer: string; score: number } | undefined;
  for (const faq of profile.faqs) {
    const words = [...new Set(contentWords(normalizeQuestion(faq.question)))];
    if (words.length === 0) continue;
    const hits = words.filter((word) => asked.has(word));
    const score = hits.length / words.length;
    if (
      hits.some((word) => word.length >= 4) &&
      score >= 0.5 &&
      (!best || score > best.score)
    )
      best = { answer: faq.answer, score };
  }
  return best;
}

function unknownAnswer() {
  return {
    reply:
      "I don’t have a matching answer in the saved sample information. Try your exact FAQ question, ask for opening hours, or name a configured service. A person would need to confirm anything else; nobody has been contacted.",
    source: "No matching information",
  };
}

function matchesService(question: string, name: string): boolean {
  const phrase = normalizeQuestion(name);
  if (!phrase) return false;
  // Whole words only, with a deliberately small plural rule for the final word.
  const queryWords = question.split(" ");
  const nameWords = phrase.split(" ");
  return queryWords.some((_, start) =>
    nameWords.every((word, index) => {
      const actual = queryWords[start + index];
      return (
        actual === word ||
        (index === nameWords.length - 1 &&
          (actual === `${word}s` || actual === `${word}es`))
      );
    }),
  );
}
