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
// a cookie set by the settings page. This allows users to choose whether to show
// the system status bar without reinstalling the PWA on every settings change.
export function GET(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  const isEdge = /Edg/i.test(ua);

  // Read user preference from cookie (set by settings page)
  const cookies = request.headers.get("cookie") || "";
  const displayModeCookie = cookies.split(";").find(c => c.trim().startsWith("pwaDisplayMode="));
  const userDisplayMode = displayModeCookie?.split("=")[1]?.trim();

  let manifest = { ...baseManifest };

  // Apply Edge-specific fixes first
  if (isEdge) {
    manifest = {
      ...manifest,
      display: "minimal-ui",
      display_override: ["minimal-ui", "standalone"],
      theme_color: "#f8f7f2",
    };
  }

  // Apply user preference if set (overrides defaults)
  if (userDisplayMode === "fullscreen") {
    manifest.display_override = ["fullscreen", "standalone"];
  } else if (userDisplayMode === "standalone") {
    manifest.display_override = ["standalone", "fullscreen"];
  }

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // Must vary by UA and cookie to serve correct manifest per user preference
      "vary": "user-agent, cookie",
      "cache-control": "no-store",
    },
  });
}
