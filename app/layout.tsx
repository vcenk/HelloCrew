import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const title = "HelloCrew · A little help. A lot more room.";
const description =
  "Teach a crew of AI agents what they may say, test them on made-up customers, then connect your channels. You approve anything that matters. Practice is free and runs in your browser.";

// Resolved without lib/supabase/config's getSiteUrl(), which throws when
// NEXT_PUBLIC_SITE_URL is missing — metadata must never be the reason a build
// fails. Unset simply means no base: Next.js still renders every tag, it just
// leaves the absolute URLs unresolved and says so during the build. Vercel
// supplies VERCEL_PROJECT_PRODUCTION_URL on its own.
function metadataBase() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `https://${host}` : undefined);
  if (!origin) return undefined;
  try {
    return new URL(origin);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  // Resolves the relative OG/canonical URLs below against the deployed origin.
  metadataBase: metadataBase(),
  // No `template` on purpose: every page already spells out "· HelloCrew",
  // including the dashboard's, and a template would double the suffix.
  title,
  description,
  applicationName: "HelloCrew",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "HelloCrew",
    title,
    description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // width/initial-scale are left at the Next.js defaults so pinch zoom keeps
  // working; only the chrome colour and scheme are set here.
  themeColor: "#315b48",
  colorScheme: "light",
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
