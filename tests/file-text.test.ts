import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  chunkText,
  docxText,
  extractFileText,
  mimeForFile,
  toSearchQuery,
  UnreadableFileError,
  xlsxText,
} from "../lib/server/file-text";

function docx(paragraphs: string[]) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`),
  });
}

// A minimal one-page PDF with the given line of text.
function pdf(line: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("reading uploaded files", () => {
  it("picks the type from the file extension", () => {
    expect(mimeForFile("Price List.PDF")).toBe("application/pdf");
    expect(mimeForFile("menu.csv")).toBe("text/csv");
    expect(mimeForFile("photo.jpg")).toBeNull();
    expect(mimeForFile("noext")).toBeNull();
  });

  it("reads Word paragraphs and decodes entities", () => {
    const text = docxText(docx(["Haircut &amp; style: $60", "Open Mon–Sat"]));
    expect(text).toBe("Haircut & style: $60\nOpen Mon–Sat");
  });

  it("reads every Excel sheet as rows", () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Prices" sheetId="1"/></sheets></workbook>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Service</t></si><si><t>Price</t></si><si><t>Colour</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>95</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(xlsxText(bytes)).toBe("## Prices\nService | Price\nColour | 95");
  });

  it("reads text from a PDF page by page", async () => {
    const result = await extractFileText(pdf("Balayage with a senior stylist costs 180 dollars."), "application/pdf");
    expect(result.pages).toBe(1);
    expect(result.text).toContain("Balayage with a senior stylist costs 180 dollars.");
  });

  it("explains when a file has no text", async () => {
    await expect(extractFileText(new TextEncoder().encode("  "), "text/plain")).rejects.toBeInstanceOf(
      UnreadableFileError,
    );
    await expect(extractFileText(new Uint8Array([1, 2, 3]), "application/pdf")).rejects.toBeInstanceOf(
      UnreadableFileError,
    );
    expect(() => docxText(new Uint8Array([80, 75, 1, 2]))).toThrow(UnreadableFileError);
  });

  it("splits long text into overlapping searchable pieces", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Fact number ${i} is written here.`).join("\n");
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.join("\n")).toContain("Fact number 39");
  });

  it("builds a safe OR search from a question", () => {
    expect(toSearchQuery("How much is a balayage with Ayşe?")).toBe("much | balayage | ayşe");
    expect(toSearchQuery("is it?")).toBeNull();
    expect(toSearchQuery("price'); drop table x; --")).toBe("price | drop | table");
  });
});
