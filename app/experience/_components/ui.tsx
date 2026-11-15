import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const BASE =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-control px-4 py-2 text-body-md font-semibold transition-colors disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-cobalt text-on-cobalt hover:bg-cobalt-hover disabled:bg-disabled-bg disabled:text-disabled-text",
  secondary:
    "border border-hairline bg-card text-ink hover:border-hairline-strong hover:bg-subtle disabled:border-hairline disabled:bg-disabled-bg disabled:text-disabled-text",
  ghost: "text-cobalt hover:bg-evidence-wash disabled:text-disabled-text",
  destructive: "bg-red text-on-cobalt hover:opacity-90 disabled:bg-disabled-bg disabled:text-disabled-text",
};

export function buttonClass(variant: ButtonVariant = "secondary", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
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

export function Card({ className = "", children, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" }) {
  return (
    <section className={`rounded-panel border border-hairline bg-card ${className}`} {...props}>
      {children}
    </section>
  );
}
