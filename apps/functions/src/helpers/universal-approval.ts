import { v4 as uuidv4 } from 'uuid';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createItem, queryBySkPrefix, getItem, docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { UNIVERSAL_APPROVAL_PK } from '@/constants/universal-approval';
import { PK_NAME, SK_NAME } from '@/constants/common';
import type {
  UniversalApprovalItem,
  RequestUniversalApproval,
  ApprovableEntityType,
} from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildUniversalApprovalSk = (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
  approvalId: string,
): string => `${orgId}#${entityType}#${entitySK}#${approvalId}`;

export const buildUniversalApprovalSkPrefix = (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
): string => `${orgId}#${entityType}#${entitySK}#`;

// For querying all approvals for an entity type within an org
export const buildEntityTypeSkPrefix = (
  orgId: string,
  entityType: ApprovableEntityType,
): string => `${orgId}#${entityType}#`;

// ─── DynamoDB Helpers ─────────────────────────────────────────────────────────

export const createUniversalApprovalRecord = async (
  dto: RequestUniversalApproval,
  requestedBy: string,
  requestedByName: string | undefined,
  reviewerName: string | undefined,
  reviewerEmail: string | undefined,
): Promise<UniversalApprovalItem> => {
  const approvalId = uuidv4();
  const now = nowIso();

  return createItem<UniversalApprovalItem>(
    UNIVERSAL_APPROVAL_PK,
    buildUniversalApprovalSk(dto.orgId, dto.entityType, dto.entitySK, approvalId),
    {
      approvalId,
      orgId:         dto.orgId,
      projectId:     dto.projectId,
      entityType:    dto.entityType,
      entityId:      dto.entityId,
      entitySK:      dto.entitySK,
      entityName:    dto.entityName,
      
      // Legacy fields for backward compatibility
      opportunityId: dto.opportunityId,
      documentId:    dto.documentId,
      documentName:  dto.entityName, // Map entityName to documentName for compatibility
      
      status:        'PENDING',
      requestedBy,
      requestedByName,
      requestedAt:   now,
      reviewerId:    dto.reviewerId,
      reviewerName,
      reviewerEmail,
      priority:      'NORMAL',
      tags:          [],
    },
  );
};

export const getUniversalApprovalRecord = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
  approvalId: string,
): Promise<UniversalApprovalItem | null> =>
  getItem<UniversalApprovalItem>(
    UNIVERSAL_APPROVAL_PK,
    buildUniversalApprovalSk(orgId, entityType, entitySK, approvalId),
  );

export const listUniversalApprovalsByEntity = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
): Promise<UniversalApprovalItem[]> => {
  const items = await queryBySkPrefix<UniversalApprovalItem>(
    UNIVERSAL_APPROVAL_PK,
    buildUniversalApprovalSkPrefix(orgId, entityType, entitySK),
  );
  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
};

export const listUniversalApprovalsByEntityType = async (
  orgId: string,
  entityType: ApprovableEntityType,
): Promise<UniversalApprovalItem[]> => {
  const items = await queryBySkPrefix<UniversalApprovalItem>(
    UNIVERSAL_APPROVAL_PK,
    buildEntityTypeSkPrefix(orgId, entityType),
  );
  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
};

export const updateUniversalApprovalLinearTicket = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
  approvalId: string,
  ticket: {
    linearTicketId: string;
    linearTicketIdentifier?: string;
    linearTicketUrl?: string;
  },
): Promise<void> => {
  const sk = buildUniversalApprovalSk(orgId, entityType, entitySK, approvalId);
  const now = nowIso();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: UNIVERSAL_APPROVAL_PK, [SK_NAME]: sk },
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

export const updateUniversalApprovalStatus = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
  approvalId: string,
  updates: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    reviewedAt?: string;
    reviewNote?: string;
    revisionNote?: string;
  },
): Promise<UniversalApprovalItem> => {
  const sk = buildUniversalApprovalSk(orgId, entityType, entitySK, approvalId);
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
  if (updates.revisionNote !== undefined) {
    setParts.push('#revisionNote = :revisionNote');
    names['#revisionNote'] = 'revisionNote';
    values[':revisionNote'] = updates.revisionNote;
  }

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: UNIVERSAL_APPROVAL_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as UniversalApprovalItem;
};

/**
 * Cancel all PENDING approvals for an entity (used when a new approval is requested
 * to avoid multiple concurrent pending approvals).
 */
export const cancelPendingUniversalApprovals = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
): Promise<void> => {
  const existing = await listUniversalApprovalsByEntity(orgId, entityType, entitySK);
  const pending = existing.filter((a) => a.status === 'PENDING');

  await Promise.all(
    pending.map((a) =>
      updateUniversalApprovalStatus(orgId, entityType, entitySK, a.approvalId, {
        status: 'CANCELLED',
      }),
    ),
  );
};

/**
 * Get approval history in the standard format for handlers
 */
export const getUniversalApprovalHistory = async (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
): Promise<{ items: UniversalApprovalItem[]; count: number; activeApproval: UniversalApprovalItem | null }> => {
  const items = await listUniversalApprovalsByEntity(orgId, entityType, entitySK);
  const activeApproval = items.find(item => item.status === 'PENDING') || null;
  
  return {
    items,
    count: items.length,
    activeApproval,
  };
};

// ─── Legacy Compatibility Helpers ────────────────────────────────────────────

/**
 * Build entitySK for RFP documents (backward compatibility)
 */
export const buildRfpDocumentEntitySK = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${documentId}`;

/**
 * Build entitySK for executive briefs
 */
export const buildBriefEntitySK = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  briefId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${briefId}`;

/**
 * Build entitySK for opportunities
 */
export const buildOpportunityEntitySK = (
  orgId: string,
  projectId: string,
  opportunityId: string,
): string => `${orgId}#${projectId}#${opportunityId}`;

/**
 * Build entitySK for submissions
 */
export const buildSubmissionEntitySK = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  submissionId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${submissionId}`;

/**
 * Build entitySK for content library items
 */
export const buildContentLibraryEntitySK = (
  orgId: string,
  contentId: string,
): string => `${orgId}#${contentId}`;

/**
 * Build entitySK for templates
 */
export const buildTemplateEntitySK = (
  orgId: string,
  templateId: string,
): string => `${orgId}#${templateId}`;

/**
 * Build entitySK for FOIA requests
 */
export const buildFoiaRequestEntitySK = (
  orgId: string,
  projectId: string,
  foiaId: string,
): string => `${orgId}#${projectId}#${foiaId}`;

/**
 * Build entitySK for debriefing requests
 */
export const buildDebriefingRequestEntitySK = (
  orgId: string,
  projectId: string,
  debriefingId: string,
): string => `${orgId}#${projectId}#${debriefingId}`;