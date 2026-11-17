"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, PRODUCT_NAME, indexedPill } from "@/app/lib/experience/workspace/copy";
import { useLeaveGuard } from "./LeaveGuardProvider";
import { useWorkspaceSummary } from "./WorkspaceSummaryProvider";

const DESTINATIONS = [
  { href: "/", label: NAV.fitCheck, matches: (path: string) => path === "/" },
  { href: "/experience", label: NAV.experience, matches: (path: string) => path === "/experience" || path.startsWith("/experience/") },
] as const;

export default function TopBar() {
  const pathname = usePathname() ?? "/";
  const { indexedCount } = useWorkspaceSummary();
  const { intercept } = useLeaveGuard();
  /** Holds the navigation while the open page has unsaved edits (design Decision 5). */
  const guarded = (href: string) => (event: { preventDefault: () => void }) => {
    if (intercept(href)) event.preventDefault();
  };

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-hairline bg-card">
      <div className="mx-auto flex h-full max-w-[1536px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
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
                className={`flex items-center border-b-2 px-2 text-body-md font-semibold ${
                  current ? "border-cobalt text-cobalt" : "border-transparent text-ink-secondary hover:text-ink"
                }`}
              >
                {destination.label}
              </Link>
            );
          })}
        </nav>

        {indexedCount !== null && (
          <p
            className={`ml-auto flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-label-md ${
              indexedCount > 0 ? "border-green-border bg-green-wash text-green" : "border-hairline bg-subtle text-ink-secondary"
            }`}
            aria-live="polite"
          >
            <span aria-hidden className={`size-2 rounded-full ${indexedCount > 0 ? "bg-green" : "bg-ink-subtle"}`} />
            <span className="hidden sm:inline">{indexedPill(indexedCount)}</span>
            <span className="sm:hidden">{indexedCount} indexed</span>
          </p>
        )}
      </div>
    </header>
  );
}
