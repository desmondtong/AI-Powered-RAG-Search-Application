"use client";

import { useState } from "react";
import { REVIEW } from "@/app/lib/experience/workspace/copy";
import { evidenceErrors, experienceErrors, firstBlockNumber } from "@/app/lib/experience/workspace/review";
import type {
  CanonicalRevision,
  DraftFieldError,
  EvidenceItem,
  ExperienceEntry,
  SourceBackedString,
  SourceBlock,
} from "@/app/lib/experience/workspace/types";
import { Pill } from "../../_components/ui";
import EvidenceCard from "./EvidenceCard";
import InlineField from "./InlineField";
import StaticField from "./StaticField";

export function experienceAnchorId(experienceIndex: number) {
  return `experience-${experienceIndex}`;
}

export interface RailHandlers {
  updateExperience: (experienceIndex: number, updater: (experience: ExperienceEntry) => void) => void;
  updateEvidence: (experienceIndex: number, evidenceIndex: number, updater: (item: EvidenceItem) => void) => void;
  removeEvidence: (experienceIndex: number, evidenceIndex: number) => void;
  removeEvidenceSpan: (experienceIndex: number, evidenceIndex: number, spanIndex: number) => void;
  showSpan: (experienceIndex: number, evidenceIndex: number, spanIndex: number) => void;
  selectFromSource: (experienceIndex: number, evidenceIndex: number) => void;
}

type EvidenceRef = { experienceIndex: number; evidenceIndex: number };

/** The rail either edits a draft or shows an approved revision read-only (design Decision 4). */
export type RailMode =
  | { mode: "edit"; fieldErrors: readonly DraftFieldError[]; selecting: EvidenceRef | null; handlers: RailHandlers }
  | { mode: "read"; onShowSpan: (experienceIndex: number, evidenceIndex: number, spanIndex: number) => void };

interface CardShared {
  experience: ExperienceEntry;
  experienceIndex: number;
  blocksById: ReadonlyMap<string, SourceBlock>;
  blockNumbers: ReadonlyMap<string, number>;
}

function setString(field: SourceBackedString, value: string) {
  field.value = value.trim() ? value : null;
}

function cardTitle(experience: ExperienceEntry) {
  return experience.title.value?.trim() || (experience.type === "general-experience" ? "General experience" : "Untitled project");
}

function captionFor(refs: SourceBackedString["source_refs"], blockNumbers: ReadonlyMap<string, number>) {
  const number = firstBlockNumber(refs, blockNumbers);
  return number ? REVIEW.fromSource(number) : null;
}

function CardHeader({
  experience,
  open,
  onToggle,
  badges,
}: {
  experience: ExperienceEntry;
  open: boolean;
  onToggle: () => void;
  badges?: React.ReactNode;
}) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-start justify-between gap-3 p-4 text-left">
      <span className="min-w-0">
        <span className="block break-words font-heading text-title-sm text-ink">{cardTitle(experience)}</span>
        <span className="text-body-sm text-ink-muted">
          {experience.type === "project" ? "Project" : "General experience"} · {experience.evidence_items.length} evidence
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badges}
        <span aria-hidden className={`text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </span>
    </button>
  );
}

function EditableExperienceCard({
  experience,
  experienceIndex,
  blocksById,
  blockNumbers,
  fieldErrors,
  selecting,
  handlers,
}: CardShared & Extract<RailMode, { mode: "edit" }>) {
  const [open, setOpen] = useState(true);
  const ownErrors = experienceErrors(fieldErrors, experienceIndex);
  const missing = experience.evidence_items.filter((item) => item.source_refs.length === 0).length;
  const caption = (refs: SourceBackedString["source_refs"]) => captionFor(refs, blockNumbers);
  const invalid = (field: string) => ownErrors.some((error) => error.path.startsWith(`experiences.${experienceIndex}.${field}`));
  const update = (updater: (experience: ExperienceEntry) => void) => handlers.updateExperience(experienceIndex, updater);

  return (
    <li id={experienceAnchorId(experienceIndex)} className="scroll-mt-24 rounded-panel border border-hairline bg-card">
      <CardHeader
        experience={experience}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        badges={
          <>
            {missing > 0 && <Pill tone="amber">{missing} need a span</Pill>}
            {ownErrors.length > 0 && <Pill tone="red">{ownErrors.length} error{ownErrors.length === 1 ? "" : "s"}</Pill>}
          </>
        }
      />

      {open && (
        <div className="space-y-3 border-t border-hairline p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <InlineField
              label="Title"
              value={experience.title.value ?? ""}
              caption={caption(experience.title.source_refs)}
              invalid={invalid("title")}
              onCommit={(value) => update((next) => setString(next.title, value))}
            />
            <InlineField
              label="Organization"
              value={experience.organization.value ?? ""}
              caption={caption(experience.organization.source_refs)}
              invalid={invalid("organization")}
              onCommit={(value) => update((next) => setString(next.organization, value))}
            />
            <InlineField
              label="Role"
              value={experience.role.value ?? ""}
              caption={caption(experience.role.source_refs)}
              invalid={invalid("role")}
              onCommit={(value) => update((next) => setString(next.role, value))}
            />
            <div className="grid grid-cols-2 gap-2">
              <InlineField
                label="Period start"
                value={experience.period.start.value ?? ""}
                caption={caption(experience.period.start.source_refs)}
                invalid={invalid("period.start")}
                onCommit={(value) => update((next) => setString(next.period.start, value))}
              />
              <InlineField
                label="Period end"
                value={experience.period.end.value ?? ""}
                caption={caption(experience.period.end.source_refs)}
                invalid={invalid("period.end")}
                onCommit={(value) => update((next) => setString(next.period.end, value))}
              />
            </div>
          </div>
          <InlineField
            label="Technologies"
            value={experience.technologies.value.join(", ")}
            placeholder="None listed"
            caption={caption(experience.technologies.source_refs)}
            invalid={invalid("technologies")}
            onCommit={(value) =>
              update((next) => {
                next.technologies.value = value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean);
              })
            }
          />

          {ownErrors.length > 0 && (
            <ul className="space-y-1">
              {ownErrors.map((error, index) => (
                <li key={`${error.path}:${error.code}:${index}`} className="text-body-sm text-red">
                  {error.message}
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="text-label-caps uppercase text-ink-muted">Evidence</h3>
            {experience.evidence_items.length === 0 ? (
              <p className="mt-1 text-body-sm text-ink-muted">No evidence items.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {experience.evidence_items.map((item, evidenceIndex) => (
                  <EvidenceCard
                    key={item.logical_id ?? `${experienceIndex}-${evidenceIndex}`}
                    mode="edit"
                    experienceIndex={experienceIndex}
                    evidenceIndex={evidenceIndex}
                    item={item}
                    blocksById={blocksById}
                    blockNumbers={blockNumbers}
                    errors={evidenceErrors(fieldErrors, experienceIndex, evidenceIndex)}
                    selecting={selecting?.experienceIndex === experienceIndex && selecting.evidenceIndex === evidenceIndex}
                    onChange={(updater) => handlers.updateEvidence(experienceIndex, evidenceIndex, updater)}
                    onRemove={() => handlers.removeEvidence(experienceIndex, evidenceIndex)}
                    onRemoveSpan={(spanIndex) => handlers.removeEvidenceSpan(experienceIndex, evidenceIndex, spanIndex)}
                    onShowSpan={(spanIndex) => handlers.showSpan(experienceIndex, evidenceIndex, spanIndex)}
                    onSelectFromSource={() => handlers.selectFromSource(experienceIndex, evidenceIndex)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** The same card for an approved revision: every field as text, every evidence item read-only. */
function ReadOnlyExperienceCard({ experience, experienceIndex, blocksById, blockNumbers, onShowSpan }: CardShared & Extract<RailMode, { mode: "read" }>) {
  const [open, setOpen] = useState(true);
  const caption = (refs: SourceBackedString["source_refs"]) => captionFor(refs, blockNumbers);

  return (
    <li id={experienceAnchorId(experienceIndex)} className="scroll-mt-24 rounded-panel border border-hairline bg-card">
      <CardHeader experience={experience} open={open} onToggle={() => setOpen((value) => !value)} />

      {open && (
        <div className="space-y-3 border-t border-hairline p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <StaticField label="Title" value={experience.title.value ?? ""} caption={caption(experience.title.source_refs)} />
            <StaticField label="Organization" value={experience.organization.value ?? ""} caption={caption(experience.organization.source_refs)} />
            <StaticField label="Role" value={experience.role.value ?? ""} caption={caption(experience.role.source_refs)} />
            <div className="grid grid-cols-2 gap-2">
              <StaticField label="Period start" value={experience.period.start.value ?? ""} caption={caption(experience.period.start.source_refs)} />
              <StaticField label="Period end" value={experience.period.end.value ?? ""} caption={caption(experience.period.end.source_refs)} />
            </div>
          </div>
          <StaticField
            label="Technologies"
            value={experience.technologies.value.join(", ")}
            placeholder="None listed"
            caption={caption(experience.technologies.source_refs)}
          />

          <div>
            <h3 className="text-label-caps uppercase text-ink-muted">Evidence</h3>
            {experience.evidence_items.length === 0 ? (
              <p className="mt-1 text-body-sm text-ink-muted">No evidence items.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {experience.evidence_items.map((item, evidenceIndex) => (
                  <EvidenceCard
                    key={item.logical_id ?? `${experienceIndex}-${evidenceIndex}`}
                    mode="read"
                    experienceIndex={experienceIndex}
                    evidenceIndex={evidenceIndex}
                    item={item}
                    blocksById={blocksById}
                    blockNumbers={blockNumbers}
                    onShowSpan={(spanIndex) => onShowSpan(experienceIndex, evidenceIndex, spanIndex)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** The structured experiences beside the document, one collapsible card each, editable or read-only. */
export default function ExperienceRail({
  draft,
  blocks,
  blockNumbers,
  ...mode
}: {
  draft: CanonicalRevision;
  blocks: readonly SourceBlock[];
  blockNumbers: ReadonlyMap<string, number>;
} & RailMode) {
  const blocksById = new Map(blocks.map((block) => [block.block_id, block]));
  return (
    <section aria-labelledby="experience-rail-title" className="min-w-0">
      <h2 id="experience-rail-title" className="mb-2 font-heading text-title-sm text-ink">
        {REVIEW.railTitle} · {draft.experiences.length}
      </h2>
      {draft.experiences.length === 0 ? (
        <p className="rounded-panel border border-hairline bg-card p-4 text-body-md text-ink-secondary">
          {mode.mode === "read" ? "This version has no experiences." : "No experiences were found in this draft."}
        </p>
      ) : (
        <ul className="space-y-3">
          {draft.experiences.map((experience, experienceIndex) =>
            mode.mode === "read" ? (
              <ReadOnlyExperienceCard
                key={experience.logical_id ?? experienceIndex}
                experience={experience}
                experienceIndex={experienceIndex}
                blocksById={blocksById}
                blockNumbers={blockNumbers}
                {...mode}
              />
            ) : (
              <EditableExperienceCard
                key={experience.logical_id ?? experienceIndex}
                experience={experience}
                experienceIndex={experienceIndex}
                blocksById={blocksById}
                blockNumbers={blockNumbers}
                {...mode}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
