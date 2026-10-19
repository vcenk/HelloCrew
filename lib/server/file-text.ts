import "server-only";

import { strFromU8, unzipSync } from "fflate";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;

export const acceptedFileTypes = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "text/plain": "Text",
  "text/csv": "CSV",
  "text/markdown": "Text",
} as const;
export type AcceptedMime = keyof typeof acceptedFileTypes;

const byExtension: Record<string, AcceptedMime> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};

// Browsers report types inconsistently (CSV is often blank or Excel's type),
// so the file extension decides.
export function mimeForFile(fileName: string): AcceptedMime | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return byExtension[ext] ?? null;
}

export class UnreadableFileError extends Error {}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function unzip(bytes: Uint8Array) {
  try {
    // Refuse zip bombs: no single part may unpack beyond 40 MB.
    return unzipSync(bytes, {
      filter: (file) => file.originalSize <= 40 * 1024 * 1024,
    });
  } catch {
    throw new UnreadableFileError("This file looks damaged or isn’t a real Office file.");
  }
}

// Word: paragraphs from word/document.xml; table cells separated by " | ".
export function docxText(bytes: Uint8Array) {
  const files = unzip(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new UnreadableFileError("This Word file has no readable text.");
  const xml = strFromU8(doc);
  return xml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      decodeXml(
        paragraph
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<w:br\/>/g, "\n")
          .replace(/<\/w:tc>/g, " | ")
          .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|\t|\n| \| /g)
          ?.map((part) => part.replace(/<[^>]+>/g, ""))
          .join("") ?? "",
      ).trim(),
    )
    .filter(Boolean)
    .join("\n");
}

// Excel: every sheet as rows of "cell | cell | cell".
export function xlsxText(bytes: Uint8Array) {
  const files = unzip(bytes);
  const shared: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"];
  if (sharedXml)
    for (const si of strFromU8(sharedXml).split("</si>"))
      shared.push(decodeXml((si.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const sheetNames = [...strFromU8(files["xl/workbook.xml"] ?? new Uint8Array()).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(
    (m) => decodeXml(m[1]),
  );
  const sheets = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  sheets.forEach((name, index) => {
    const rows = strFromU8(files[name]).split("</row>");
    const lines = rows
      .map((row) =>
        [...row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map(([, attrs, inner = ""]) => {
            const value = inner.match(/<v>([^<]*)<\/v>/)?.[1];
            if (/t="s"/.test(attrs) && value !== undefined) return shared[Number(value)] ?? "";
            if (/t="inlineStr"/.test(attrs)) return decodeXml(inner.replace(/<[^>]+>/g, ""));
            return value !== undefined ? decodeXml(value) : "";
          })
          .filter((cell) => cell.trim() !== "")
          .join(" | "),
      )
      .filter(Boolean);
    if (lines.length) out.push(`## ${sheetNames[index] ?? `Sheet ${index + 1}`}`, ...lines, "");
  });
  return out.join("\n").trim();
}

export async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((page, i) => `--- Page ${i + 1} ---\n${page.trim()}`);
    return { text: pages.join("\n\n"), pages: totalPages };
  } catch {
    throw new UnreadableFileError("This PDF couldn’t be opened. It may be password-protected or damaged.");
  }
}

export async function extractFileText(bytes: Uint8Array, mime: AcceptedMime) {
  let text: string;
  let pages: number | null = null;
  if (mime === "application/pdf") ({ text, pages } = await pdfText(bytes));
  else if (mime.includes("wordprocessingml")) text = docxText(bytes);
  else if (mime.includes("spreadsheetml")) text = xlsxText(bytes);
  else text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = clean.replace(/--- Page \d+ ---/g, "").replace(/\s+/g, "");
  if (words.length < 20)
    throw new UnreadableFileError(
      mime === "application/pdf"
        ? "No text found. This PDF may be a scan or photo; scanned files aren’t supported yet."
        : "No text found in this file.",
    );
  return { text: clean.slice(0, MAX_TEXT_CHARS), pages, truncated: clean.length > MAX_TEXT_CHARS };
}

// Splits text into ~1,200-character pieces on paragraph or sentence breaks,
// overlapping slightly so a fact cut at a boundary is still findable.
export function chunkText(text: string, size = 1200, overlap = 150) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece.slice(0, 2400));
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const stopwords = new Set(
  "the a an and or but is are was were be to of in on at for with from by do does did you your we our us i my me it its this that these those what which who how when where can could would should will have has had any some there here please about".split(
    " ",
  ),
);

// Builds an OR full-text query from a customer's question. Only letters and
// digits reach Postgres, so the query can't be malformed or injected.
export function toSearchQuery(question: string) {
  const words = question
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !stopwords.has(w));
  const unique = [...new Set(words)].slice(0, 12);
  return unique.length ? unique.join(" | ") : null;
}
