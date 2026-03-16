import { v4 as uuidv4 } from 'uuid';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createItem, queryBySkPrefix, getItem, docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { DOCUMENT_APPROVAL_PK } from '@/constants/document-approval';
import { PK_NAME, SK_NAME } from '@/constants/common';
import type {
  DocumentApprovalItem,
  RequestDocumentApproval,
} from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildApprovalSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  approvalId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${documentId}#${approvalId}`;

export const buildApprovalSkPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${documentId}#`;

// ─── DynamoDB Helpers ─────────────────────────────────────────────────────────

export const createApprovalRecord = async (
  dto: RequestDocumentApproval,
  requestedBy: string,
  requestedByName: string | undefined,
  reviewerName: string | undefined,
  reviewerEmail: string | undefined,
  documentName: string | undefined,
): Promise<DocumentApprovalItem> => {
  const approvalId = uuidv4();
  const now = nowIso();

  return createItem<DocumentApprovalItem>(
    DOCUMENT_APPROVAL_PK,
    buildApprovalSk(dto.orgId, dto.projectId, dto.opportunityId, dto.documentId, approvalId),
    {
      approvalId,
      orgId:         dto.orgId,
      projectId:     dto.projectId,
      opportunityId: dto.opportunityId,
      documentId:    dto.documentId,
      documentName,
      status:        'PENDING',
      requestedBy,
      requestedByName,
      requestedAt:   now,
      reviewerId:    dto.reviewerId,
      reviewerName,
      reviewerEmail,
    },
  );
};

export const getApprovalRecord = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  approvalId: string,
): Promise<DocumentApprovalItem | null> =>
  getItem<DocumentApprovalItem>(
    DOCUMENT_APPROVAL_PK,
    buildApprovalSk(orgId, projectId, opportunityId, documentId, approvalId),
  );

export const listApprovalsByDocument = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<DocumentApprovalItem[]> => {
  const items = await queryBySkPrefix<DocumentApprovalItem>(
    DOCUMENT_APPROVAL_PK,
    buildApprovalSkPrefix(orgId, projectId, opportunityId, documentId),
  );
  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
};

export const updateApprovalLinearTicket = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  approvalId: string,
  ticket: {
    linearTicketId: string;
    linearTicketIdentifier?: string;
    linearTicketUrl?: string;
  },
): Promise<void> => {
  const sk = buildApprovalSk(orgId, projectId, opportunityId, documentId, approvalId);
  const now = nowIso();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: DOCUMENT_APPROVAL_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #linearTicketId = :linearTicketId, #linearTicketIdentifier = :linearTicketIdentifier, #linearTicketUrl = :linearTicketUrl, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#linearTicketId': 'linearTicketId',
        '#linearTicketIdentifier': 'linearTicketIdentifier',
        '#linearTicketUrl': 'linearTicketUrl',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':linearTicketId': ticket.linearTicketId,
        ':linearTicketIdentifier': ticket.linearTicketIdentifier ?? null,
        ':linearTicketUrl': ticket.linearTicketUrl ?? null,
        ':now': now,
      },
    }),
  );
};

export const updateApprovalStatus = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  approvalId: string,
  updates: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    reviewedAt?: string;
    reviewNote?: string;
  },
): Promise<DocumentApprovalItem> => {
  const sk = buildApprovalSk(orgId, projectId, opportunityId, documentId, approvalId);
  const now = nowIso();

  const setParts: string[] = ['#status = :status', '#updatedAt = :now'];
  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':status': updates.status,
    ':now': now,
  };

  if (updates.reviewedAt) {
    setParts.push('#reviewedAt = :reviewedAt');
    names['#reviewedAt'] = 'reviewedAt';
    values[':reviewedAt'] = updates.reviewedAt;
  }
  if (updates.reviewNote !== undefined) {
    setParts.push('#reviewNote = :reviewNote');
    names['#reviewNote'] = 'reviewNote';
    values[':reviewNote'] = updates.reviewNote;
  }

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: DOCUMENT_APPROVAL_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as DocumentApprovalItem;
};

/**
 * Cancel all PENDING approvals for a document (used when a new approval is requested
 * to avoid multiple concurrent pending approvals).
 */
export const cancelPendingApprovals = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<void> => {
  const existing = await listApprovalsByDocument(orgId, projectId, opportunityId, documentId);
  const pending = existing.filter((a) => a.status === 'PENDING');

  await Promise.all(
    pending.map((a) =>
      updateApprovalStatus(orgId, projectId, opportunityId, documentId, a.approvalId, {
        status: 'CANCELLED',
      }),
    ),
  );
};

/**
 * Get approval history in the standard format for existing handlers
 */
export const getApprovalHistory = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<{ items: DocumentApprovalItem[]; count: number; activeApproval: DocumentApprovalItem | null }> => {
  const items = await listApprovalsByDocument(orgId, projectId, opportunityId, documentId);
  const activeApproval = items.find(item => item.status === 'PENDING') || null;
  
  return {
    items,
    count: items.length,
    activeApproval,
  };
};
