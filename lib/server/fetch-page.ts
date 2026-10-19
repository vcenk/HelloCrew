import "server-only";

import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";

export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export class PageFetchError extends Error {}

// True for addresses a public web page must never resolve to: loopback,
// private networks, link-local (cloud metadata), CGNAT, multicast, etc.
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" || lower === "::1" ||
      lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") ||
      lower.startsWith("ff") || lower.startsWith("64:ff9b") || lower.startsWith("2001:db8")
    );
  }
  return true;
}

export function checkPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new PageFetchError("That doesn’t look like a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PageFetchError("Use an http or https address.");
  if (url.username || url.password) throw new PageFetchError("Addresses with a username or password aren’t allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new PageFetchError("Only normal web ports are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? isPrivateAddress(host) : !host.includes(".") || /\.(local|internal|localhost)$/i.test(host) || host === "localhost")
    throw new PageFetchError("That address isn’t a public website.");
  url.hash = "";
  return url;
}

// The address is checked at connect time, so a hostname can't pass the check
// and then resolve somewhere private (DNS rebinding).
const safeLookup: typeof lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const opts = (typeof options === "object" && options ? options : {}) as { all?: boolean };
  lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address)))
      return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "");
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as typeof lookup;

type Fetched = { url: string; contentType: string; body: Buffer };

function requestOnce(url: URL): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "HelloCrewBot/1.0 (+knowledge import; owner-requested)",
          accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, contentType: "", body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_PAGE_BYTES) {
          res.destroy();
          return reject(new PageFetchError("That page is too large to import."));
        }
        const encoding = String(res.headers["content-encoding"] ?? "");
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_PAGE_BYTES) {
            req.destroy();
            reject(new PageFetchError("That page is too large to import."));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({ status, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }),
        );
        stream.on("error", () => reject(new PageFetchError("The page couldn’t be read.")));
      },
    );
    req.on("timeout", () => req.destroy(new PageFetchError("The website took too long to answer.")));
    req.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        error instanceof PageFetchError
          ? error
          : new PageFetchError(
              error.code === "EBLOCKED" ? "That address isn’t a public website."
              : error.code === "ENOTFOUND" ? "That website couldn’t be found."
              : "The website couldn’t be reached.",
            ),
      ),
    );
    req.end();
  });
}

export async function fetchPublicPage(input: string): Promise<Fetched> {
  let url = checkPublicUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url);
    if (res.location) {
      url = checkPublicUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new PageFetchError("That page needs a login or blocks automated reading.");
    if (res.status === 404) throw new PageFetchError("That page wasn’t found (404).");
    if (res.status >= 400) throw new PageFetchError(`The website answered with an error (${res.status}).`);
    return { url: url.toString(), contentType: res.contentType.toLowerCase(), body: res.body };
  }
  throw new PageFetchError("Too many redirects.");
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", euro: "€", pound: "£", copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

// Keeps the readable text of a page: drops scripts, styles, menus and
// footers, prefers <main>/<article>, and keeps list and table structure.
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form|button|select)\b[\s\S]*?<\/\1>/gi, " ");
  const main = body.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0];
  if (main && main.replace(/<[^>]+>/g, "").trim().length > 200) body = main;
  else body = body.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const text = decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<\/(p|div|section|h[1-6]|li|tr|table|ul|ol|dl|dt|dd|blockquote|pre)>/gi, "\n")
      .replace(/<h([1-6])\b[^>]*>/gi, "\n## ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/ \|\s*\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}
