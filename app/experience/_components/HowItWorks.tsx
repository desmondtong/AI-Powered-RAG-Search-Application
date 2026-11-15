"use client";

import { EXPERIENCE_PAGE, HOW_IT_WORKS } from "@/app/lib/experience/workspace/copy";
import { Disclosure } from "./ui";

/** The Experience page's one explanation of the six stages, collapsed until asked for. */
export default function HowItWorks() {
  return (
    <Disclosure title={EXPERIENCE_PAGE.howItWorks} className="bg-subtle">
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HOW_IT_WORKS.map((stage, index) => (
          <li key={stage.name} className="flex gap-3">
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-card text-label-md text-ink-secondary"
            >
              {index + 1}
            </span>
            <p className="text-body-sm text-ink-secondary">
              <span className="font-semibold text-ink">{stage.name}.</span> {stage.description}
            </p>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
