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
  registerBackHandler: (handler: PhoneBackHandler, priority: number) => () => void;
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
  const handlingPopRef = useRef(false);
  const suppressPopRef = useRef(0);
  const requestPendingRef = useRef(false);
  const mountedRef = useRef(false);

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
    const hash = depth > 0 ? `#phone-nav-${++markerIdRef.current}` : window.location.hash;
    if (replace) window.history.replaceState(state, "", hash || undefined);
    else window.history.pushState(state, "", hash);
  }, []);

  const syncToRegisteredDepth = useCallback(() => {
    if (typeof window === "undefined") return;
    const handlers = handlersRef.current;
    const desiredDepth = handlers.length;
    const current = readMarker(window.history.state);
    if (
      current?.session === sessionRef.current
      && current.depth === desiredDepth
      && current.entryId === (handlers[handlers.length - 1]?.id ?? null)
    ) {
      depthRef.current = desiredDepth;
      return;
    }
    if (desiredDepth === 0) {
      depthRef.current = 0;
      window.history.replaceState(
        withMarker(window.history.state, {
          session: sessionRef.current,
          depth: 0,
          entryId: null,
        }),
        "",
        baseUrlRef.current ?? `${window.location.pathname}${window.location.search}`,
      );
      return;
    }
    writeLayerMarker(handlers[handlers.length - 1]?.id ?? null, desiredDepth);
  }, [writeLayerMarker]);

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
      writeLayerMarker(top.id, handlersRef.current.length);
      return;
    }
    syncToRegisteredDepth();
  }, [syncToRegisteredDepth, writeLayerMarker]);

  const onPopState = useCallback((event: PopStateEvent) => {
    if (typeof window === "undefined" || !mountedRef.current) return;
    const previousDepth = depthRef.current;
    const nextMarker = readMarker(event.state);
    const isCurrentSession = nextMarker?.session === sessionRef.current;
    const nextDepth = isCurrentSession ? nextMarker.depth : 0;
    depthRef.current = nextDepth;
    requestPendingRef.current = false;

    if (nextDepth > previousDepth) {
      // A stale forward entry cannot restore React state. Return to the last
      // state represented by the registered handler stack.
      window.history.go(-1);
      return;
    }
    if (!isCurrentSession && previousDepth === 0 && handlersRef.current.length === 0) {
      return;
    }
    if (suppressPopRef.current > 0) {
      suppressPopRef.current -= 1;
      syncToRegisteredDepth();
      return;
    }
    if (handlingPopRef.current) return;
    handlingPopRef.current = true;
    invokeTopHandler();
    window.setTimeout(() => {
      handlingPopRef.current = false;
    }, 0);
  }, [invokeTopHandler, syncToRegisteredDepth]);

  useLayoutEffect(() => {
    ensureRootMarker();
    mountedRef.current = true;
    window.addEventListener("popstate", onPopState);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("popstate", onPopState);
      handlersRef.current = [];
    };
  }, [ensureRootMarker, onPopState]);

  const registerBackHandler = useCallback((handler: PhoneBackHandler, priority: number) => {
    if (typeof window === "undefined") return () => { };
    ensureRootMarker();
    const entry: RegisteredHandler = {
      id: createId("phone-layer"),
      handler,
      priority,
      order: ++handlerOrderRef.current,
    };
    const previousTop = handlersRef.current[handlersRef.current.length - 1] ?? null;
    handlersRef.current.push(entry);
    handlersRef.current.sort((a, b) => a.priority - b.priority || a.order - b.order);
    const current = readMarker(window.history.state);
    const top = handlersRef.current[handlersRef.current.length - 1] ?? entry;
    const currentDepth = current?.session === sessionRef.current ? current.depth : 0;
    if (previousTop && entry.priority < previousTop.priority) {
      // A parent layout effect can run after a child layout effect. Insert the
      // lower-priority handler into the logical stack without adding a second
      // browser entry; the missing layer is materialized when the child backs
      // out and the stack becomes visible again.
      writeLayerMarker(top.id, currentDepth, true);
    } else {
      writeLayerMarker(top.id, currentDepth + 1);
    }

    return () => {
      const index = handlersRef.current.findIndex(item => item.id === entry.id);
      if (index < 0) return;
      const wasTop = index === handlersRef.current.length - 1;
      handlersRef.current.splice(index, 1);
      if (!wasTop || handlingPopRef.current || suppressPopRef.current > 0) return;
      const marker = readMarker(window.history.state);
      if (marker?.session !== sessionRef.current || marker.entryId !== entry.id) return;
      suppressPopRef.current += 1;
      window.history.back();
    };
  }, [ensureRootMarker, writeLayerMarker]);

  const requestBack = useCallback(() => {
    if (typeof window === "undefined") return false;
    const top = handlersRef.current[handlersRef.current.length - 1];
    if (!top) return false;
    if (requestPendingRef.current) return true;
    requestPendingRef.current = true;
    const marker = readMarker(window.history.state);
    if (marker?.session === sessionRef.current && marker.entryId === top.id) {
      window.history.back();
      return true;
    }
    invokeTopHandler();
    window.setTimeout(() => {
      requestPendingRef.current = false;
    }, 0);
    return true;
  }, [invokeTopHandler]);

  const value = useMemo(() => ({ requestBack, registerBackHandler }), [registerBackHandler, requestBack]);
  return <PhoneNavigationContext.Provider value={value}>{children}</PhoneNavigationContext.Provider>;
}

export function usePhoneBack(): () => boolean {
  const context = useContext(PhoneNavigationContext);
  if (!context) throw new Error("usePhoneBack must be used within <PhoneNavigationProvider>");
  return context.requestBack;
}

export function usePhoneBackHandler(active: boolean, handler: PhoneBackHandler, priority = 0): void {
  const context = useContext(PhoneNavigationContext);
  if (!context) throw new Error("usePhoneBackHandler must be used within <PhoneNavigationProvider>");
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useLayoutEffect(() => {
    if (!active) return undefined;
    return context.registerBackHandler(() => handlerRef.current(), priority);
  }, [active, context, priority]);
}
