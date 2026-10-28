# Spec Delta

## Purpose

Provides a durable evidence index for project experience documents, separating broad parent context from focused searchable chunks so later JD-fit workflows can retrieve precise evidence and reason with surrounding context.

## ADDED Requirements

### Requirement: Parent evidence records
The system SHALL store project experience context as parent evidence records with stable identity, source file metadata, parent text, and structured metadata.

#### Scenario: Parent evidence record is created
- **WHEN** a project experience document is indexed as evidence
- **THEN** the system stores a parent record with a stable identifier, source document metadata, parent text, and metadata for later context expansion

### Requirement: Child evidence chunks
The system SHALL store child evidence chunks as searchable records that belong to exactly one parent evidence record.

#### Scenario: Child chunks reference their parent
- **WHEN** focused evidence chunks are stored for a parent record
- **THEN** each child chunk stores `parent_id`, `child_text`, `embedding_text`, an embedding vector, and metadata

### Requirement: Separate display text from embedding text
The system SHALL preserve the exact evidence text separately from the text used to generate embeddings.

#### Scenario: Searchable context differs from cited evidence
- **WHEN** a child chunk is indexed with contextual headers for retrieval
- **THEN** the system stores those headers in `embedding_text` while preserving the evidence shown to users in `child_text`

### Requirement: Vector search returns evidence chunks
The system SHALL support semantic search over child evidence chunks and return enough identifiers to fetch their parent context.

#### Scenario: Evidence chunk is retrieved
- **WHEN** a semantic query matches a child evidence chunk
- **THEN** the result includes the child chunk data and its parent identifier so downstream flows can expand context

### Requirement: Evidence lifecycle operations
The system SHALL keep parent records and child chunks consistent during listing and deletion operations.

#### Scenario: Evidence record is deleted
- **WHEN** a parent evidence record is deleted
- **THEN** the system also removes or invalidates its child chunks so stale vectors are not returned by evidence search

### Requirement: Existing generic RAG compatibility
The system SHALL preserve the existing generic document upload and search behavior during the evidence-index transition.

#### Scenario: Existing document search remains usable
- **WHEN** users upload and search normal documents through the current generic RAG flow
- **THEN** the system continues to support that flow without requiring structured project ingestion or JD-fit evaluation
