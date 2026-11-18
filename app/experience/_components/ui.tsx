import { Collapsible } from "@base-ui/react/collapsible";
import { Tooltip } from "@base-ui/react/tooltip";
import Link from "next/link";
import { Children, isValidElement, type AnchorHTMLAttributes, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { ChevronIcon, SpinnerIcon } from "@/app/components/icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const BASE = "inline-flex min-h-9 items-center justify-center gap-2 rounded-control px-4 py-2 text-body-md font-semibold transition-colors";

/** Each variant's own colours, and the grey it takes when disabled. A busy button keeps its own colours. */
const VARIANTS: Record<ButtonVariant, { idle: string; disabled: string }> = {
  primary: { idle: "bg-cobalt text-on-cobalt hover:bg-cobalt-hover", disabled: "disabled:bg-disabled-bg disabled:text-disabled-text" },
  secondary: {
    idle: "border border-hairline bg-card text-ink hover:border-hairline-strong hover:bg-subtle",
    disabled: "disabled:border-hairline disabled:bg-disabled-bg disabled:text-disabled-text",
  },
  ghost: { idle: "text-cobalt hover:bg-evidence-wash", disabled: "disabled:text-disabled-text" },
  destructive: { idle: "bg-red text-on-cobalt hover:opacity-90", disabled: "disabled:bg-disabled-bg disabled:text-disabled-text" },
};

export function buttonClass(variant: ButtonVariant = "secondary", extra = "", busy = false) {
  const colours = VARIANTS[variant];
  const state = busy ? "cursor-progress" : `disabled:cursor-not-allowed ${colours.disabled}`;
  return `${BASE} ${colours.idle} ${state} ${extra}`.trim();
}

/** The spinner takes the place of a leading icon, or leads the label when there is none. */
function withSpinner(children: ReactNode) {
  const items = Children.toArray(children);
  const first = items[0];
  const leadingIcon = isValidElement(first) && typeof first.type === "function";
  return [<SpinnerIcon key="busy-spinner" size={16} />, ...(leadingIcon ? items.slice(1) : items)];
}

/**
 * `busy` marks a request in flight: the button shows a spinner, keeps its colour, refuses activation and sets
 * `aria-busy`. `disabled` alone means "not allowed now" and greys the button.
 */
export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  busy = false,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, className, busy)}
      {...props}
    >
      {busy ? withSpinner(children) : children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  className = "",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: ButtonVariant; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, className)} {...props}>
      {children}
    </Link>
  );
}

export type PillTone = "neutral" | "cobalt" | "amber" | "green" | "red" | "sand";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "border-hairline bg-subtle text-ink-secondary",
  cobalt: "border-evidence-border bg-evidence-wash text-evidence-text",
  amber: "border-amber-border bg-amber-wash text-amber-text",
  green: "border-green-border bg-green-wash text-green",
  red: "border-red-border bg-red-wash text-red",
  sand: "border-sand-border bg-sand-wash text-sand-label",
};

export function Pill({ tone = "neutral", className = "", children }: { tone?: PillTone; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label-md ${PILL_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/**
 * The app's one disclosure pattern (report diagnostics): a label-caps trigger with a chevron and
 * `aria-expanded`, over a panel whose height animates unless the user prefers reduced motion. Open state is per page.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={`rounded-panel border border-hairline ${className}`}>
      <Collapsible.Trigger className="group flex w-full items-center justify-between gap-2 rounded-panel px-5 py-4 text-left text-label-caps uppercase text-ink-muted hover:text-ink">
        {title}
        <ChevronIcon size={16} className="shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="px-5 pb-5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** A short tooltip on hover or focus. `children` is the trigger element, rendered as-is with the tooltip wired in. */
export function Hint({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-50">
          <Tooltip.Popup className="max-w-xs rounded-control border border-hairline bg-raised px-2 py-1 text-body-sm text-ink shadow-raised">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Card({ className = "", children, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" }) {
  return (
    <section className={`rounded-panel border border-hairline bg-card ${className}`} {...props}>
      {children}
    </section>
  );
}
