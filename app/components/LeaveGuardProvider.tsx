"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** What a page with unsaved edits registers: whether it is dirty right now, and how to save before leaving. */
export interface LeaveBlocker {
  isDirty: () => boolean;
  /** Resolves to true when the save succeeded and leaving may proceed. */
  save: () => Promise<boolean>;
}

/** Where the user was going: an in-app href, or one step back in history. */
export type LeaveTarget = { kind: "href"; href: string } | { kind: "back" };

export type LeaveChoice = "stay" | "leave" | "save";

export interface LeaveGuard {
  /** Registers the one blocker; returns the function that unregisters it. */
  register: (blocker: LeaveBlocker) => () => void;
  /** True when the navigation must wait for the user's choice; the caller then prevents its default navigation. */
  intercept: (target: LeaveTarget | string) => boolean;
  pending: LeaveTarget | null;
  resolve: (choice: LeaveChoice) => Promise<void>;
}

const NO_GUARD: LeaveGuard = {
  register: () => () => {},
  intercept: () => false,
  pending: null,
  resolve: async () => {},
};

const LeaveGuardContext = createContext<LeaveGuard>(NO_GUARD);

export function useLeaveGuard(): LeaveGuard {
  return useContext(LeaveGuardContext);
}

/**
 * The in-app half of the unsaved-edits guard (design Decision 5). Links and notice actions ask `intercept` before
 * navigating; while the registered blocker is dirty the target is held as `pending` and the page renders the
 * in-page confirmation, whose choices call `resolve`. Browser-level exits are the page's own `beforeunload`.
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const blocker = useRef<LeaveBlocker | null>(null);
  const leaving = useRef(false);
  const [pending, setPending] = useState<LeaveTarget | null>(null);

  // A leave is over once the route changed; the next page's links are guarded again.
  useEffect(() => {
    leaving.current = false;
  }, [pathname]);

  const register = useCallback((next: LeaveBlocker) => {
    blocker.current = next;
    return () => {
      if (blocker.current === next) blocker.current = null;
    };
  }, []);

  const intercept = useCallback((target: LeaveTarget | string) => {
    if (leaving.current || !blocker.current?.isDirty()) return false;
    setPending(typeof target === "string" ? { kind: "href", href: target } : target);
    return true;
  }, []);

  const go = useCallback(
    (target: LeaveTarget) => {
      leaving.current = true;
      if (target.kind === "href") router.push(target.href);
      // The page keeps a duplicate history entry while dirty, so "back" is two steps.
      else window.history.go(-2);
    },
    [router],
  );

  const resolve = useCallback(
    async (choice: LeaveChoice) => {
      const target = pending;
      setPending(null);
      if (!target || choice === "stay") return;
      if (choice === "leave") {
        go(target);
        return;
      }
      const saved = await blocker.current?.save();
      if (saved) go(target);
    },
    [pending, go],
  );

  const value = useMemo<LeaveGuard>(() => ({ register, intercept, pending, resolve }), [register, intercept, pending, resolve]);
  return <LeaveGuardContext.Provider value={value}>{children}</LeaveGuardContext.Provider>;
}
