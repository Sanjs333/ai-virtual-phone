export type PwaDisplayPreference = "fullscreen" | "standalone";
export type RuntimePwaDisplayMode = "fullscreen" | "standalone" | "minimal-ui" | "browser";
export type PwaHostedSurface = "custom-app" | "game";

export type PwaHostedSafeArea = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

export const PWA_DISPLAY_MODE_COOKIE = "pwa_display_mode";
export const PWA_DISPLAY_MODE_CHANGED_EVENT = "pwa-display-mode-changed";
export const DEFAULT_PWA_DISPLAY_PREFERENCE: PwaDisplayPreference = "fullscreen";

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readPwaDisplayPreference(cookie: string): PwaDisplayPreference | null {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${PWA_DISPLAY_MODE_COOKIE}=([^;]+)`));
  if (!match) return null;
  const value = decodeCookieValue(match[1]);
  return value === "fullscreen" || value === "standalone" ? value : null;
}

export function writePwaDisplayPreference(preference: PwaDisplayPreference) {
  if (typeof document === "undefined") return;
  document.cookie = `${PWA_DISPLAY_MODE_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new CustomEvent(PWA_DISPLAY_MODE_CHANGED_EVENT, { detail: preference }));
}

/** Preserve the upstream default: mobile browsers request fullscreen unless Edge or explicitly disabled. */
export function shouldRequestPwaFullscreen(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  const preference = readPwaDisplayPreference(document.cookie);
  if (preference === "standalone") return false;
  if (preference === "fullscreen") return true;
  return !/Edg/i.test(navigator.userAgent);
}

export function getRuntimePwaDisplayMode(): RuntimePwaDisplayMode {
  if (typeof window === "undefined" || typeof document === "undefined") return "browser";
  if (document.fullscreenElement || window.matchMedia("(display-mode: fullscreen)").matches) {
    return "fullscreen";
  }
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return "standalone";
  }
  if (window.matchMedia("(display-mode: minimal-ui)").matches) {
    return "minimal-ui";
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone ? "standalone" : "browser";
}

/** Safe-area values injected into sandboxed apps, which cannot inherit host CSS variables. */
export function getPwaHostedSafeArea(surface: PwaHostedSurface, embedded = false): PwaHostedSafeArea {
  if (embedded) {
    return { top: "0px", right: "0px", bottom: "0px", left: "0px" };
  }

  const nonImmersive = getRuntimePwaDisplayMode() !== "fullscreen";
  return {
    top: nonImmersive ? (surface === "game" ? "60px" : "48px") : "88px",
    right: "16px",
    bottom: "24px",
    left: "16px",
  };
}
