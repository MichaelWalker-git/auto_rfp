import type { Context, SNSEvent } from 'aws-lambda';

import { withSentryLambda } from '@/sentry-lambda';
import { fetchAllAnalysisBlocks, mapBlocksToFields, parsePageRange } from '@/helpers/textract-forms';
import { findRequiredFormByFormId, updateRequiredForm } from '@/helpers/required-form';
import { getCompanyProfile } from '@/helpers/company-profile';
import { autofillFieldsWithTools } from '@/helpers/autofill-fields-with-tools';
import { markFormsReadyIfAllDone } from '@/helpers/mark-forms-ready';
import { scanFormPageNotary } from '@/helpers/notary-wiring';
import { isConditionalCheckFailed } from '@/helpers/db';

import type { DetectedFormField } from '@auto-rfp/core';

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
          fields = await autofillFieldsWithTools(detected, profile, form.orgId);
        }
      }

      const stats = computeStats(fields);

      // WF-B — form-page notary scan. Best-effort/fail-open: the scan never blocks
      // READY and never yields a silent NOT_REQUIRED (a scan error degrades to
      // POSSIBLY_REQUIRED review-manually). The notary fields ride the SAME patch
      // that sets READY (one write), guarded so a USER_SET override is not
      // clobbered (WF-C / BR12.2). If that atomic guard rejects the write
      // (USER_SET), the form still reaches READY without the notary fields.
      // The scan sees ONLY this form's own pages (same sourcePageRange filter as
      // the field mapping above) — otherwise a notary clause anywhere in the
      // shared source PDF would flag EVERY form extracted from it with identical
      // triggers. Whole-document instructions ("all forms must be notarized")
      // are covered by the WF-A body scan, which reads the full document text.
      const notaryBlocks = allowedPages
        ? blocks.filter((b) => allowedPages.has(b.Page ?? 1))
        : blocks;
      const notaryPatch = await scanFormPageNotary({ orgId: form.orgId, form, blocks: notaryBlocks });
      try {
        await updateRequiredForm({
          ...baseKeys,
          patch: { fields, status: 'READY', ...stats, ...notaryPatch },
          guardNotaryAiDetected: true,
        });
      } catch (writeErr) {
        if (isConditionalCheckFailed(writeErr)) {
          // A concurrent/prior USER_SET notary override — preserve it and still
          // reach READY without touching the notary fields.
          await updateRequiredForm({ ...baseKeys, patch: { fields, status: 'READY', ...stats } });
        } else {
          throw writeErr;
        }
      }
      console.log(
        `[textract-forms-callback] form ${formId}: ${stats.totalFieldCount} fields, ${stats.autoFillPercentage}% auto-filled, notary=${notaryPatch.notaryStatus}`,
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
