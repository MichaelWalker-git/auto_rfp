import type { Context, SNSEvent } from 'aws-lambda';

import { withSentryLambda } from '@/sentry-lambda';
import { fetchAllAnalysisBlocks, mapBlocksToFields, parsePageRange } from '@/helpers/textract-forms';
import { findRequiredFormByFormId, listRequiredFormsByOpportunity, updateRequiredForm } from '@/helpers/required-form';
import { getCompanyProfile } from '@/helpers/company-profile';
import { autofillFieldsWithTools } from '@/helpers/autofill-fields-with-tools';
import { docClient, queryAllBySkPrefix, withRetry } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';

import type { DetectedFormField } from '@auto-rfp/core';

/**
 * After a form transitions to a terminal state (READY/FAILED), check whether
 * every form for the opportunity is terminal. If yes, mark every QUESTION_FILE
 * for this opportunity as FORMS_READY so the UI's "Filling forms…" badge
 * clears. Best-effort — a status-write failure is logged, not thrown.
 *
 * Concurrency is capped (CONCURRENCY=5) and each write is wrapped in withRetry
 * to absorb the ThrottlingException storm we saw against the QUESTION_FILE
 * partition when many forms terminate simultaneously. A failed call to
 * `withRetry` reaches the retry budget and then returns the error to the
 * per-write `.catch`, where it is logged and dropped — same best-effort
 * semantics as before, just with throttle backoff in front.
 */
const FORMS_READY_WRITE_CONCURRENCY = 5;

const markFormsReadyIfAllDone = async (orgId: string, projectId: string, opportunityId: string): Promise<void> => {
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

type TextractSnsMessage = {
  JobId?: string;
  Status?: string;
  JobTag?: string;
  StatusMessage?: string;
};

const computeStats = (fields: DetectedFormField[]) => {
  const total = fields.length;
  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  return {
    totalFieldCount: total,
    manualFieldCount: manual,
    autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
  };
};

export const baseHandler = async (event: SNSEvent, _context: Context): Promise<void> => {
  for (const record of event.Records) {
    let message: TextractSnsMessage;
    try {
      message = JSON.parse(record.Sns.Message) as TextractSnsMessage;
    } catch (err) {
      console.warn('[textract-forms-callback] non-JSON SNS message, skipping:', (err as Error)?.message);
      continue;
    }

    const { JobId, Status, JobTag, StatusMessage } = message;
    if (!JobId || !Status || !JobTag) {
      console.warn('[textract-forms-callback] missing JobId/Status/JobTag, skipping');
      continue;
    }

    const formId = JobTag;
    const form = await findRequiredFormByFormId(formId);
    if (!form) {
      console.warn(`[textract-forms-callback] no form found for formId=${formId}`);
      continue;
    }

    const baseKeys = {
      orgId: form.orgId,
      projectId: form.projectId,
      opportunityId: form.opportunityId,
      formId: form.formId,
    };

    if (Status !== 'SUCCEEDED' && Status !== 'PARTIAL_SUCCESS') {
      await updateRequiredForm({
        ...baseKeys,
        patch: {
          status: 'FAILED',
          errorMessage: `Textract job ${JobId} status=${Status}: ${StatusMessage ?? 'unknown'}`,
        },
      });
      await markFormsReadyIfAllDone(form.orgId, form.projectId, form.opportunityId);
      continue;
    }

    try {
      const blocks = await fetchAllAnalysisBlocks(JobId);
      // Forms are detected from the *whole* solicitation PDF (one Textract job
      // per source PDF, but multiple form records share that source file with
      // different sourcePageRange values). Without this filter every form would
      // get every KEY_VALUE_SET / SIGNATURE block from the entire PDF.
      const allowedPages = parsePageRange(form.sourcePageRange);
      const detected = mapBlocksToFields(blocks, allowedPages);

      let fields: DetectedFormField[] = detected;
      if (detected.length > 0) {
        const profile = await getCompanyProfile(form.orgId);
        if (profile) {
          fields = await autofillFieldsWithTools(detected, profile);
        }
      }

      const stats = computeStats(fields);
      await updateRequiredForm({
        ...baseKeys,
        patch: {
          fields,
          status: 'READY',
          ...stats,
        },
      });
      console.log(
        `[textract-forms-callback] form ${formId}: ${stats.totalFieldCount} fields, ${stats.autoFillPercentage}% auto-filled`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[textract-forms-callback] error:', message);
      await updateRequiredForm({
        ...baseKeys,
        patch: { status: 'FAILED', errorMessage: message },
      });
    }

    await markFormsReadyIfAllDone(form.orgId, form.projectId, form.opportunityId);
  }
};

export const handler = withSentryLambda(baseHandler);
