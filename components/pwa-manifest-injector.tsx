"use client";

import { useEffect } from "react";

export function PWAManifestInjector() {
  useEffect(() => {
    // The manifest route reads the `pwa_display_mode` cookie to decide the display
    // mode; there is nothing to inject client-side. We only bust any cached
    // manifest link so a fresh copy is fetched after the user changes the setting.
    const link = document.querySelector('link[rel="manifest"]');
    if (link) {
      const href = link.getAttribute("href") || "/manifest.webmanifest";
      const base = href.split("?")[0];
      link.setAttribute("href", `${base}?t=${Date.now()}`);
    }
  }, []);

  return null;
}
