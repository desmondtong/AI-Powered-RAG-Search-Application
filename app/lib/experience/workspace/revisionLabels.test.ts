import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRevisions, draftLabel, nextVersionNumber, versionLabel } from "./revisionLabels";
import type { SourceDetail, SourceSummary } from "./types";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const R3 = "33333333-3333-4333-8333-333333333333";

function source(overrides: Partial<SourceSummary>): SourceSummary {
  return { id: "44444444-4444-4444-8444-444444444444", file_name: "experience-2026.docx", status: "draft", ...overrides };
}

describe("revision labels", () => {
  it("formats version and draft labels", () => {
    assert.equal(versionLabel(3), "Version 3");
    assert.equal(draftLabel(3), "Draft for version 4");
    assert.equal(draftLabel(null), "Draft for version 1");
    assert.equal(draftLabel(undefined), "Draft for version 1");
    assert.equal(nextVersionNumber(0), 1);
  });

  it("names searchable, latest approved and draft revisions from the API's numbers", () => {
    const detail: SourceDetail = {
      source: source({
        status: "draft",
        active_revision_id: R1,
        latest_approved_revision_id: R2,
        latest_draft_revision_id: R3,
        active_version_number: 1,
        latest_approved_version_number: 2,
      }),
      latest_extraction: null,
      latest_revision: { id: R3, status: "draft", draft_version: 1 },
      approved_versions: [
        { revision_id: R1, version_number: 1, approved_at: "2026-11-01T10:00:00+00:00" },
        { revision_id: R2, version_number: 2, approved_at: "2026-11-05T10:00:00+00:00" },
      ],
    };
    const labels = describeRevisions(detail.source, detail);
    assert.equal(labels.searchable?.label, "Version 1");
    assert.equal(labels.latestApproved?.label, "Version 2");
    assert.match(labels.latestApproved?.approvedAt ?? "", /2026/);
    assert.deepEqual(labels.draft, { label: "Draft for version 3", nextVersion: 3 });
    assert.doesNotMatch(JSON.stringify(labels), UUID);
  });

  it("handles a source with no approved revision", () => {
    const summary = source({ status: "draft", latest_draft_revision_id: R1 });
    const labels = describeRevisions(summary, {
      source: summary,
      latest_extraction: null,
      latest_revision: { id: R1, status: "draft", draft_version: 2 },
      approved_versions: [],
    });
    assert.equal(labels.searchable, null);
    assert.equal(labels.latestApproved, null);
    assert.equal(labels.draft?.label, "Draft for version 1");
    assert.doesNotMatch(JSON.stringify(labels), UUID);
  });

  it("uses summary numbers on the list, where there is no detail", () => {
    const labels = describeRevisions(
      source({ status: "indexed", active_revision_id: R1, latest_approved_revision_id: R1, active_version_number: 4, latest_approved_version_number: 4 }),
    );
    assert.equal(labels.searchable?.label, "Version 4");
    assert.equal(labels.draft, null);
    assert.equal(labels.searchable?.approvedAt, "");
  });

  it("does not treat the approved revision itself as an open draft", () => {
    const labels = describeRevisions(source({ status: "approved", latest_draft_revision_id: R1, latest_approved_revision_id: R1, latest_approved_version_number: 1 }));
    assert.equal(labels.draft, null);
  });
});
