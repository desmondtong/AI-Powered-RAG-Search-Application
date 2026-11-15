import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const REVIEW_COMPONENTS = [
  "app/experience/[id]/_components/DocumentPane.tsx",
  "app/experience/[id]/_components/SpanPopover.tsx",
  "app/experience/[id]/_components/ExperienceRail.tsx",
  "app/experience/[id]/_components/EvidenceCard.tsx",
  "app/experience/[id]/_components/InlineField.tsx",
  "app/experience/[id]/_components/ApprovalGate.tsx",
];

const EDITOR = "app/experience/[id]/_hooks/useDraftEditor.ts";
const PAGE = "app/experience/[id]/FilePageClient.tsx";

function escape(token: string) {
  return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("experience review UI contracts", () => {
  it("loads source-linked drafts and saves review edits through the draft endpoint", () => {
    const page = read(PAGE);
    const editor = read(EDITOR);

    assert.match(page, /fetch\(`\/api\/experiences\/\$\{sourceId\}`/);
    assert.match(editor, /fetch\(`\/api\/experiences\/\$\{sourceId\}\/draft`/);
    assert.match(editor, /method: "PATCH"/);
    assert.match(editor, /expected_draft_version: current\.revision\.draft_version/);
    assert.match(editor, /canonical_revision/);
    assert.match(editor, /draft: current/);
  });

  it("keeps acknowledgements, field errors and the no-usable-evidence guard", () => {
    const editor = read(EDITOR);
    for (const token of [
      "review_acknowledgements.warnings",
      "review_acknowledgements.unassigned_blocks",
      "field_errors",
      "readFieldErrors",
      "no-usable-evidence",
      "addEvidenceSpan",
      "removeEvidence",
      "removeEvidenceSpan",
    ]) {
      assert.match(editor, escape(token));
    }
    assert.match(read("app/lib/experience/workspace/types.ts"), /field_errors/);
    const rail = read("app/experience/[id]/_components/ExperienceRail.tsx") + read("app/experience/[id]/_components/EvidenceCard.tsx");
    for (const token of ["title", "organization", "role", "technologies", "EVIDENCE_KINDS", "ATTRIBUTIONS", "ACTIVITY_STATUSES", "MISSING_SPAN.select", "MISSING_SPAN.remove"]) {
      assert.match(rail, escape(token));
    }
  });

  it("has no manual offset or block-ID entry in the review components", () => {
    for (const file of REVIEW_COMPONENTS) {
      const source = read(file);
      assert.doesNotMatch(source, /type="number"/, `${file} must not offer numeric offset inputs`);
      if (source.includes("<select")) {
        assert.doesNotMatch(source, /block_id/, `${file} must not offer a block-ID select`);
      }
    }
  });

  it("maps a selection to a span through rangeToSpan and the one-block rule", () => {
    const page = read(PAGE);
    assert.match(page, /rangeToSpan\(container, range,/);
    assert.match(page, /result\.reason === "cross-block"/);
    assert.match(read("app/experience/[id]/_components/DocumentPane.tsx"), /data-block-text/);
    assert.match(read("app/experience/[id]/_components/DocumentPane.tsx"), /whitespace-pre-wrap/);
  });

  it("approves with the draft version the save returned and sends no approval when the save fails", () => {
    const editor = read(EDITOR);
    assert.match(editor, /fetch\(`\/api\/experiences\/\$\{sourceId\}\/approve`/);
    assert.match(editor, /body: JSON\.stringify\(\{ revision_id: revisionId, expected_draft_version: expectedDraftVersion \}\)/);

    const approve = editor.slice(editor.indexOf("const approve = useCallback"));
    const save = approve.indexOf("await saveRequest(draft)");
    const stop = approve.indexOf("if (savedDraftVersion === null) return false;");
    const adopt = approve.indexOf("expectedDraftVersion = savedDraftVersion;");
    const request = approve.indexOf("await approveRequest(draft.revision.revision_id, expectedDraftVersion)");
    assert.ok(save > -1 && save < stop && stop < adopt && adopt < request, "save → stop on failure → approve with the returned version");
    assert.doesNotMatch(editor, /\/index/);
  });

  it("renders the gate's three button states from buildApprovalGate", () => {
    const gate = read("app/experience/[id]/_components/ApprovalGate.tsx");
    assert.match(gate, /gate\.button\.label/);
    assert.match(gate, /gate\.button\.state === "locked"/);
    assert.match(read(PAGE), /buildApprovalGate\(draft, detail, editor\.fieldErrors, editor\.dirty\)/);
    const copy = read("app/lib/experience/workspace/copy.ts");
    for (const token of ["Approve · ", "Save & approve", "Before you can approve"]) {
      assert.match(copy, escape(token));
    }
  });

  it("makes evidence and span removals undoable locally, through update and with no request", () => {
    const editor = read(EDITOR);
    assert.match(editor, /export interface UndoToken \{\s*restore: \(\) => void;\s*\}/);
    for (const name of ["removeEvidence", "removeEvidenceSpan"]) {
      const start = editor.indexOf(`const ${name} = useCallback(`);
      assert.notEqual(start, -1, name);
      const body = editor.slice(start, editor.indexOf("\n  );", start));
      assert.match(body, /: UndoToken \| null =>/, `${name} returns an undo token`);
      assert.match(body, /undoable</, `${name} captures what it removes`);
      assert.doesNotMatch(body, /fetch\(/, `${name} sends no request`);
    }
    const undoable = editor.slice(editor.indexOf("const undoable = useCallback("), editor.indexOf("const removeEvidence = useCallback("));
    assert.match(undoable, /update\(\(next\) => reinsert\(/, "restore goes through update, which marks the draft dirty");
    assert.match(undoable, /revision\.revision_id !== revisionId\) return;/, "a different draft revision discards the undo");
    assert.doesNotMatch(undoable, /fetch\(/);

    const page = read(PAGE);
    assert.match(page, /offerUndo\(NOTICES\.evidenceRemoved, editor\.removeEvidence\(/);
    assert.match(page, /offerUndo\(NOTICES\.spanRemoved, editor\.removeEvidenceSpan\(/);
    assert.match(page, /action: \{ label: NOTICES\.undo, onClick: token\.restore \}/);
  });

  it("reports save, approval and indexing outcomes only after the request succeeded", () => {
    const editor = read(EDITOR);
    assert.match(editor, /if \(version !== null\) \{\s*await refresh\(\);\s*notice\.success\(NOTICES\.draftSaved\);/);
    assert.match(editor, /if \(approved\) notice\.success\(NOTICES\.approved\(/);
    const indexer = read("app/experience/[id]/_hooks/useIndexSequence.ts");
    assert.match(indexer, /if \(stopReason === "indexed"\) \{\s*notice\.success\(NOTICES\.searchable\(/);
  });
});
