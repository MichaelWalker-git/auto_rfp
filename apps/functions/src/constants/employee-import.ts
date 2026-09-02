/** Partition key for EmployeeImportRun records (team-definition U2). */
export const EMPLOYEE_IMPORT_RUN_PK = 'EMPLOYEE_IMPORT_RUN';

/** Partition key for EmployeeExtractionSnapshot records (team-definition U2, BR3.3). */
export const EMPLOYEE_EXTRACTION_SNAPSHOT_PK = 'EMPLOYEE_EXTRACTION_SNAPSHOT';

/**
 * BR2.1/BR4.2 — after this many consecutive EXTRACTION_FAILED documents the
 * AI service is treated as down and the run ends FAILED (imports preserved).
 */
export const IMPORT_CONSECUTIVE_FAILURE_LIMIT = 5;

/** BR4.1 — failure-report document names are truncated to this bound. */
export const IMPORT_DOCUMENT_NAME_MAX_LENGTH = 500;
