"use client";

import { CloseIcon, LinkIcon, WarningIcon } from "@/app/components/icons";
import { MISSING_SPAN, REVIEW } from "@/app/lib/experience/workspace/copy";
import { spanExcerpt } from "@/app/lib/experience/workspace/review";
import {
  ACTIVITY_STATUSES,
  ATTRIBUTIONS,
  EVIDENCE_KINDS,
  type DraftFieldError,
  type EvidenceItem,
  type SourceBlock,
  type SourceSpan,
} from "@/app/lib/experience/workspace/types";
import { Button, Pill } from "../../_components/ui";
import InlineField, { PillSelect } from "./InlineField";
import StaticField from "./StaticField";

export function evidenceAnchorId(experienceIndex: number, evidenceIndex: number) {
  return `evidence-${experienceIndex}-${evidenceIndex}`;
}

interface EvidenceCardShared {
  experienceIndex: number;
  evidenceIndex: number;
  item: EvidenceItem;
  blocksById: ReadonlyMap<string, SourceBlock>;
  blockNumbers: ReadonlyMap<string, number>;
}

interface EditableEvidenceCardProps extends EvidenceCardShared {
  mode: "edit";
  errors: DraftFieldError[];
  selecting: boolean;
  onChange: (updater: (item: EvidenceItem) => void) => void;
  onRemove: () => void;
  onRemoveSpan: (spanIndex: number) => void;
  onShowSpan: (spanIndex: number) => void;
  onSelectFromSource: () => void;
}

interface ReadOnlyEvidenceCardProps extends EvidenceCardShared {
  mode: "read";
  onShowSpan: (spanIndex: number) => void;
}

export type EvidenceCardProps = EditableEvidenceCardProps | ReadOnlyEvidenceCardProps;

function spanLabel(blockNumbers: ReadonlyMap<string, number>, span: SourceSpan) {
  const number = blockNumbers.get(span.block_id);
  return number ? `b${number}` : "missing block";
}

/** "Source: bN": scrolls the document to the span. Shared by both modes. */
function SourceLink({
  span,
  label,
  blocksById,
  className,
  onClick,
}: {
  span: SourceSpan;
  label: string;
  blocksById: ReadonlyMap<string, SourceBlock>;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-1 rounded-full hover:underline ${className}`}
      title={spanExcerpt(blocksById.get(span.block_id)?.text, span, 200)}
    >
      <LinkIcon size={12} className="shrink-0" />
      <span className="truncate">{REVIEW.sourceLink(label)}</span>
    </button>
  );
}

/**
 * One evidence item in review: summary, kind, attribution and activity status, its span chips ("Source: bN" scrolls
 * the document, "×" removes one span), and an attention state with "Select from source" and "Remove" when it has none.
 */
function EditableEvidenceCard({
  experienceIndex,
  evidenceIndex,
  item,
  blocksById,
  blockNumbers,
  errors,
  selecting,
  onChange,
  onRemove,
  onRemoveSpan,
  onShowSpan,
  onSelectFromSource,
}: EditableEvidenceCardProps) {
  const missing = item.source_refs.length === 0;
  const tone = errors.length > 0 ? "border-red-border" : missing ? "border-amber-border bg-amber-wash" : "border-hairline bg-card";
  return (
    <li id={evidenceAnchorId(experienceIndex, evidenceIndex)} className={`scroll-mt-24 rounded-control border p-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <PillSelect label="Kind" value={item.kind} options={EVIDENCE_KINDS} onChange={(value) => onChange((next) => void (next.kind = value))} />
        <PillSelect
          label="Attribution"
          value={item.attribution}
          options={ATTRIBUTIONS}
          onChange={(value) => onChange((next) => void (next.attribution = value))}
        />
        <PillSelect
          label="Activity status"
          value={item.activity_status}
          options={ACTIVITY_STATUSES}
          onChange={(value) => onChange((next) => void (next.activity_status = value))}
        />
      </div>

      <div className="mt-2">
        <InlineField
          label="Evidence summary"
          value={item.summary}
          multiline
          invalid={errors.some((error) => error.path.endsWith(".summary"))}
          onCommit={(value) => onChange((next) => void (next.summary = value))}
        />
      </div>

      {missing ? (
        <div className="mt-2 rounded-control border border-amber-border bg-card p-2">
          <p className="flex items-start gap-2 text-body-sm text-amber-text">
            <WarningIcon size={14} className="mt-0.5 shrink-0" />
            {MISSING_SPAN.body}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant={selecting ? "primary" : "secondary"} className="min-h-8 px-3 py-1" onClick={onSelectFromSource} aria-pressed={selecting}>
              {MISSING_SPAN.select}
            </Button>
            <Button variant="ghost" className="min-h-8 px-3 py-1 text-red hover:bg-red-wash" onClick={onRemove}>
              {MISSING_SPAN.remove}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Source spans">
          {item.source_refs.map((span, spanIndex) => {
            const blockLabel = spanLabel(blockNumbers, span);
            return (
              <li
                key={`${span.block_id}:${span.start}:${span.end}:${spanIndex}`}
                className="inline-flex max-w-full items-center rounded-full border border-evidence-border bg-evidence-wash text-label-md text-evidence-text"
              >
                <SourceLink span={span} label={blockLabel} blocksById={blocksById} className="py-0.5 pl-2 pr-1" onClick={() => onShowSpan(spanIndex)} />
                <button
                  type="button"
                  onClick={() => onRemoveSpan(spanIndex)}
                  aria-label={`Remove span from ${blockLabel}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-card"
                >
                  <CloseIcon size={10} />
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={onSelectFromSource}
              aria-pressed={selecting}
              className={`rounded-full border px-2 py-0.5 text-label-md ${
                selecting ? "border-cobalt bg-cobalt text-on-cobalt" : "border-dashed border-hairline-strong text-ink-secondary hover:text-ink"
              }`}
            >
              + span
            </button>
          </li>
        </ul>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((error, index) => (
            <li key={`${error.path}:${error.code}:${index}`} className="text-body-sm text-red">
              {error.message}
            </li>
          ))}
        </ul>
      )}

      {!missing && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onRemove} className="text-body-sm text-ink-muted hover:text-red">
            Remove evidence
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The same item on an approved or indexed page: kind, attribution and activity status as static pills, the summary
 * as text, and "Source: bN" chips that only scroll the document. No editing control is rendered (design Decision 4).
 */
function ReadOnlyEvidenceCard({ experienceIndex, evidenceIndex, item, blocksById, blockNumbers, onShowSpan }: ReadOnlyEvidenceCardProps) {
  return (
    <li id={evidenceAnchorId(experienceIndex, evidenceIndex)} className="scroll-mt-24 rounded-control border border-hairline bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill>
          <span className="sr-only">Kind: </span>
          {item.kind}
        </Pill>
        <Pill>
          <span className="sr-only">Attribution: </span>
          {item.attribution}
        </Pill>
        <Pill>
          <span className="sr-only">Activity status: </span>
          {item.activity_status}
        </Pill>
      </div>

      <div className="mt-2">
        <StaticField label="Evidence summary" value={item.summary} multiline />
      </div>

      {item.source_refs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Source spans">
          {item.source_refs.map((span, spanIndex) => (
            <li
              key={`${span.block_id}:${span.start}:${span.end}:${spanIndex}`}
              className="inline-flex max-w-full items-center rounded-full border border-evidence-border bg-evidence-wash text-label-md text-evidence-text"
            >
              <SourceLink
                span={span}
                label={spanLabel(blockNumbers, span)}
                blocksById={blocksById}
                className="py-0.5 pl-2 pr-2"
                onClick={() => onShowSpan(spanIndex)}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function EvidenceCard(props: EvidenceCardProps) {
  return props.mode === "read" ? <ReadOnlyEvidenceCard {...props} /> : <EditableEvidenceCard {...props} />;
}
