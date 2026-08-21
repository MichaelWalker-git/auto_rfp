import { describe, it, expect } from 'vitest';
import {
  EmployeeImportRunItemSchema,
  EmployeeImportRunStatusSchema,
  ImportFailedDocumentSchema,
  EmployeeExtractionSnapshotItemSchema,
} from './employee-import';
import { ExtractionTargetTypeSchema, DraftTypeSchema } from './extraction-job';

describe('EmployeeImportRunItemSchema', () => {
  const validRun = {
    importRunId: 'run-1',
    orgId: 'org-123',
    triggeredBy: 'user-789',
    startedAt: '2026-08-19T10:00:00.000Z',
  };

  it('parses a fresh run and applies defaults (status RUNNING, zero counts, empty failures)', () => {
    const { success, data } = EmployeeImportRunItemSchema.safeParse(validRun);
    expect(success).toBe(true);
    expect(data?.status).toBe('RUNNING');
    expect(data?.documentsScanned).toBe(0);
    expect(data?.cvsDetected).toBe(0);
    expect(data?.employeesCreated).toBe(0);
    expect(data?.employeesUpdated).toBe(0);
    // Certificate-mapping counters default to 0 so pre-existing run records parse.
    expect(data?.certificationDocsDetected).toBe(0);
    expect(data?.certificationsMapped).toBe(0);
    expect(data?.failedDocuments).toEqual([]);
  });

  it('accepts every run status and rejects unknown ones', () => {
    for (const status of ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED']) {
      expect(EmployeeImportRunStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(EmployeeImportRunStatusSchema.safeParse('CANCELLED').success).toBe(false);
  });

  it('rejects a run missing triggeredBy or with negative counters', () => {
    const { importRunId, orgId, startedAt } = validRun;
    expect(
      EmployeeImportRunItemSchema.safeParse({ importRunId, orgId, startedAt }).success,
    ).toBe(false);
    expect(
      EmployeeImportRunItemSchema.safeParse({ ...validRun, documentsScanned: -1 }).success,
    ).toBe(false);
  });
});

describe('ImportFailedDocumentSchema', () => {
  it('accepts all five failure reasons and rejects unknown reasons', () => {
    for (const reason of [
      'UNREADABLE',
      'INCOMPLETE_EXTRACTION',
      'EXTRACTION_FAILED',
      'AMBIGUOUS_NAME',
      'UNMATCHED_PERSON',
    ]) {
      const { success } = ImportFailedDocumentSchema.safeParse({
        documentName: 'cv.pdf',
        reason,
      });
      expect(success).toBe(true);
    }
    expect(
      ImportFailedDocumentSchema.safeParse({ documentName: 'cv.pdf', reason: 'TIMEOUT' }).success,
    ).toBe(false);
  });

  it('enforces the 500-char documentName bound and rejects empty names', () => {
    expect(
      ImportFailedDocumentSchema.safeParse({
        documentName: 'x'.repeat(500),
        reason: 'UNREADABLE',
      }).success,
    ).toBe(true);
    expect(
      ImportFailedDocumentSchema.safeParse({
        documentName: 'x'.repeat(501),
        reason: 'UNREADABLE',
      }).success,
    ).toBe(false);
    expect(
      ImportFailedDocumentSchema.safeParse({ documentName: '  ', reason: 'UNREADABLE' }).success,
    ).toBe(false);
  });
});

describe('EmployeeExtractionSnapshotItemSchema', () => {
  it('parses a snapshot with partial fields and rejects an invalid location', () => {
    const { success, data } = EmployeeExtractionSnapshotItemSchema.safeParse({
      employeeId: 'emp-1',
      orgId: 'org-123',
      fields: {
        name: 'Jane Smith',
        primaryRoles: ['Project Manager'],
        resumeRef: 'doc-42',
        location: 'ONSHORE',
      },
    });
    expect(success).toBe(true);
    expect(data?.fields.secondaryRoles).toBeUndefined();

    expect(
      EmployeeExtractionSnapshotItemSchema.safeParse({
        employeeId: 'emp-1',
        orgId: 'org-123',
        fields: { location: 'REMOTE' },
      }).success,
    ).toBe(false);
  });
});

describe('extraction target-type enum (U2 extension)', () => {
  it('accepts EMPLOYEE as an extraction target but never as a draft type', () => {
    expect(ExtractionTargetTypeSchema.safeParse('EMPLOYEE').success).toBe(true);
    expect(DraftTypeSchema.safeParse('EMPLOYEE').success).toBe(false);
    // Draft-based targets are untouched.
    for (const target of ['PAST_PERFORMANCE', 'LABOR_RATE', 'BOM_ITEM']) {
      expect(ExtractionTargetTypeSchema.safeParse(target).success).toBe(true);
      expect(DraftTypeSchema.safeParse(target).success).toBe(true);
    }
  });
});
