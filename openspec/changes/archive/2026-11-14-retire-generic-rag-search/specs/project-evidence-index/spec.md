# Spec Delta

## REMOVED Requirements

### Requirement: Existing generic RAG compatibility
**Reason**: The generic document upload and search workflow is retired. The evidence index is now the application's only retrieval model, so there is no generic flow left to preserve during a transition.
**Migration**: No user action. Generic documents were never migrated into the evidence index, and the retired workflow is not replaced. Users who need a document searched must upload it as an experience file and complete the experience review and indexing workflow.
