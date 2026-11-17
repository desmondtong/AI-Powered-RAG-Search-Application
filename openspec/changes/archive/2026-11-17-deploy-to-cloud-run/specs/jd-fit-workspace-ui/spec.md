# Spec Delta

## MODIFIED Requirements

### Requirement: Inline experience upload
The Experience page SHALL accept DOCX and PDF files through an inline drop zone with a browse control. It SHALL NOT use a modal that closes on its own. A successful upload SHALL open the new file's page; a failed upload SHALL show the API's error in place and keep the user's context.

#### Scenario: Upload succeeds
- **WHEN** the user drops or selects a supported file and the upload returns a source
- **THEN** the application navigates to that source's file page, where processing begins

#### Scenario: Byte-identical file is uploaded again
- **WHEN** the upload resolves to an existing source
- **THEN** the application navigates to the existing source's file page and shows its current state rather than restarting it

#### Scenario: Upload is rejected
- **WHEN** the upload returns an error such as an unsupported format or exceeding the size limit
- **THEN** the drop zone shows that error message and remains available for another attempt

#### Scenario: File exceeds the upload limit before sending
- **WHEN** the user drops or selects a file larger than the server's upload limit
- **THEN** the drop zone shows a message naming the limit and asking for a smaller or split document, sends no upload request, and remains available for another attempt
