import type { StructuredExperienceExport } from "../experience/contracts";
import { identityKey, resolvePassageAnchor, revisionIdentityOfExport, sameRevision, type PassageAnchor, type RevisionIdentity } from "./anchors";
import { hashFixtureCorpusContent, type RagEvalFixture } from "./fixtureSchema";
import { synthesizeOfflineCorpusEntry } from "./offlineExport";
import type { CorpusIndex, CorpusRevision, FixtureCorpus } from "./types";

export interface FixtureCorpusInput {
  fixture: RagEvalFixture;
  file_name: string;
  active: StructuredExperienceExport;
  latest_unindexed: StructuredExperienceExport | null;
  /** Identities recorded in the corpus manifest; the exports must carry exactly these. */
  expected?: { active: RevisionIdentity; latest_unindexed: RevisionIdentity | null };
}

function resolveAll(exportDoc: StructuredExperienceExport, byRequirement: Record<string, string[]>, expected: RevisionIdentity) {
  return new Map<string, PassageAnchor[]>(
    Object.entries(byRequirement).map(([requirementId, passages]) => [
      requirementId,
      passages.map((passage) => resolvePassageAnchor(exportDoc, { passage }, expected)),
    ]),
  );
}

/** Resolves a fixture's ground truth against its active revision export. Anchors always carry the active identity. */
export function buildFixtureCorpus(input: FixtureCorpusInput): { corpus: FixtureCorpus; revisions: CorpusRevision[] } {
  const active = input.expected?.active ?? revisionIdentityOfExport(input.active);
  const latest = input.latest_unindexed ? (input.expected?.latest_unindexed ?? revisionIdentityOfExport(input.latest_unindexed)) : null;
  if (input.latest_unindexed && latest) {
    // Validates the latest export against its manifest identity too.
    resolvePassageAnchor(input.latest_unindexed, { passage: input.fixture.experience.paragraphs[0] }, latest);
  }
  if (latest && sameRevision(active, latest)) {
    throw new Error(`${input.fixture.fixture_id}: the latest unindexed revision must differ from the active revision.`);
  }
  const corpus: FixtureCorpus = {
    fixture: input.fixture,
    fixture_hash: hashFixtureCorpusContent(input.fixture),
    file_name: input.file_name,
    source_id: active.source_id,
    active,
    latest_unindexed: latest,
    expected: resolveAll(input.active, input.fixture.expected_evidence, active),
    distractors: resolveAll(input.active, input.fixture.distractors, active),
  };
  const revisions: CorpusRevision[] = [{ fixture_id: input.fixture.fixture_id, role: "active", export: input.active }];
  if (input.latest_unindexed) {
    revisions.push({ fixture_id: input.fixture.fixture_id, role: "latest-unindexed", export: input.latest_unindexed });
  }
  return { corpus, revisions };
}

export function buildCorpusIndex(inputs: FixtureCorpusInput[]): CorpusIndex {
  const fixtures: FixtureCorpus[] = [];
  const bySource = new Map<string, FixtureCorpus>();
  const revisions = new Map<string, CorpusRevision>();
  for (const input of inputs) {
    const built = buildFixtureCorpus(input);
    if (bySource.has(built.corpus.source_id)) {
      throw new Error(`Source ${built.corpus.source_id} is claimed by more than one fixture.`);
    }
    fixtures.push(built.corpus);
    bySource.set(built.corpus.source_id, built.corpus);
    for (const revision of built.revisions) {
      revisions.set(identityKey(revisionIdentityOfExport(revision.export)), revision);
    }
  }
  return { fixtures, bySource, revisions };
}

/** Offline corpus: synthesized exports, the same anchor resolution as live. */
export function buildOfflineCorpusIndex(fixtures: RagEvalFixture[]): CorpusIndex {
  return buildCorpusIndex(
    fixtures.map((fixture) => {
      const entry = synthesizeOfflineCorpusEntry(fixture);
      return { fixture, file_name: entry.file_name, active: entry.active, latest_unindexed: entry.latest_unindexed };
    }),
  );
}
