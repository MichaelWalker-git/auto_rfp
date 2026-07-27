import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { docClient, queryAllBySkPrefix, withRetry } from './db';
import { listRequiredFormsByOpportunity } from './required-form';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { requireEnv } from './env';
import { nowIso } from './date';

/**
 * After a form transitions to a terminal state (READY/DONE/FAILED), check whether
 * every form for the opportunity is terminal. If yes, mark every QUESTION_FILE
 * for this opportunity as FORMS_READY so the UI's "Filling forms…" badge clears.
 * Best-effort — a status-write failure is logged, not thrown.
 *
 * Called from BOTH form-completion paths so no path leaves the question file stuck
 * in FILLING_FORMS:
 * - textract-forms-callback (PDF forms, async Textract)
 * - detect-required-forms (XLSX/DOCX forms, parsed inline)
 * If any form is still pending (e.g. a PDF form awaiting Textract in a mixed
 * opportunity), this is a no-op — the last path to terminate flips the badge.
 *
 * Concurrency is capped (CONCURRENCY=5) and each write is wrapped in withRetry
 * to absorb the ThrottlingException storm seen against the QUESTION_FILE
 * partition when many forms terminate simultaneously.
 */
const FORMS_READY_WRITE_CONCURRENCY = 5;

export const markFormsReadyIfAllDone = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<void> => {
  try {
    const forms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });
    const anyPending = forms.some((f) => f.status !== 'READY' && f.status !== 'DONE' && f.status !== 'FAILED');
    if (anyPending) return;

    const tableName = requireEnv('DB_TABLE_NAME');
    const skPrefix = `${projectId}#${opportunityId}#`;
    const files = await queryAllBySkPrefix<{ [PK_NAME]: string; [SK_NAME]: string }>(QUESTION_FILE_PK, skPrefix);

    for (let i = 0; i < files.length; i += FORMS_READY_WRITE_CONCURRENCY) {
      const chunk = files.slice(i, i + FORMS_READY_WRITE_CONCURRENCY);
      await Promise.all(
        chunk.map((f) =>
          withRetry(
            () => docClient.send(new UpdateCommand({
              TableName: tableName,
              Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: f[SK_NAME] },
              UpdateExpression: 'SET #status = :status, #updatedAt = :now',
              ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
              ExpressionAttributeValues: { ':status': 'FORMS_READY', ':now': nowIso() },
            })),
            { label: 'markFormsReady' },
          ).catch((err) => console.warn(`Failed to set FORMS_READY on ${f[SK_NAME]}:`, (err as Error)?.message)),
        ),
      );
    }
  } catch (err) {
    console.warn('markFormsReadyIfAllDone failed:', (err as Error)?.message);
  }
};
