import { EXPERIENCE_PAGE, STAGE_LEGEND } from "@/app/lib/experience/workspace/copy";

export default function StageLegend() {
  return (
    <section aria-labelledby="stage-legend-title" className="rounded-panel border border-hairline bg-subtle p-5">
      <h2 id="stage-legend-title" className="text-label-caps uppercase text-ink-muted">
        {EXPERIENCE_PAGE.legendTitle}
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGE_LEGEND.map((stage, index) => (
          <li key={stage.name} className="flex gap-3">
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-card text-label-md text-ink-secondary"
            >
              {index + 1}
            </span>
            <p className="text-body-sm text-ink-secondary">
              <span className="font-semibold text-ink">
                {index + 1} · {stage.name}.
              </span>{" "}
              {stage.description}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
