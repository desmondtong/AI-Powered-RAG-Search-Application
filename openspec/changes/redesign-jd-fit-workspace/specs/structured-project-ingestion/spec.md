# Spec Delta

## ADDED Requirements

### Requirement: Approved version numbers
The system SHALL give each approved revision a per-source version number in approval order, starting at 1 and never reassigned. Drafts and revisions that were never approved SHALL have no number. Source summaries and source detail SHALL expose these numbers read-only. Revision identity for every action SHALL remain the revision ID.

#### Scenario: First approval
- **WHEN** a source's first draft is approved
- **THEN** that revision is version 1, and the source summary reports `latest_approved_version_number: 1` and, once it is indexed, `active_version_number: 1`

#### Scenario: Edited and approved again
- **WHEN** the user creates a draft from version 1, edits it, and approves it while version 1 is still the active indexed revision
- **THEN** the new revision is version 2, `latest_approved_version_number` is 2, and `active_version_number` stays 1 until version 2 is published

#### Scenario: Abandoned or failed drafts
- **WHEN** a draft is replaced by a re-parse or never approved
- **THEN** it has no version number and the next approved revision still receives the next number after the highest existing one

#### Scenario: Older approvals are beyond the recent revision list
- **WHEN** the source has more revisions than the detail response's recent revision list holds
- **THEN** the detail response still lists every approved revision with its `revision_id`, `version_number`, and `approved_at`

#### Scenario: Numbers are stable across reads
- **WHEN** the same source is read again later
- **THEN** each approved revision reports the same version number as before

#### Scenario: Number is supplied as an action input
- **WHEN** a client attempts to approve or index by version number instead of revision ID
- **THEN** the existing endpoints continue to require the revision ID and the version number is not accepted as an identifier
