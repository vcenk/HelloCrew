import { runDemo } from "@/lib/demo";
export const runtime = "nodejs";
export const maxDuration = 10;
const MAX_BYTES = 12000;
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Use JSON." }, { status: 415 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Cross-origin demo requests are not supported." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return Response.json({ error: "Request too large." }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "Missing request." }, { status: 400 });
    const parts: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Request too large." }, { status: 413 });
      }
      parts.push(value);
    }
    const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const result = await runDemo(data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      {
        error:
          "This practice step could not run. Check the request or start a fresh demo.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
