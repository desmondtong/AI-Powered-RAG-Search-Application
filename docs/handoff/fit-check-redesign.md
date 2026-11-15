
# Handoff: Fit Check UI/UX redesign

Written 2026-11-14 for the next Claude Code session, which has the Stitch MCP. This file is temporary. Delete it once the redesign change has been proposed.

## 1. Context

**Product direction.** JD-fit is the only product. The redesign covers the whole JD-fit journey: upload experience → review → approve → index → evaluate a job description. It must leave business logic unchanged: the API routes, the ingestion state machine, the validation, and the JD-fit pipeline all stay as they are. Generic document search is not part of the product, so don't design screens for it.

**The problem the redesign solves.** After a user uploads an experience file, they can't tell what stage it is in or what to do next. The UI shows the data model instead of the user's journey. The header shows revision UUIDs. The toolbar has up to eight conditional buttons. Spans are edited by typing block IDs and offsets, and actions appear as `actions.join(", ")`. The upload modal closes on its own. Meanwhile the API already returns `next_action` and `actions[]` for every experience, and the UI ignores them.

**Relevant current files:**
- `app/page.tsx` and `app/components/JdFitPanel.tsx`: the JD-fit entry point.
- `app/documents/page.tsx`: the experience list and upload.
- `app/components/UploadModal.tsx`.
- `app/experiences/[id]/ExperienceReviewClient.tsx`: the review screen.
- `app/components/Navigation.tsx`.
- `app/layout.tsx`: its metadata title is still "Create Next App".
- `app/lib/experience/apiService.ts`: `availableExperienceActions`.

## 2. The mockup

- **Source of truth:** the Design artifact "Fit Check Redesign" at https://claude.ai/artifact/FXc789i7S14JQH2yEW2tAN. It is private to the user. Read it with the Artifact tool (`action: "read"`), not WebFetch. It has four boards: `Main.dc.html`, `Experience.dc.html`, `Review.dc.html`, and `Stages.dc.html`.
- There is a local copy in the previous session's scratchpad under `/private/tmp/claude-502/.../scratchpad/fitcheck-mockup/project/`. It is temporary and may already be gone, so use the artifact.

### What the boards show

1. **Fit Check home (`/`).** At the top, a JD textarea with an "Evaluate fit" button. Below it, the fit report: four stat tiles (Strong / Partial / Weak / Missing), then requirement cards grouped by fit label. Each card has a rationale and a citation (quote, file, project, and kind) with an "Open in source" link into Review. After the cards come a "Gaps to address" panel and a collapsed Diagnostics section. The header pill reads "N files indexed and searchable".
2. **Experience list (`/experience`).** A drop zone, then one row per file. Each row has a 6-stage dot stepper, a plain-language stage label, a one-line helper, exactly one primary button (taken from `next_action`), and an overflow menu. A legend explaining the six stages sits at the bottom.
3. **Review stage (`/experience/[id]`).** A stepper with the line "Step 4 of 6 · Review" and one sentence of guidance. The page has two panes.
   - **Left:** the structured experiences. Each field shows "from source, block N". Evidence items show kind, attribution, and status as pills. Items with no span are flagged.
   - **Right:** the source text, with used spans highlighted and unassigned blocks tinted. Selecting text opens a popover: "Use as source for → item → Add span". It must produce the same `{block_id, start, end}` the API takes today.

   At the bottom, a "Before you can approve" gate merges the acknowledgements and validation errors into one checklist. The Approve button reads "Approve · N items left".
4. **Pipeline states.** The same header shown at every stage: processing (extract and parse run as one chain), extract failed (Retry, or upload a different file), parsed (Start review), approved ("Index now" as an explicit click), indexed ("Try a job description" or "Edit", which starts a new draft), the 409 `index-candidate-stale` conflict (refreshed state, then "Index version N" or "Look at version N first"), and the empty Fit Check state, which points the user to "Upload experience file".

### Visual language (no design system exists yet)

- **Fonts:** Inter for body text, Space Grotesk for headings.
- **Base colors:** ground #F6F5F2, surface #FFFFFF, border #E3E1DB, ink #1C1C1A, muted #5F5E5A, accent #2F4DAA (tint #E9EDF9).
- **Fit labels (text / background):**
  - strong: #1B6B3A / #E3F3E8
  - partial: #8A4B0B / #FBEBD3
  - weak: #4B5563 / #E9EBEF
  - missing: #9F1D1D / #FBE3E3
- **Review highlights:** unassigned block #FFF4D6 / #7A4D00; span highlight #DCE6FB.
- "Fit Check" is a working product name and hasn't been confirmed.

## 3. What to do with Stitch (before approval)

Use Stitch to iterate on, or offer alternatives to, the four boards above. Don't start from scratch. Keep the journey, the information architecture, and the invariants below fixed. Visual style and layout density are open. The Review screen is the board most likely to change, so spend the most effort there.

Before changing a board, list Stitch's tools and confirm what it can produce (screens, code, or images). When a Stitch result is approved, record the decisions in the Design artifact or in the redesign change's `design.md`. Don't leave them only in Stitch.

### Invariants: the UI must not change these

- The status machine: `uploaded → extracting → extracted → parsing → draft → approved → indexing → indexed`, plus `failed`, `deleted`, and `cleanup-pending`. Allowed actions come from `availableExperienceActions(status)` in `app/lib/experience/apiService.ts`.
- **Index is always an explicit user click.** It never auto-runs after approval.
- **HTTP 409 `index-candidate-stale`:** refresh the state, then require an explicit re-index. Never retry automatically.
- **Corrections must stay grounded in the source.** Every evidence item needs a real `{block_id, start, end}` span. Click-to-span is an input method, not a new data shape.
- Approval still requires the existing acknowledgements and validation to pass. The gate only presents them differently.
- **JD-fit:** a single `POST /api/jd-fit {jdText}`. Fit labels are categorical (strong / partial / weak / missing) with no numeric score. Every citation must resolve to a retained source span.
- **Allowed client-only change:** the client may chain extract → parse on its own, using the same two API calls. A failure must still be reported per stage.

### Questions for the user's mockup review

- Is "Fit Check" the product name? It affects the title, the nav, and the `app/layout.tsx` metadata.
- Should routes be renamed from `/documents` and `/experiences/[id]` to `/experience` and `/experience/[id]`, and should the old paths redirect?
- Review layout: is the two-pane, click-to-span layout approved, or should the current form-based editing stay as a fallback?

## 4. After the mockup is approved

### Step 1: Propose the change (`openspec-propose redesign-jd-fit-workspace`)

Write it from the approved mockup. Expected scope:

- **Information architecture:** two destinations, Fit Check `/` and Experience `/experience`, plus a pipeline page at `/experience/[id]`. Includes any route renames and redirects, nav, and app metadata.
- **Stage presentation:** a 6-step stepper driven by `source.status`. Exactly one primary action, taken from `next_action`, with secondary actions in an overflow menu. Revision UUIDs disappear from the main view.
- **Upload:** the drop zone stays inline, so no modal closes on its own. After upload, the file appears as a row that is already processing.
- **Processing:** the client chains extract → parse, and each stage reports its own failure state.
- **Review:** the two-pane source view, click-to-span selection that produces the existing span triple, and the merged pre-approval gate.
- **Index and conflict:** an explicit "Index now", plus the 409 refresh-and-confirm flow.
- **Fit report:** the stat tiles, cards grouped by fit, citations that link to the source span, the gaps panel, collapsed diagnostics, and the empty state.
- **Visual tokens:** see section 2, or whatever Stitch iteration gets approved.

Spec impact (read each spec in full with `openspec show <id> --type spec` before deciding):

- `structured-project-ingestion`: "Separate experience upload workflow", "Human review before approval", "Observable resumable lifecycle", and "Actionable outdated indexing conflicts" are the likely MODIFIED candidates.
- `jd-fit-evaluation`: the JD-fit workflow requirement, "Citation-grounded report", and "Evidence gaps are visible".
- A new UI capability (for example `experience-workspace-ui`) may be cleaner than spreading presentation rules across the backend capabilities. Decide this in the proposal.
- Delta rules: a MODIFIED requirement must keep every existing scenario. To drop a scenario, REMOVE the requirement and ADD it again under a new name.

### Step 2: Apply and archive

Use `openspec-apply-change`, then `openspec-archive-change`. A browser walkthrough of the whole journey (upload → review → approve → index → fit check) is required in addition to tests, lint, typecheck, and build; see `openspec/config.yaml` → `operations.apply.guidance`. Record the dev server command, the URL, the steps you took, what you saw, and any limitations.

## 5. Standing constraints

- Supabase is remote only (project `lwljmmfcvmbnrfstltzj`), with no local database. The service-role key is server-only.
- OpenSpec 2.0 workflow skills live in `.claude/skills`. Explore mode never implements code.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
