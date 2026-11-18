"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV, PRODUCT_NAME, indexedPill } from "@/app/lib/experience/workspace/copy";
import { useLeaveGuard } from "./LeaveGuardProvider";
import { useWorkspaceSummary } from "./WorkspaceSummaryProvider";

const DESTINATIONS = [
  { href: "/", label: NAV.fitCheck, matches: (path: string) => path === "/" },
  { href: "/experience", label: NAV.experience, matches: (path: string) => path === "/experience" || path.startsWith("/experience/") },
  { href: "/help", label: NAV.help, matches: (path: string) => path === "/help" },
] as const;

/**
 * The application top bar: wordmark, three destinations, the indexed-file pill and the account slot. `account` is
 * rendered by the root layout (a Suspense-wrapped server read of the IAP identity) and placed at the right end.
 */
export default function TopBar({ account }: { account?: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { indexedCount } = useWorkspaceSummary();
  const { intercept } = useLeaveGuard();
  /** Holds the navigation while the open page has unsaved edits (design Decision 5). */
  const guarded = (href: string) => (event: { preventDefault: () => void }) => {
    if (intercept(href)) event.preventDefault();
  };

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-hairline bg-card">
      <div className="mx-auto flex h-full max-w-[1536px] items-center gap-2 px-4 sm:gap-8 sm:px-6">
        <Link href="/" onNavigate={guarded("/")} className="flex shrink-0 items-center gap-2 font-heading text-title-sm font-bold text-ink">
          <span aria-hidden className="grid size-6 place-items-center rounded-control bg-cobalt text-label-md text-on-cobalt">
            JD
          </span>
          <span className="sr-only sm:not-sr-only">{PRODUCT_NAME}</span>
        </Link>

        <nav aria-label="Primary" className="flex h-full items-stretch gap-1 sm:gap-4">
          {DESTINATIONS.map((destination) => {
            const current = destination.matches(pathname);
            return (
              <Link
                key={destination.href}
                href={destination.href}
                onNavigate={guarded(destination.href)}
                aria-current={current ? "page" : undefined}
                className={`flex items-center whitespace-nowrap border-b-2 px-1.5 text-body-sm font-semibold sm:px-2 sm:text-body-md ${
                  current ? "border-cobalt text-cobalt" : "border-transparent text-ink-secondary hover:text-ink"
                }`}
              >
                {destination.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
          {indexedCount !== null && (
            <p
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-label-md sm:gap-2 sm:px-3 ${
                indexedCount > 0 ? "border-green-border bg-green-wash text-green" : "border-hairline bg-subtle text-ink-secondary"
              }`}
              aria-live="polite"
            >
              <span aria-hidden className={`size-2 rounded-full ${indexedCount > 0 ? "bg-green" : "bg-ink-subtle"}`} />
              <span className="hidden sm:inline">{indexedPill(indexedCount)}</span>
              {/* Phones show only the number; assistive technology still hears the full wording. */}
              <span aria-hidden className="sm:hidden">
                {indexedCount}
              </span>
              <span className="sr-only sm:hidden">{indexedPill(indexedCount)}</span>
            </p>
          )}
          {account}
        </div>
      </div>
    </header>
  );
}
