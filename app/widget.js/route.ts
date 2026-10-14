import { createWidgetLoaderScript } from "@/lib/widget-loader";

export function GET() {
  return new Response(createWidgetLoaderScript(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
}
