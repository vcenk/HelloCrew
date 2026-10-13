import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "HelloCrew · A little help. A lot more room.",
  description:
    "Meet a simpler way to explore business assistants. Try a safe, no-cost practice demo with HelloCrew.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
