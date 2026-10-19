"use server";

import { z } from "zod";

import { getWorkspaceContext, type WorkspaceContext } from "@/lib/data/workspace";
import { fetchPublicPage, htmlToText, PageFetchError } from "@/lib/server/fetch-page";
import {
  chunkText,
  extractFileText,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  mimeForFile,
  UnreadableFileError,
} from "@/lib/server/file-text";
import { suggestKnowledgeItems, type Suggestion } from "@/lib/server/knowledge-suggest";
import { readLiveConfig } from "@/lib/server/live-config";
import { rateLimit } from "@/lib/server/rate-limit";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type KnowledgeFile = {
  id: string;
  kind: "file" | "url";
  title: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: "uploading" | "reading" | "review" | "ready" | "error";
  error: string | null;
  pageCount: number | null;
  useForAnswers: boolean;
  suggestedCount: number;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type Failure = { ok: false; error: string };
const BUCKET = "knowledge";
const columns =
  "id, kind, title, file_name, mime_type, size_bytes, status, error, page_count, use_for_answers, suggested_count, source_url, created_at, updated_at";

function toFile(row: Record<string, unknown>): KnowledgeFile {
  return {
    id: row.id as string,
    kind: row.kind as KnowledgeFile["kind"],
    title: row.title as string,
    fileName: (row.file_name as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    status: row.status as KnowledgeFile["status"],
    error: (row.error as string | null) ?? null,
    pageCount: (row.page_count as number | null) ?? null,
    useForAnswers: Boolean(row.use_for_answers),
    suggestedCount: Number(row.suggested_count ?? 0),
    sourceUrl: (row.source_url as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function session(write: boolean) {
  if (!isSupabaseConfigured()) return { error: "Accounts aren’t set up on this server." } as const;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  if (!workspace) return { error: "Sign in to add files." } as const;
  if (write && workspace.role === "viewer") return { error: "Viewers can’t change knowledge." } as const;
  return { db, workspace } as const;
}

const idSchema = z.string().uuid();

export async function listKnowledgeFiles(): Promise<{ ok: true; files: KnowledgeFile[] } | Failure> {
  const s = await session(false);
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.db
    .from("hc_knowledge_files")
    .select(columns)
    .eq("tenant_id", s.workspace.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: "Couldn’t load your files." };
  return { ok: true, files: (data ?? []).map(toFile) };
}

// Step 1: register the file and hand back a one-time upload slot. The browser
// uploads straight to private storage, so large files never pass through here.
export async function startKnowledgeUpload(input: {
  fileName: string;
  sizeBytes: number;
}): Promise<{ ok: true; fileId: string; path: string; token: string; mimeType: string } | Failure> {
  const parsed = z
    .object({ fileName: z.string().trim().min(1).max(240), sizeBytes: z.number().int().min(1).max(MAX_FILE_BYTES) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Files can be up to 10 MB." };
  const mime = mimeForFile(parsed.data.fileName);
  if (!mime) return { ok: false, error: "Use a PDF, Word (.docx), Excel (.xlsx), CSV or text file." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "File storage isn’t configured on this server." };

  const fileId = crypto.randomUUID();
  const safeName = parsed.data.fileName.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(-120);
  const path = `${s.workspace.tenantId}/${fileId}/${safeName}`;
  const { error } = await s.db.from("hc_knowledge_files").insert({
    tenant_id: s.workspace.tenantId,
    id: fileId,
    kind: "file",
    title: parsed.data.fileName.replace(/\.[^.]+$/, "").slice(0, 180) || "Document",
    file_name: parsed.data.fileName,
    mime_type: mime,
    size_bytes: parsed.data.sizeBytes,
    storage_path: path,
    status: "uploading",
    created_by: s.workspace.userId,
  });
  if (error) return { ok: false, error: "Couldn’t start the upload." };
  const upload = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (upload.error || !upload.data) return { ok: false, error: "Couldn’t start the upload." };
  return { ok: true, fileId, path, token: upload.data.token, mimeType: mime };
}

async function loadRow(db: Awaited<ReturnType<typeof createClient>>, workspace: WorkspaceContext, id: string) {
  const { data } = await db
    .from("hc_knowledge_files")
    .select(`${columns}, storage_path, text_content`)
    .eq("tenant_id", workspace.tenantId)
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function replaceChunks(
  db: Awaited<ReturnType<typeof createClient>>,
  workspace: WorkspaceContext,
  fileId: string,
  text: string,
) {
  await db.from("hc_knowledge_file_chunks").delete().eq("tenant_id", workspace.tenantId).eq("file_id", fileId);
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i += 100) {
    const { error } = await db.from("hc_knowledge_file_chunks").insert(
      chunks.slice(i, i + 100).map((content, offset) => ({
        tenant_id: workspace.tenantId,
        file_id: fileId,
        ordinal: i + offset,
        content,
      })),
    );
    if (error) throw new Error("Couldn’t index the text.");
  }
  return chunks.length;
}

// Step 2: read the uploaded file, index its text, and ask the AI for
// suggested knowledge items. Nothing is live until the owner approves.
export async function processKnowledgeFile(fileId: string): Promise<
  | { ok: true; file: KnowledgeFile; suggestions: Suggestion[]; note: string | null }
  | Failure
> {
  if (!idSchema.safeParse(fileId).success) return { ok: false, error: "Unknown file." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "File storage isn’t configured on this server." };
  const row = await loadRow(s.db, s.workspace, fileId);
  if (!row) return { ok: false, error: "That file no longer exists." };

  const fail = async (message: string) => {
    await s.db.from("hc_knowledge_files").update({ status: "error", error: message.slice(0, 300) })
      .eq("tenant_id", s.workspace.tenantId).eq("id", fileId);
    return { ok: false as const, error: message };
  };

  await s.db.from("hc_knowledge_files").update({ status: "reading", error: null })
    .eq("tenant_id", s.workspace.tenantId).eq("id", fileId);
  const download = await admin.storage.from(BUCKET).download(row.storage_path as string);
  if (download.error || !download.data) return fail("The upload didn’t finish. Try adding the file again.");
  if (download.data.size > MAX_FILE_BYTES) return fail("Files can be up to 10 MB.");
  const mime = mimeForFile(row.file_name as string);
  if (!mime) return fail("This file type isn’t supported.");

  let text: string;
  let pages: number | null;
  try {
    ({ text, pages } = await extractFileText(new Uint8Array(await download.data.arrayBuffer()), mime));
  } catch (error) {
    return fail(error instanceof UnreadableFileError ? error.message : "This file couldn’t be read.");
  }

  try {
    await replaceChunks(s.db, s.workspace, fileId, text);
  } catch {
    return fail("Couldn’t index the text. Try again.");
  }

  const { suggestions, note } = await suggestFor(admin, s.workspace.tenantId, row.title as string, text);

  const { data, error } = await s.db
    .from("hc_knowledge_files")
    .update({ status: "review", text_content: text, page_count: pages, suggested_count: suggestions.length, error: null })
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", fileId)
    .select(columns)
    .single();
  if (error || !data) return { ok: false, error: "Couldn’t save the file’s text." };
  return { ok: true, file: toFile(data), suggestions, note };
}

export async function getKnowledgeFile(
  fileId: string,
): Promise<{ ok: true; file: KnowledgeFile; text: string; downloadUrl: string | null } | Failure> {
  if (!idSchema.safeParse(fileId).success) return { ok: false, error: "Unknown file." };
  const s = await session(false);
  if ("error" in s) return { ok: false, error: s.error! };
  const row = await loadRow(s.db, s.workspace, fileId);
  if (!row) return { ok: false, error: "That file no longer exists." };
  const admin = widgetAdminClient();
  const signed = admin && row.storage_path
    ? await admin.storage.from(BUCKET).createSignedUrl(row.storage_path as string, 300, { download: (row.file_name as string) ?? true })
    : null;
  return {
    ok: true,
    file: toFile(row),
    text: (row.text_content as string) ?? "",
    downloadUrl: signed?.data?.signedUrl ?? null,
  };
}

const updateSchema = z
  .object({
    fileId: idSchema,
    title: z.string().trim().min(1).max(180).optional(),
    text: z.string().max(400_000).optional(),
    useForAnswers: z.boolean().optional(),
    done: z.boolean().optional(),
  })
  .strict();

export async function updateKnowledgeFile(input: z.input<typeof updateSchema>): Promise<
  { ok: true; file: KnowledgeFile } | Failure
> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change couldn’t be saved." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const { fileId, title, text, useForAnswers, done } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (useForAnswers !== undefined) patch.use_for_answers = useForAnswers;
  if (done) patch.status = "ready";
  if (text !== undefined) {
    if (text.trim().length < 20) return { ok: false, error: "The text is too short to be useful." };
    patch.text_content = text.trim();
    try {
      await replaceChunks(s.db, s.workspace, fileId, text.trim());
    } catch {
      return { ok: false, error: "Couldn’t save the text." };
    }
  }
  const { data, error } = await s.db
    .from("hc_knowledge_files")
    .update(patch)
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", fileId)
    .select(columns)
    .single();
  if (error || !data) return { ok: false, error: "That change couldn’t be saved." };
  return { ok: true, file: toFile(data) };
}

export async function deleteKnowledgeFile(fileId: string): Promise<{ ok: true } | Failure> {
  if (!idSchema.safeParse(fileId).success) return { ok: false, error: "Unknown file." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const row = await loadRow(s.db, s.workspace, fileId);
  if (!row) return { ok: true };
  const admin = widgetAdminClient();
  if (admin && row.storage_path) await admin.storage.from(BUCKET).remove([row.storage_path as string]);
  const { error } = await s.db.from("hc_knowledge_files").delete().eq("tenant_id", s.workspace.tenantId).eq("id", fileId);
  if (error) return { ok: false, error: "Couldn’t delete the file." };
  return { ok: true };
}

async function suggestFor(
  admin: NonNullable<ReturnType<typeof widgetAdminClient>>,
  tenantId: string,
  title: string,
  text: string,
): Promise<{ suggestions: Suggestion[]; note: string | null }> {
  const live = readLiveConfig();
  if (!live.ready)
    return {
      suggestions: [],
      note: "AI suggestions need the OpenAI key on the server. You can still let your crew search this text, or add items yourself.",
    };
  const result = await suggestKnowledgeItems(admin, live.config, tenantId, { title, text });
  if (result === null)
    return {
      suggestions: [],
      note: "This month’s AI budget is used up, so no items were suggested. Your crew can still search the text once you allow it.",
    };
  if (result.length === 0)
    return {
      suggestions: [],
      note: "No clear services, prices or answers were found. You can let your crew search the full text instead.",
    };
  return { suggestions: result, note: null };
}

// Reads a public web page as knowledge. PDFs linked directly work too.
async function readPage(url: string) {
  const page = await fetchPublicPage(url);
  if (page.contentType.includes("application/pdf")) {
    const { text, pages } = await extractFileText(new Uint8Array(page.body), "application/pdf");
    return { url: page.url, title: new URL(page.url).pathname.split("/").pop() || new URL(page.url).hostname, text, pages };
  }
  if (!/text\/html|application\/xhtml|text\/plain/.test(page.contentType))
    throw new PageFetchError("That link isn’t a web page or PDF.");
  const raw = page.body.toString("utf8");
  const { title, text } = page.contentType.includes("text/plain") ? { title: "", text: raw } : htmlToText(raw);
  if (text.replace(/\s+/g, "").length < 40)
    throw new PageFetchError("Almost no text was found. The page may need JavaScript to show its content.");
  return { url: page.url, title: title || new URL(page.url).hostname, text: text.slice(0, MAX_TEXT_CHARS), pages: null };
}

export async function addKnowledgeLink(input: { url: string }): Promise<
  | { ok: true; file: KnowledgeFile; suggestions: Suggestion[]; note: string | null }
  | Failure
> {
  const parsed = z.object({ url: z.string().trim().min(4).max(2000) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a web address." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "This server isn’t fully configured." };
  const limited = rateLimit(`knowledge-link:${s.workspace.tenantId}`, 10, 60_000);
  if (!limited.ok) return { ok: false, error: "Too many links at once. Wait a minute." };

  let page;
  try {
    page = await readPage(parsed.data.url);
  } catch (error) {
    return { ok: false, error: error instanceof PageFetchError || error instanceof UnreadableFileError ? error.message : "That page couldn’t be read." };
  }
  const fileId = crypto.randomUUID();
  const { error } = await s.db.from("hc_knowledge_files").insert({
    tenant_id: s.workspace.tenantId,
    id: fileId,
    kind: "url",
    title: page.title.slice(0, 180),
    source_url: page.url.slice(0, 2000),
    status: "reading",
    text_content: page.text,
    page_count: page.pages,
    created_by: s.workspace.userId,
  });
  if (error) return { ok: false, error: "Couldn’t save the page." };
  try {
    await replaceChunks(s.db, s.workspace, fileId, page.text);
  } catch {
    return { ok: false, error: "Couldn’t index the page." };
  }
  const { suggestions, note } = await suggestFor(admin, s.workspace.tenantId, page.title, page.text);
  const { data } = await s.db
    .from("hc_knowledge_files")
    .update({ status: "review", suggested_count: suggestions.length })
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", fileId)
    .select(columns)
    .single();
  if (!data) return { ok: false, error: "Couldn’t save the page." };
  return { ok: true, file: toFile(data), suggestions, note };
}

// Re-reads a saved link. Returns fresh suggestions only when the page changed.
export async function refreshKnowledgeLink(fileId: string): Promise<
  | { ok: true; file: KnowledgeFile; changed: boolean; suggestions: Suggestion[]; note: string | null }
  | Failure
> {
  if (!idSchema.safeParse(fileId).success) return { ok: false, error: "Unknown link." };
  const s = await session(true);
  if ("error" in s) return { ok: false, error: s.error! };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "This server isn’t fully configured." };
  const row = await loadRow(s.db, s.workspace, fileId);
  if (!row || row.kind !== "url" || !row.source_url) return { ok: false, error: "That link no longer exists." };
  const limited = rateLimit(`knowledge-link:${s.workspace.tenantId}`, 10, 60_000);
  if (!limited.ok) return { ok: false, error: "Too many refreshes at once. Wait a minute." };

  let page;
  try {
    page = await readPage(row.source_url as string);
  } catch (error) {
    return { ok: false, error: error instanceof PageFetchError || error instanceof UnreadableFileError ? error.message : "That page couldn’t be read." };
  }
  const changed = page.text.trim() !== String(row.text_content ?? "").trim();
  if (!changed) {
    // Touch the row so "last checked" moves on.
    const { data } = await s.db
      .from("hc_knowledge_files")
      .update({ error: null })
      .eq("tenant_id", s.workspace.tenantId)
      .eq("id", fileId)
      .select(columns)
      .single();
    return { ok: true, file: toFile(data ?? row), changed: false, suggestions: [], note: null };
  }
  try {
    await replaceChunks(s.db, s.workspace, fileId, page.text);
  } catch {
    return { ok: false, error: "Couldn’t index the page." };
  }
  const { suggestions, note } = await suggestFor(admin, s.workspace.tenantId, row.title as string, page.text);
  const { data } = await s.db
    .from("hc_knowledge_files")
    .update({ status: "review", text_content: page.text, page_count: page.pages, suggested_count: suggestions.length, error: null })
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", fileId)
    .select(columns)
    .single();
  if (!data) return { ok: false, error: "Couldn’t save the page." };
  return { ok: true, file: toFile(data), changed: true, suggestions, note };
}
