"use client";

import { Toast } from "@base-ui/react/toast";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { CheckIcon, CloseIcon } from "./icons";
import { useLeaveGuard } from "./LeaveGuardProvider";

/** A notice may carry one action: a handler, a link, or both. */
export interface NoticeAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface NoticeOptions {
  action?: NoticeAction;
}

/**
 * Transient outcome notices (design Decision 4). Success and information only: there is deliberately no error
 * method, because errors and anything that needs a decision stay in place on the page.
 */
export interface Notice {
  success: (text: string, options?: NoticeOptions) => void;
  info: (text: string, options?: NoticeOptions) => void;
}

/** One manager for the whole app, so `useNotice()` is stable and safe to pass into hooks and effect dependencies. */
const manager = Toast.createToastManager();
let navigate: ((href: string) => void) | null = null;

function add(type: "success" | "info", text: string, options?: NoticeOptions) {
  const action = options?.action;
  const id = manager.add({
    type,
    title: text,
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            manager.close(id);
            action.onClick?.();
            if (action.href) navigate?.(action.href);
          },
        }
      : undefined,
  });
}

const notice: Notice = {
  success: (text, options) => add("success", text, options),
  info: (text, options) => add("info", text, options),
};

export function useNotice(): Notice {
  return notice;
}

/**
 * Mounted once in the root layout, so a notice raised just before a client navigation is still shown on the next
 * page. One notice at a time, five seconds, bottom-left on wide screens (clear of the sticky review rail) and
 * full-width at the bottom on narrow ones.
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { intercept } = useLeaveGuard();
  useEffect(() => {
    // A notice link is an in-app navigation, so it waits for the leave guard like any other link.
    navigate = (href) => {
      if (!intercept(href)) router.push(href);
    };
    return () => {
      navigate = null;
    };
  }, [router, intercept]);

  return (
    <Toast.Provider toastManager={manager} limit={1} timeout={5000}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          // F6 moves focus to the region itself, so Escape is handled here rather than on each notice.
          onKeyDown={(event) => {
            if (event.key === "Escape") manager.close();
          }}
          className="fixed right-4 bottom-4 left-4 z-50 sm:right-auto sm:w-[22.5rem]"
        >
          <NoticeList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function NoticeList() {
  const { toasts } = Toast.useToastManager();
  const visible = toasts.some((toast) => !toast.limited);

  // On narrow screens the notice spans the bottom edge; pad the page so it never hides the last line of content.
  useEffect(() => {
    if (visible) document.body.dataset.notice = "open";
    else delete document.body.dataset.notice;
  }, [visible]);

  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="absolute bottom-0 left-0 w-full rounded-panel border border-hairline bg-raised text-ink shadow-raised transition-[opacity,translate] duration-200 ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-reduce:transition-none"
    >
      <Toast.Content className="flex items-center gap-3 py-3 pr-2 pl-4">
        <span aria-hidden className={`shrink-0 ${toast.type === "success" ? "text-green" : "text-cobalt"}`}>
          {toast.type === "success" ? <CheckIcon size={16} /> : <span className="block size-2 rounded-full bg-cobalt" />}
        </span>
        <Toast.Title className="min-w-0 flex-1 text-body-md text-ink" />
        {toast.actionProps && (
          <Toast.Action className="shrink-0 rounded-control px-2 py-1 text-body-md font-semibold text-cobalt hover:bg-evidence-wash" />
        )}
        <Toast.Close
          aria-label="Dismiss"
          className="grid size-8 shrink-0 place-items-center rounded-control text-ink-secondary hover:bg-subtle hover:text-ink"
        >
          <CloseIcon size={14} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}
