import { z } from 'zod';

import { queryAllBySkPrefix, queryBySkPrefix } from '@/helpers/db';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { requireEnv } from '@/helpers/env';
import {
  createEmployee,
  listEmployeesByOrg,
  updateEmployee,
} from '@/helpers/employee';
import {
  completeImportRun,
  getExtractionSnapshot,
  putExtractionSnapshot,
  updateImportRunProgress,
} from '@/helpers/employee-import';
import {
  IMPORT_CONSECUTIVE_FAILURE_LIMIT,
  IMPORT_DOCUMENT_NAME_MAX_LENGTH,
} from '@/constants/employee-import';
import { KNOWLEDGE_BASE_PK } from '@/constants/organization';
import { DOCUMENT_PK } from '@/constants/document';
import { SK_NAME } from '@/constants/common';

import {
  EmployeeCreateRequestSchema,
  EmployeeLocationSchema,
  type DocumentItem,
  type EmployeeExtractionFields,
  type EmployeeImportRunItem,
  type EmployeeItem,
  type EmployeeUpdateRequest,
  type ImportFailedDocument,
} from '@auto-rfp/core';

// Same cost-effective model the other extraction flows use.
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0');

/* ── Prompts ────────────────────────────────────────────── */

export const CV_EXTRACTION_SYSTEM_PROMPT = `You are an expert HR document analyst. You will be given the text of one document from a company's knowledge base. Your job is:
1. Decide whether the document is a CV / resume / professional bio of a single person (as opposed to an RFP, contract, report, pricing sheet, or any other document type).
2. If it is a CV, extract the person's details.

Respond ONLY with a single JSON object, no prose, in this exact shape:
{
  "isCv": boolean,
  "name": string | null,            // the person's full name, or null if not detectable
  "primaryRoles": string[],         // main professional roles/titles, each <= 100 chars
  "secondaryRoles": string[],       // secondary roles/skills-as-roles, each <= 100 chars
  "certifications": string[],       // professional certifications, each <= 200 chars
  "location": "ONSHORE" | "OFFSHORE" | null   // ONSHORE if clearly US-based, OFFSHORE if clearly outside the US, null if unstated
}
If the document is not a CV, return {"isCv": false, "name": null, "primaryRoles": [], "secondaryRoles": [], "certifications": [], "location": null}.`;

export const createCvExtractionUserPrompt = (documentText: string): string =>
  `Document text:\n\n${documentText.slice(0, 100_000)}`;

/* ── Extracted-candidate schema ─────────────────────────── */

const ExtractedCvSchema = z.object({
  isCv: z.boolean(),
  name: z.string().nullable().optional(),
  primaryRoles: z.array(z.string()).default([]),
  secondaryRoles: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  location: EmployeeLocationSchema.nullable().optional(),
});
type ExtractedCv = z.infer<typeof ExtractedCvSchema>;

/* ── Org document listing ───────────────────────────────── */

interface OrgDocument {
  id: string;
  name: string;
  textFileKey?: string;
  indexStatus?: string;
}

type KnowledgeBaseRecord = { [SK_NAME]: string };
type DocumentRecord = DocumentItem & { [SK_NAME]: string };

/** indexStatus values that mean "extracted text exists in S3" (BR2.1). */
const TEXT_READY_STATUSES = new Set(['TEXT_EXTRACTED', 'CHUNKED', 'INDEXED', 'ready']);

/**
 * List every document of the organization: all org knowledge bases
 * (KNOWLEDGE_BASE / `{orgId}#{kbId}`) then their documents
 * (DOCUMENT / `KB#{kbId}#DOC#{docId}`). Queries the single table directly via
 * `@/helpers/db` so this worker-side module stays free of the KB helper's
 * Pinecone/S3 dependency graph.
 */
export const listOrgDocuments = async (orgId: string): Promise<OrgDocument[]> => {
  const kbs = await queryBySkPrefix<KnowledgeBaseRecord>(KNOWLEDGE_BASE_PK, `${orgId}#`);
  const kbIds = kbs
    .map((kb) => kb[SK_NAME]?.split('#')[1])
    .filter((kbId): kbId is string => !!kbId);

  const documents: OrgDocument[] = [];
  for (const kbId of kbIds) {
    const docs = await queryAllBySkPrefix<DocumentRecord>(DOCUMENT_PK, `KB#${kbId}#DOC#`);
    for (const doc of docs) {
      documents.push({
        id: doc.id,
        name: doc.name,
        textFileKey: doc.textFileKey,
        indexStatus: doc.indexStatus,
      });
    }
  }
  return documents;
};

/* ── Bedrock classification + extraction ────────────────── */

/** Parse the model's JSON object out of the response text. */
const parseExtractedCv = (textContent: string): ExtractedCv | null => {
  let jsonStr = textContent.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  jsonStr = jsonStr.slice(start, end + 1);

  try {
    const raw: unknown = JSON.parse(jsonStr);
    const { success, data } = ExtractedCvSchema.safeParse(raw);
    return success ? data : null;
  } catch {
    return null;
  }
};

/**
 * One Bedrock call classifies the document (CV / non-CV) and extracts the
 * candidate fields (BR2.1 + BR2.2 share the retry-then-EXTRACTION_FAILED
 * handling, so a combined call keeps the failure semantics identical).
 * Throws on call failure or an unparseable response.
 */
export const classifyAndExtractCv = async (documentText: string): Promise<ExtractedCv> => {
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system: CV_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: createCvExtractionUserPrompt(documentText) }],
  };

  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textContent = parsed.content?.find((c) => c.type === 'text')?.text;
  if (!textContent) throw new Error('Empty Bedrock response for CV extraction');

  const extracted = parseExtractedCv(textContent);
  if (!extracted) throw new Error('Unparseable Bedrock response for CV extraction');
  return extracted;
};

/* ── Merge (BR3.1 / BR3.3) ──────────────────────────────── */

/** BR3.1 — merge key: trim + case-fold the person name. */
export const normalizeEmployeeName = (name: string): string => name.trim().toLowerCase();

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const valuesEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const MERGEABLE_FIELDS = [
  'primaryRoles',
  'secondaryRoles',
  'certifications',
  'resumeRef',
  'location',
] as const;
type MergeableField = (typeof MERGEABLE_FIELDS)[number];

/**
 * BR3.3 — field precedence for a matched employee. A field is overwritten only
 * when its current value equals the last-extracted snapshot value or is empty;
 * with no snapshot (e.g. manually created employee) only empty fields fill.
 * Returns the patch to apply (may be empty when every field is manually edited).
 */
export const buildMergePatch = (
  current: EmployeeItem,
  extracted: EmployeeExtractionFields,
  snapshotFields: EmployeeExtractionFields | null,
): EmployeeUpdateRequest => {
  const patch: Record<string, unknown> = {};

  for (const field of MERGEABLE_FIELDS) {
    const extractedValue = extracted[field];
    if (isEmptyValue(extractedValue)) continue; // nothing new extracted — never blank a field

    const currentValue = current[field];
    const mayOverwrite = snapshotFields
      ? isEmptyValue(currentValue) || valuesEqual(currentValue, snapshotFields[field])
      : isEmptyValue(currentValue);

    if (mayOverwrite && !valuesEqual(currentValue, extractedValue)) {
      patch[field] = extractedValue;
    }
  }

  return patch as EmployeeUpdateRequest;
};

/* ── Run pipeline ───────────────────────────────────────── */

export interface EmployeeImportEngineInput {
  orgId: string;
  importRunId: string;
  /** The user who triggered the run — recorded as creator of new employees. */
  triggeredBy: string;
}

interface RunCounters {
  documentsScanned: number;
  cvsDetected: number;
  employeesCreated: number;
  employeesUpdated: number;
  failedDocuments: ImportFailedDocument[];
}

const truncateName = (name: string): string =>
  name.length > IMPORT_DOCUMENT_NAME_MAX_LENGTH
    ? name.slice(0, IMPORT_DOCUMENT_NAME_MAX_LENGTH)
    : name;

/**
 * Execute one employee import run (W1). Scans all org documents, classifies
 * and extracts CVs, merges candidates by normalized name through U1's
 * employee helpers, refreshes extraction snapshots, and closes the run.
 * Never throws for per-document problems — they become failure records
 * (BR2.1/BR2.2/BR3.1); an unrecoverable error closes the run FAILED with
 * partial counts and preserved imports (BR4.2).
 */
export const runEmployeeImport = async (
  input: EmployeeImportEngineInput,
): Promise<EmployeeImportRunItem> => {
  const { orgId, importRunId, triggeredBy } = input;
  const documentsBucket = requireEnv('DOCUMENTS_BUCKET');

  const counters: RunCounters = {
    documentsScanned: 0,
    cvsDetected: 0,
    employeesCreated: 0,
    employeesUpdated: 0,
    failedDocuments: [],
  };

  const recordFailure = (documentName: string, reason: ImportFailedDocument['reason']) => {
    counters.failedDocuments.push({ documentName: truncateName(documentName), reason });
  };

  try {
    // In-memory merge index: normalized name → employees. Kept current as the
    // run creates/updates records so two CVs of the same new person merge
    // instead of duplicating (BR3.1).
    const employees = await listEmployeesByOrg(orgId);
    const nameIndex = new Map<string, EmployeeItem[]>();
    const indexEmployee = (employee: EmployeeItem) => {
      const key = normalizeEmployeeName(employee.name);
      const bucket = nameIndex.get(key);
      if (bucket) bucket.push(employee);
      else nameIndex.set(key, [employee]);
    };
    employees.forEach(indexEmployee);

    const documents = await listOrgDocuments(orgId);
    console.log(`[employee-import] run ${importRunId}: scanning ${documents.length} org documents`);

    let consecutiveExtractionFailures = 0;

    for (const document of documents) {
      counters.documentsScanned++;

      // BR2.1 — no extracted text → UNREADABLE.
      const hasText =
        !!document.textFileKey &&
        (!document.indexStatus || TEXT_READY_STATUSES.has(document.indexStatus));
      let documentText = '';
      if (hasText && document.textFileKey) {
        try {
          documentText = await loadTextFromS3(documentsBucket, document.textFileKey);
        } catch (err) {
          console.warn(
            `[employee-import] failed to load text for ${document.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (!documentText.trim()) {
        recordFailure(document.name, 'UNREADABLE');
        consecutiveExtractionFailures = 0;
        await updateImportRunProgress(orgId, importRunId, counters);
        continue;
      }

      // BR2.1/BR2.2 — classify + extract with one retry, then EXTRACTION_FAILED.
      let extracted: ExtractedCv | null = null;
      try {
        extracted = await classifyAndExtractCv(documentText);
      } catch (firstErr) {
        console.warn(
          `[employee-import] extraction attempt 1 failed for ${document.name}:`,
          firstErr instanceof Error ? firstErr.message : firstErr,
        );
        try {
          extracted = await classifyAndExtractCv(documentText);
        } catch (secondErr) {
          console.error(
            `[employee-import] extraction failed for ${document.name} after retry:`,
            secondErr instanceof Error ? secondErr.message : secondErr,
          );
        }
      }

      if (!extracted) {
        recordFailure(document.name, 'EXTRACTION_FAILED');
        consecutiveExtractionFailures++;

        // BR4.2 — five consecutive AI failures = service outage; end the run
        // FAILED, preserving everything imported so far.
        if (consecutiveExtractionFailures >= IMPORT_CONSECUTIVE_FAILURE_LIMIT) {
          console.error(
            `[employee-import] ${consecutiveExtractionFailures} consecutive extraction failures — treating AI service as down (BR4.2)`,
          );
          return await completeImportRun(orgId, importRunId, {
            status: 'FAILED',
            ...counters,
          });
        }

        await updateImportRunProgress(orgId, importRunId, counters);
        continue;
      }

      consecutiveExtractionFailures = 0;

      // BR2.1 — non-CV documents are skipped silently (not failures).
      if (!extracted.isCv) {
        await updateImportRunProgress(orgId, importRunId, counters);
        continue;
      }

      counters.cvsDetected++;

      // BR2.2 — a CV without a detectable person name is INCOMPLETE_EXTRACTION.
      const candidateName = extracted.name?.trim() ?? '';
      if (!candidateName) {
        recordFailure(document.name, 'INCOMPLETE_EXTRACTION');
        await updateImportRunProgress(orgId, importRunId, counters);
        continue;
      }

      const extractedFields: EmployeeExtractionFields = {
        name: candidateName,
        primaryRoles: extracted.primaryRoles,
        secondaryRoles: extracted.secondaryRoles,
        certifications: extracted.certifications,
        resumeRef: document.id, // the source document (BR2.2)
        ...(extracted.location ? { location: extracted.location } : {}),
      };

      // BR3.1 — merge by normalized name.
      const matches = nameIndex.get(normalizeEmployeeName(candidateName)) ?? [];

      try {
        if (matches.length > 1) {
          // Several employees match — write nothing, flag for manual resolution.
          recordFailure(document.name, 'AMBIGUOUS_NAME');
        } else if (matches.length === 1) {
          const existing = matches[0];
          const snapshot = await getExtractionSnapshot(orgId, existing.id);
          const patch = buildMergePatch(existing, extractedFields, snapshot?.fields ?? null);

          if (Object.keys(patch).length > 0) {
            const updated = await updateEmployee(orgId, existing.id, patch);
            Object.assign(existing, updated); // keep the merge index current
          }
          // BR3.3 — in every case refresh the snapshot with the new extraction.
          await putExtractionSnapshot(orgId, existing.id, extractedFields);
          counters.employeesUpdated++;
        } else {
          // BR3.4 — writes go through U1's rules: a candidate that fails U1
          // validation is INCOMPLETE_EXTRACTION, never an invalid record.
          const { success, data } = EmployeeCreateRequestSchema.safeParse({
            orgId,
            name: candidateName,
            primaryRoles: extracted.primaryRoles,
            secondaryRoles: extracted.secondaryRoles,
            certifications: extracted.certifications,
            resumeRef: document.id,
            ...(extracted.location ? { location: extracted.location } : {}),
          });

          if (!success) {
            recordFailure(document.name, 'INCOMPLETE_EXTRACTION');
          } else {
            const created = await createEmployee(data, {
              source: 'AI_IMPORT',
              createdBy: triggeredBy,
            });
            await putExtractionSnapshot(orgId, created.id, extractedFields);
            indexEmployee(created);
            counters.employeesCreated++;
          }
        }
      } catch (mergeErr) {
        // A single candidate's write failure never sinks the run (BR3.4).
        console.error(
          `[employee-import] merge failed for ${document.name}:`,
          mergeErr instanceof Error ? mergeErr.message : mergeErr,
        );
        recordFailure(document.name, 'INCOMPLETE_EXTRACTION');
      }

      await updateImportRunProgress(orgId, importRunId, counters);
    }

    // BR4.1 — completion report: named failures decide the terminal status.
    return await completeImportRun(orgId, importRunId, {
      status: counters.failedDocuments.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      ...counters,
    });
  } catch (err) {
    // BR4.2 — unrecoverable mid-run error: FAILED with partial counts, no rollback.
    console.error(
      `[employee-import] run ${importRunId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return await completeImportRun(orgId, importRunId, {
      status: 'FAILED',
      ...counters,
    });
  }
};
