"use client";

import { useEffect } from "react";

// Last-resort boundary: it replaces the root layout, so it renders its own
// document and cannot rely on globals.css or the font imports. Everything here
// is inline on purpose — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          padding: "32px 20px",
          background: "#f7f6ef",
          color: "#232923",
          colorScheme: "light",
          font: '400 15px/1.55 "DM Sans", Arial, sans-serif',
        }}
      >
        <title>Something went wrong · HelloCrew</title>
        <div
          role="alert"
          style={{
            width: "min(520px, 100%)",
            padding: 30,
            border: "1px solid #e3e5dc",
            borderRadius: 20,
            background: "#fffefa",
          }}
        >
          <h1 style={{ margin: "0 0 12px", font: "400 27px/1.2 Georgia, serif" }}>
            HelloCrew could not load.
          </h1>
          <p style={{ margin: "0 0 18px", color: "#6b726a" }}>
            Something failed before the page could start. Your saved setup is
            untouched. Try again, and reload the tab if it persists.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0 0 18px",
                color: "#6b726a",
                fontSize: 12.5,
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "0 18px",
              border: "1px solid #315b48",
              borderRadius: 999,
              background: "#315b48",
              color: "#fffefa",
              font: '600 15px "DM Sans", Arial, sans-serif',
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
