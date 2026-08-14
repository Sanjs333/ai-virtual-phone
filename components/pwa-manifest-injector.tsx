"use client";

import { useEffect } from "react";

export function PWAManifestInjector() {
  useEffect(() => {
    // Read user preference from localStorage
    let mode = "standalone"; // default
    try {
      const settings = localStorage.getItem("chatAppSettings");
      if (settings) {
        const parsed = JSON.parse(settings);
        mode = parsed.pwaDisplayMode || "standalone";
      }
    } catch (e) {
      console.warn("[PWA] Failed to read display mode preference:", e);
    }

    // Update manifest link with mode parameter
    const existingLink = document.querySelector('link[rel="manifest"]');
    if (existingLink) {
      existingLink.setAttribute("href", `/manifest.webmanifest?mode=${mode}`);
    } else {
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = `/manifest.webmanifest?mode=${mode}`;
      document.head.appendChild(link);
    }
  }, []);

  return null;
}
