import { ImageResponse } from "next/og";

// Drawn from the brand tokens in globals.css rather than a stock illustration.
export const alt =
  "HelloCrew — teach a crew of AI agents what they may say, test them safely, then go live when you are ready.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const canvas = "#f7f6ef";
const ink = "#232923";
const green = "#315b48";
const yellow = "#f1db72";
const muted = "#6b726a";
const line = "#e3e5dc";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: canvas,
          padding: "64px 72px",
          fontFamily: "sans-serif",
          color: ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Drawn rather than typed: the ✳ glyph falls back to an emoji font
              inside ImageResponse and renders as a filled tile. */}
          <div
            style={{
              display: "flex",
              width: 40,
              height: 40,
              borderRadius: 12,
              background: green,
            }}
          />
          <span
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: -1.5,
              display: "flex",
            }}
          >
            HelloCrew.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 500,
              letterSpacing: -3,
              lineHeight: 1.05,
              maxWidth: 940,
              display: "flex",
            }}
          >
            A crew of AI agents your customers can talk to — and you can
            overrule.
          </div>
          <div style={{ fontSize: 30, color: muted, display: "flex" }}>
            Practice free in your browser. Go live when you&apos;re ready.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {["Teach", "Test", "Connect", "Approve", "Go live"].map(
            (step, i) => (
              <div
                key={step}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 24px",
                    borderRadius: 999,
                    background: i === 4 ? green : "#fffefa",
                    border: `1px solid ${i === 4 ? green : line}`,
                    color: i === 4 ? canvas : ink,
                    fontSize: 26,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: i === 4 ? yellow : green,
                    }}
                  />
                  {step}
                </div>
                {i < 4 && (
                  <span style={{ color: muted, fontSize: 26 }}>→</span>
                )}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    size,
  );
}
