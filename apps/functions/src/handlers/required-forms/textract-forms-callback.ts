import type { Context, SNSEvent } from 'aws-lambda';

import { withSentryLambda } from '@/sentry-lambda';
import { fetchAllAnalysisBlocks, mapBlocksToFields } from '@/helpers/textract-forms';
import { findRequiredFormByFormId, listRequiredFormsByOpportunity, updateRequiredForm } from '@/helpers/required-form';
import { getCompanyProfile } from '@/helpers/company-profile';
import { autofillFieldsWithTools } from '@/helpers/autofill-fields-with-tools';
import { docClient, queryAllBySkPrefix } from '@/helpers/db';
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
 */
const markFormsReadyIfAllDone = async (orgId: string, projectId: string, opportunityId: string): Promise<void> => {
  try {
    const forms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });
    const anyPending = forms.some((f) => f.status !== 'READY' && f.status !== 'DONE' && f.status !== 'FAILED');
    if (anyPending) return;

    const tableName = requireEnv('DB_TABLE_NAME');
    const skPrefix = `${projectId}#${opportunityId}#`;
    const files = await queryAllBySkPrefix<{ [PK_NAME]: string; [SK_NAME]: string }>(QUESTION_FILE_PK, skPrefix);
    await Promise.all(
      files.map((f) =>
        docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: f[SK_NAME] },
          UpdateExpression: 'SET #status = :status, #updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: { ':status': 'FORMS_READY', ':now': nowIso() },
        })).catch((err) => console.warn(`Failed to set FORMS_READY on ${f[SK_NAME]}:`, (err as Error)?.message)),
      ),
    );
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
      const detected = mapBlocksToFields(blocks);

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
