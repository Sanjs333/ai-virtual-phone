"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

const PHONE_HISTORY_KEY = "__aiVirtualPhoneNavigation";
const PHONE_HISTORY_SESSION = "phoneNavigationSession";
// history.back()/go() normally answers with popstate inside a frame. If the
// browser stays silent (blocked navigation, restored session, bfcache) release
// the in-flight guards so the system back button cannot get stuck forever.
const HISTORY_SETTLE_TIMEOUT = 700;

export type PhoneBackResult = void | "retain";
export type PhoneBackHandler = () => PhoneBackResult;

type PhoneHistoryMarker = {
  session: string;
  depth: number;
  entryId: string | null;
};

type RegisteredHandler = {
  id: string;
  handler: PhoneBackHandler;
  priority: number;
  order: number;
};

type PhoneNavigationValue = {
  requestBack: () => boolean;
  attachBackHandler: (entry: RegisteredHandler) => void;
  detachBackHandler: (entry: RegisteredHandler) => void;
};

const PhoneNavigationContext = createContext<PhoneNavigationValue | null>(null);

function readMarker(state: unknown): PhoneHistoryMarker | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PHONE_HISTORY_KEY];
  if (!value || typeof value !== "object") return null;
  const marker = value as Record<string, unknown>;
  if (typeof marker.session !== "string" || typeof marker.depth !== "number" || !Number.isInteger(marker.depth)) return null;
  return {
    session: marker.session,
    depth: Math.max(0, marker.depth),
    entryId: typeof marker.entryId === "string" ? marker.entryId : null,
  };
}

function withMarker(state: unknown, marker: PhoneHistoryMarker): Record<string, unknown> {
  const base = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return {
    ...base,
    [PHONE_HISTORY_KEY]: marker,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function PhoneNavigationProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<string>(createId(PHONE_HISTORY_SESSION));
  const handlersRef = useRef<RegisteredHandler[]>([]);
  const depthRef = useRef(0);
  const markerIdRef = useRef(0);
  const handlerOrderRef = useRef(0);
  const baseUrlRef = useRef<string | null>(null);
  // Non-null while we asked the browser to move inside history ourselves, so the
  // resulting popstate is treated as bookkeeping instead of a user back press.
  const historySyncTargetRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const requestPendingRef = useRef(false);
  const mountedRef = useRef(false);
  const scheduleRef = useRef<() => void>(() => { });
  // The handler consumed by the last back press, plus whether its owner asked to
  // come back during the same flush. A handler that closed one of several stacked
  // layers re-attaches immediately; one that did nothing at all does not.
  const invokedRef = useRef<{ id: string; healed: boolean } | null>(null);
  // Handlers that failed to close anything. They may not re-materialize a history
  // layer until they have genuinely closed once, so back can never be trapped.
  const staleRef = useRef<Set<string>>(new Set());

  const ensureRootMarker = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!baseUrlRef.current) {
      const hash = window.location.hash.startsWith("#phone-nav-") ? "" : window.location.hash;
      baseUrlRef.current = `${window.location.pathname}${window.location.search}${hash}`;
    }
    const marker = readMarker(window.history.state);
    if (marker?.session === sessionRef.current) {
      depthRef.current = marker.depth;
      return;
    }
    depthRef.current = 0;
    window.history.replaceState(
      withMarker(window.history.state, {
        session: sessionRef.current,
        depth: 0,
        entryId: null,
      }),
      "",
      baseUrlRef.current,
    );
  }, []);

  const writeLayerMarker = useCallback((entryId: string | null, depth: number, replace = false) => {
    if (typeof window === "undefined") return;
    const marker = {
      session: sessionRef.current,
      depth: Math.max(0, depth),
      entryId,
    } satisfies PhoneHistoryMarker;
    depthRef.current = marker.depth;
    const state = withMarker(window.history.state, marker);
    const rootUrl = baseUrlRef.current ?? `${window.location.pathname}${window.location.search}`;
    if (replace) {
      window.history.replaceState(state, "", depth === 0 ? rootUrl : undefined);
      return;
    }
    window.history.pushState(state, "", depth > 0 ? `#phone-nav-${++markerIdRef.current}` : rootUrl);
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (typeof window === "undefined" || settleTimerRef.current === null) return;
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  const armSettleTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      historySyncTargetRef.current = null;
      requestPendingRef.current = false;
      scheduleRef.current();
    }, HISTORY_SETTLE_TIMEOUT);
  }, []);

  // Keep exactly one browser history entry per registered layer. Every mutation
  // of the handler stack routes through here, so React state stays the source of
  // truth and the history depth follows it.
  const reconcileHistory = useCallback(() => {
    if (typeof window === "undefined" || !mountedRef.current) return;
    if (historySyncTargetRef.current !== null) return;
    ensureRootMarker();
    const invoked = invokedRef.current;
    if (invoked) {
      invokedRef.current = null;
      if (!invoked.healed) staleRef.current.add(invoked.id);
    }
    const handlers = handlersRef.current;
    const desiredDepth = handlers.length;
    let current = readMarker(window.history.state);
    if (current?.session !== sessionRef.current) {
      ensureRootMarker();
      current = readMarker(window.history.state);
    }
    const currentDepth = current?.session === sessionRef.current ? current.depth : 0;

    if (desiredDepth > currentDepth) {
      for (let depth = currentDepth + 1; depth <= desiredDepth; depth += 1) {
        writeLayerMarker(handlers[depth - 1]?.id ?? null, depth);
      }
      requestPendingRef.current = false;
      return;
    }

    if (desiredDepth < currentDepth) {
      historySyncTargetRef.current = desiredDepth;
      requestPendingRef.current = true;
      armSettleTimer();
      window.history.go(desiredDepth - currentDepth);
      return;
    }

    const topId = handlers[handlers.length - 1]?.id ?? null;
    if (current?.entryId !== topId) writeLayerMarker(topId, desiredDepth, true);
    else depthRef.current = desiredDepth;
    requestPendingRef.current = false;
  }, [armSettleTimer, ensureRootMarker, writeLayerMarker]);

  const scheduleHistorySync = useCallback(() => {
    if (typeof window === "undefined" || syncTimerRef.current !== null) return;
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      reconcileHistory();
    }, 0);
  }, [reconcileHistory]);

  scheduleRef.current = scheduleHistorySync;

  // Idempotent: re-attaching a layer that is still registered only refreshes the
  // sort order. A handler that stays active after handling a back press is
  // re-attached by usePhoneBackHandler, which re-materializes its history entry.
  const attachBackHandler = useCallback((entry: RegisteredHandler) => {
    if (typeof window === "undefined") return;
    const stack = handlersRef.current;
    const known = stack.some(item => item.id === entry.id);
    if (!known) {
      if (staleRef.current.has(entry.id)) return;
      if (invokedRef.current?.id === entry.id) invokedRef.current.healed = true;
      entry.order = ++handlerOrderRef.current;
      stack.push(entry);
    }
    stack.sort((a, b) => a.priority - b.priority || a.order - b.order);
    if (known) return;
    ensureRootMarker();
    scheduleHistorySync();
  }, [ensureRootMarker, scheduleHistorySync]);

  const detachBackHandler = useCallback((entry: RegisteredHandler) => {
    staleRef.current.delete(entry.id);
    const stack = handlersRef.current;
    const index = stack.findIndex(item => item.id === entry.id);
    if (index < 0) return;
    stack.splice(index, 1);
    scheduleHistorySync();
  }, [scheduleHistorySync]);

  // Consuming the top entry guarantees forward progress even if a handler is a
  // no-op; layers that are still open come back through attachBackHandler.
  const invokeTopHandler = useCallback(() => {
    const top = handlersRef.current.pop();
    if (!top) return;
    let result: PhoneBackResult;
    try {
      result = top.handler();
    } catch (error) {
      console.error("[PhoneNavigation] back handler failed", error);
      result = undefined;
    }
    if (result === "retain") {
      handlersRef.current.push(top);
      handlersRef.current.sort((a, b) => a.priority - b.priority || a.order - b.order);
      invokedRef.current = null;
    } else {
      invokedRef.current = { id: top.id, healed: false };
    }
    scheduleHistorySync();
  }, [scheduleHistorySync]);

  const onPopState = useCallback((event: PopStateEvent) => {
    if (typeof window === "undefined" || !mountedRef.current) return;
    clearSettleTimer();
    const previousDepth = depthRef.current;
    const nextMarker = readMarker(event.state);
    const isCurrentSession = nextMarker?.session === sessionRef.current;
    const nextDepth = isCurrentSession ? nextMarker.depth : 0;
    depthRef.current = nextDepth;
    requestPendingRef.current = false;

    if (historySyncTargetRef.current !== null) {
      historySyncTargetRef.current = null;
      scheduleHistorySync();
      return;
    }
    if (nextDepth > previousDepth) {
      // A stale forward entry cannot restore React state. Return to the last
      // state represented by the registered handler stack.
      historySyncTargetRef.current = handlersRef.current.length;
      requestPendingRef.current = true;
      armSettleTimer();
      window.history.go(-1);
      return;
    }
    if (!isCurrentSession && previousDepth === 0 && handlersRef.current.length === 0) {
      return;
    }
    if (nextDepth === previousDepth) {
      scheduleHistorySync();
      return;
    }
    invokeTopHandler();
  }, [armSettleTimer, clearSettleTimer, invokeTopHandler, scheduleHistorySync]);

  // On-screen back buttons go through history so the browser entry is consumed
  // together with the React layer; otherwise the next system back does nothing.
  const requestBack = useCallback(() => {
    if (typeof window === "undefined") return false;
    if (handlersRef.current.length === 0) return false;
    if (requestPendingRef.current) return true;
    const marker = readMarker(window.history.state);
    if (marker?.session === sessionRef.current && marker.depth > 0) {
      requestPendingRef.current = true;
      armSettleTimer();
      window.history.back();
      return true;
    }
    invokeTopHandler();
    return true;
  }, [armSettleTimer, invokeTopHandler]);

  useLayoutEffect(() => {
    ensureRootMarker();
    mountedRef.current = true;
    window.addEventListener("popstate", onPopState);
    scheduleHistorySync();
    return () => {
      mountedRef.current = false;
      window.removeEventListener("popstate", onPopState);
      handlersRef.current = [];
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      clearSettleTimer();
    };
  }, [clearSettleTimer, ensureRootMarker, onPopState, scheduleHistorySync]);

  const value = useMemo(
    () => ({ requestBack, attachBackHandler, detachBackHandler }),
    [attachBackHandler, detachBackHandler, requestBack],
  );
  return <PhoneNavigationContext.Provider value={value}>{children}</PhoneNavigationContext.Provider>;
}

export function usePhoneBack(): () => boolean {
  const context = useContext(PhoneNavigationContext);
  if (!context) throw new Error("usePhoneBack must be used within <PhoneNavigationProvider>");
  return context.requestBack;
}

/**
 * Registers one back layer. `active` must describe a single visual layer; a
 * handler that closes one of several stacked layers can simply stay active and
 * its history entry is restored for the next back press.
 */
export function usePhoneBackHandler(active: boolean, handler: PhoneBackHandler, priority = 0): void {
  const context = useContext(PhoneNavigationContext);
  if (!context) throw new Error("usePhoneBackHandler must be used within <PhoneNavigationProvider>");
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const entryRef = useRef<RegisteredHandler | null>(null);
  if (!entryRef.current) {
    entryRef.current = {
      id: createId("phone-layer"),
      handler: () => handlerRef.current(),
      priority,
      order: 0,
    };
  }
  const entry = entryRef.current;
  entry.priority = priority;

  useLayoutEffect(() => {
    if (!active) return undefined;
    context.attachBackHandler(entry);
    return () => context.detachBackHandler(entry);
  }, [active, context, entry, priority]);

  // Runs after every commit: if this layer is still open but its stack slot was
  // consumed by a back press that only closed an inner layer, restore it so the
  // next back press stops here instead of skipping to the parent layer.
  useLayoutEffect(() => {
    if (active) context.attachBackHandler(entry);
  });
}
