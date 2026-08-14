import { NextRequest, NextResponse } from "next/server";

import baseManifest from "../../public/manifest.json";

export const runtime = "nodejs";

// Edge's installed PWA renders the top status-bar area as a solid (black) band in
// `standalone` mode instead of showing the native status bar. Serving `minimal-ui`
// + a light theme_color brings the native status bar (clock/battery/signal) back —
// but ONLY for Edge, so Chrome/others keep the fully immersive `standalone` look.
// The manifest is fetched per browser at install time, so UA sniffing here works.
// Takes effect only on (re)install.
// 
// User preference for PWA display mode (fullscreen vs standalone) is read from
// URL query parameter (?mode=standalone or ?mode=fullscreen). The settings page
// generates a custom install link with the user's preference.
export function GET(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  const isEdge = /Edg/i.test(ua);

  // Read user preference from URL query parameter
  const { searchParams } = new URL(request.url);
  const userDisplayMode = searchParams.get("mode");

  let manifest = { ...baseManifest };

  // Apply user preference first if set
  if (userDisplayMode === "fullscreen") {
    manifest.display_override = ["fullscreen", "standalone"];
  } else if (userDisplayMode === "standalone") {
    manifest.display_override = ["standalone", "fullscreen"];
  }

  // Apply Edge-specific fixes (may override user preference for Edge)
  if (isEdge) {
    manifest = {
      ...manifest,
      display: "minimal-ui",
      display_override: ["minimal-ui", "standalone"],
      theme_color: "#f8f7f2",
    };
  }

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // Must vary by UA to serve correct manifest per browser
      "vary": "user-agent",
      "cache-control": "no-store",
    },
  });
}
