import type { Metadata } from "next";
import { HELP_PAGE, HELP_SECTIONS, type HelpBlock } from "@/app/lib/experience/workspace/help";

export const metadata: Metadata = { title: HELP_PAGE.title };

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === "paragraph") return <p className="text-body-md text-ink-secondary">{block.text}</p>;
  if (block.kind === "steps") {
    return (
      <ol className="space-y-2">
        {block.items.map((item, index) => (
          <li key={item} className="flex gap-3 text-body-md text-ink-secondary">
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-subtle text-label-md text-ink-secondary"
            >
              {index + 1}
            </span>
            <span className="pt-0.5">{item}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {block.items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-body-md font-semibold text-ink">{item.term}</dt>
          <dd className="mb-2 text-body-md text-ink-secondary sm:mb-0">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The single home for how-to content (in-app-help). Static: no API request, so it renders fully even when the
 * experience API is down. Add a section in `HELP_SECTIONS` when a feature ships.
 */
export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-heading text-headline-xl text-ink">{HELP_PAGE.title}</h1>
      </header>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        {/* Sticky beside the sections on wide screens (top bar is h-14); stacked above them on narrow ones. */}
        <nav aria-labelledby="help-toc-title" className="mb-6 lg:sticky lg:top-22 lg:mb-0 lg:self-start">
          <h2 id="help-toc-title" className="mb-2 text-label-caps uppercase text-ink-muted">
            {HELP_PAGE.onThisPage}
          </h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col">
            {HELP_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-body-md font-semibold text-cobalt hover:text-cobalt-hover hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          {HELP_SECTIONS.map((section) => (
            <section
              key={section.id}
              aria-labelledby={section.id}
              className="space-y-4 rounded-panel border border-hairline bg-card p-6"
            >
              {/* scroll-mt keeps a linked heading below the sticky top bar. */}
              <h2 id={section.id} className="scroll-mt-20 font-heading text-headline-md text-ink">
                {section.title}
              </h2>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
