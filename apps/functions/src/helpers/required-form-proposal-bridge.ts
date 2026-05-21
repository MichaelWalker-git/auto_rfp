import { v4 as uuidv4 } from 'uuid';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import {
  putRFPDocument,
  softDeleteRFPDocument,
  buildRFPDocumentSK,
} from './rfp-document';
import type { RequiredFormItem } from '@auto-rfp/core';

const formMimeType = (form: RequiredFormItem): string => {
  if (form.formType === 'XLSX_MATRIX' || form.formType === 'XLSX_FORM') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/pdf';
};

/**
 * Materialize a filled required form as an RFP document so it shows up in the
 * proposal package. The created RFP document points at the form's filledFileKey
 * (or sourceFileKey if not exported yet) and uses documentType 'OTHER' so it
 * lists alongside the AI-generated sections without entering the generation
 * pipeline.
 *
 * Returns the new RFP documentId. Caller persists it on the form record.
 */
export const attachFormAsRfpDocument = async (args: {
  form: RequiredFormItem;
  userId: string;
}): Promise<string> => {
  const { form, userId } = args;
  const documentId = uuidv4();
  const now = new Date().toISOString();

  const fileKey = form.filledFileKey ?? form.sourceFileKey;
  const sk = buildRFPDocumentSK(form.projectId, form.opportunityId, documentId);

  const item: Record<string, unknown> = {
    [PK_NAME]: RFP_DOCUMENT_PK,
    [SK_NAME]: sk,
    documentId,
    projectId: form.projectId,
    opportunityId: form.opportunityId,
    orgId: form.orgId,
    name: form.name,
    description: `Required form (auto-attached from required-forms): ${form.name}`,
    documentType: 'OTHER',
    mimeType: formMimeType(form),
    fileSizeBytes: 0,
    originalFileName: form.sourceFileName,
    fileKey,
    version: 1,
    previousVersionId: null,
    signatureStatus: 'NOT_REQUIRED',
    signatureDetails: null,
    linearSyncStatus: 'NOT_SYNCED',
    linearCommentId: null,
    lastSyncedAt: null,
    deletedAt: null,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    // Marker so the UI can render an "auto-attached form" badge and so that
    // queries can distinguish bridge documents from user-uploaded ones.
    requiredFormId: form.formId,
  };

  await putRFPDocument(item);
  return documentId;
};

/**
 * Sync the bridge RFP document's fileKey with the form's latest filledFileKey.
 * Called from export-filled-form so a freshly exported file replaces the
 * stale (often unfilled) source the bridge was created with.
 *
 * Idempotent — silent no-op when there's no bridge document yet.
 */
export const syncFormFilledFileToProposal = async (args: {
  projectId: string;
  opportunityId: string;
  proposalDocumentId: string | null;
  filledFileKey: string;
  userId: string;
}): Promise<void> => {
  if (!args.proposalDocumentId) return;
  try {
    const tableName = requireEnv('DB_TABLE_NAME');
    const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.proposalDocumentId);
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #fileKey = :fileKey, #updatedAt = :now, #updatedBy = :updatedBy',
      ExpressionAttributeNames: {
        '#fileKey': 'fileKey',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
      ExpressionAttributeValues: {
        ':fileKey': args.filledFileKey,
        ':now': nowIso(),
        ':updatedBy': args.userId,
      },
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`syncFormFilledFileToProposal: failed for documentId=${args.proposalDocumentId}: ${message}`);
  }
};

/**
 * Soft-delete the RFP document that mirrors a required form. Idempotent —
 * safe to call when there's nothing to detach.
 */
export const detachFormFromProposal = async (args: {
  projectId: string;
  opportunityId: string;
  proposalDocumentId: string | null;
  userId: string;
}): Promise<void> => {
  if (!args.proposalDocumentId) return;
  try {
    await softDeleteRFPDocument({
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      documentId: args.proposalDocumentId,
      deletedBy: args.userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`detachFormFromProposal: soft-delete failed (idempotent): ${message}`);
  }
};
