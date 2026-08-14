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
// User preference for PWA display mode is read from the `pwa_display_mode` cookie
// (set by the settings page). Cookies are sent with the manifest network request
// at (re)install time, which IndexedDB / URL params cannot reliably do.
//   - "standalone"  -> immersive (hides native status bar, may prompt fullscreen)
//   - "fullscreen"  -> fully immersive
//   - default/absent -> "minimal-ui": shows the native status bar, no fullscreen prompt
// The `display` main field (not display_override) is what decides whether the
// status bar is shown. Takes effect only on (re)install.
export function GET(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  const isEdge = /Edg/i.test(ua);

  // Read user preference from cookie
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)pwa_display_mode=([^;]+)/);
  const userDisplayMode = match ? decodeURIComponent(match[1]) : "";

  let manifest = { ...baseManifest };

  // Apply user preference to the `display` main field.
  if (userDisplayMode === "fullscreen") {
    manifest.display = "fullscreen";
    manifest.display_override = ["fullscreen", "standalone"];
  } else if (userDisplayMode === "standalone") {
    manifest.display = "standalone";
    manifest.display_override = ["standalone", "minimal-ui"];
  } else {
    // Default: show the native status bar, no fullscreen prompt.
    manifest.display = "minimal-ui";
    manifest.display_override = ["minimal-ui", "standalone"];
  }

  // Edge only ever renders the native status bar correctly with minimal-ui.
  if (isEdge && userDisplayMode !== "fullscreen") {
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
