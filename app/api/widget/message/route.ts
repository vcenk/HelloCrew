import { isSameOrigin } from "@/lib/server/request-safety";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { respondToWidgetMessage } from "@/lib/server/widget-provider";
import {
  getWidgetInstallation,
  widgetMessageRequestSchema,
} from "@/lib/widget";

export const runtime = "nodejs";

const MAX_BYTES = 2048;

class WidgetRequestTooLargeError extends Error {}

async function readBoundedText(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new WidgetRequestTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Use JSON." }, { status: 415 });
  if (!request.headers.get("origin") || !isSameOrigin(request))
    return Response.json(
      { error: "Widget messages must come from this installation frame." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return Response.json({ error: "Request too large." }, { status: 413 });
  const limited = rateLimit(clientKey(request, "widget"), 30, 60_000);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const raw = await readBoundedText(request);
    const parsed = widgetMessageRequestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "Invalid widget message." },
        { status: 400 },
      );

    const installation = getWidgetInstallation(parsed.data.installationId);
    if (!installation)
      return Response.json(
        { error: "Installation not found." },
        { status: 404 },
      );

    return Response.json(
      respondToWidgetMessage(installation, parsed.data.message),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof WidgetRequestTooLargeError)
      return Response.json({ error: "Request too large." }, { status: 413 });
    return Response.json(
      { error: "The practice widget could not answer that message." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
