# Spec Delta

## MODIFIED Requirements

### Requirement: Separate experience upload workflow
The system SHALL accept DOCX and selectable-text PDF experience files through the experience upload workflow, which is the application's only document intake. It SHALL NOT require user-authored JSON, perform OCR, or convert legacy binary DOC files in v1.

#### Scenario: Experience file is uploaded
- **WHEN** the user uploads a supported experience file
- **THEN** the system creates or resolves a source identity and begins an experience ingestion workflow

#### Scenario: Legacy DOC is uploaded
- **WHEN** the user uploads a legacy binary DOC file
- **THEN** the system reports the unsupported format without extracting, parsing, or publishing evidence

#### Scenario: Unsupported or unreadable file
- **WHEN** the file is unsupported, encrypted without usable text, image-only, empty, or still unusably garbled after available extraction attempts
- **THEN** the system reports that text extraction cannot proceed and does not invoke structured parsing or publish evidence

## REMOVED Requirements

### Requirement: Generic workflow compatibility
**Reason**: The generic upload, search, list, detail, file, and deletion workflow is retired, so there is no generic behavior left to preserve beside the experience controls. The requirement's second concern, that the experience list reflects lifecycle status and available actions, is already covered by "Observable resumable lifecycle".
**Migration**: No data migration. Generic documents are not converted into experience sources. The experience list and detail views continue to show source status and available actions through the existing experience routes; the generic section they used to sit beside is removed.
