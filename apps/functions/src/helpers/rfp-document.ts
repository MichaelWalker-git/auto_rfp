import { PutCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { requireEnv } from './env';
import { docClient } from './db';
import { uploadToS3, loadTextFromS3 } from './s3';
import { PK_NAME, SK_NAME } from '../constants/common';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from '@/helpers/rfp-document-version';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Sort Key Builder ───
export function buildRFPDocumentSK(
  projectId: string,
  opportunityId: string,
  documentId: string,
): string {
  return `${projectId}#${opportunityId}#${documentId}`;
}

// ─── S3 Key Builder ───
export function buildRFPDocumentS3Key(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  version: number;
  fileName: string;
}): string {
  const sanitized = args.fileName.replace(/[\/\\]/g, '_');
  return `${args.orgId}/${args.projectId}/${args.opportunityId}/rfp-documents/${args.documentId}/v${args.version}/${sanitized}`;
}

// ─── Create ───
export async function putRFPDocument(item: Record<string, any>): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );
}

// ─── Get Single ───
export async function getRFPDocument(
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<Record<string, any> | null> {
  const sk = buildRFPDocumentSK(projectId, opportunityId, documentId);
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: RFP_DOCUMENT_PK,
        [SK_NAME]: sk,
      },
      ConsistentRead: true,
    }),
  );
  return Item ? (Item as Record<string, any>) : null;
}

// ─── List by Project (optionally filtered by Opportunity) ───
export async function listRFPDocumentsByProject(args: {
  projectId: string;
  opportunityId?: string;
  limit?: number;
  nextToken?: Record<string, any>;
}): Promise<{
  items: Record<string, any>[];
  nextToken: Record<string, any> | null;
}> {
  const skPrefix = args.opportunityId
    ? `${args.projectId}#${args.opportunityId}#`
    : `${args.projectId}#`;

  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'attribute_not_exists(#deletedAt) OR attribute_type(#deletedAt, :nullType)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
        '#deletedAt': 'deletedAt',
      },
      ExpressionAttributeValues: {
        ':pk': RFP_DOCUMENT_PK,
        ':skPrefix': skPrefix,
        ':nullType': 'NULL',
      },
      Limit: args.limit ?? 50,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );

  return {
    items: (res.Items ?? []) as Record<string, any>[],
    nextToken: (res.LastEvaluatedKey ?? null) as Record<string, any> | null,
  };
}

// ─── Update Metadata ───
export async function updateRFPDocumentMetadata(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  updates: {
    name?: string;
    description?: string | null;
    documentType?: string;
    content?: Record<string, any> | null;
    status?: string;
    title?: string | null;
    editHistory?: Record<string, any>[];
    /** S3 key for the HTML content — replaces storing HTML inline in DynamoDB */
    htmlContentKey?: string;
    generationError?: string;
    signatureStatus?: string;
  };
  updatedBy: string;
}): Promise<Record<string, any>> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  const setParts: string[] = ['#updatedAt = :now', '#updatedBy = :updatedBy'];
  const names: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#updatedBy': 'updatedBy',
  };
  const values: Record<string, any> = {
    ':now': now,
    ':updatedBy': args.updatedBy,
  };

  if (args.updates.name !== undefined) {
    setParts.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = args.updates.name;
  }
  if (args.updates.description !== undefined) {
    setParts.push('#description = :description');
    names['#description'] = 'description';
    values[':description'] = args.updates.description;
  }
  if (args.updates.documentType !== undefined) {
    setParts.push('#documentType = :documentType');
    names['#documentType'] = 'documentType';
    values[':documentType'] = args.updates.documentType;
  }
  if (args.updates.content !== undefined) {
    setParts.push('#content = :content');
    names['#content'] = 'content';
    values[':content'] = args.updates.content;
  }
  if (args.updates.status !== undefined) {
    setParts.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = args.updates.status;
  }
  if (args.updates.title !== undefined) {
    setParts.push('#title = :title');
    names['#title'] = 'title';
    values[':title'] = args.updates.title;
  }
  if (args.updates.editHistory !== undefined) {
    setParts.push('#editHistory = :editHistory');
    names['#editHistory'] = 'editHistory';
    values[':editHistory'] = args.updates.editHistory;
  }
  if (args.updates.htmlContentKey !== undefined) {
    setParts.push('#htmlContentKey = :htmlContentKey');
    names['#htmlContentKey'] = 'htmlContentKey';
    values[':htmlContentKey'] = args.updates.htmlContentKey;
  }
  if (args.updates.generationError !== undefined) {
    setParts.push('#generationError = :generationError');
    names['#generationError'] = 'generationError';
    values[':generationError'] = args.updates.generationError;
  }
  if (args.updates.signatureStatus !== undefined) {
    setParts.push('#signatureStatus = :signatureStatus');
    names['#signatureStatus'] = 'signatureStatus';
    values[':signatureStatus'] = args.updates.signatureStatus;
  }

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as Record<string, any>;
}

// ─── Soft Delete ───
export async function softDeleteRFPDocument(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  deletedBy: string;
}): Promise<void> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #deletedAt = :now, #updatedAt = :now, #updatedBy = :deletedBy',
      ExpressionAttributeNames: {
        '#deletedAt': 'deletedAt',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':deletedBy': args.deletedBy,
      },
    }),
  );
}

// ─── HTML Content S3 Key Builder ───
export function buildRFPDocumentHtmlKey(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}): string {
  return `${args.orgId}/${args.projectId}/${args.opportunityId}/rfp-documents/${args.documentId}/content.html`;
}

// ─── Upload HTML content to S3, return the S3 key ───
export async function uploadRFPDocumentHtml(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  html: string;
}): Promise<string> {
  const key = buildRFPDocumentHtmlKey(args);
  await uploadToS3(DOCUMENTS_BUCKET, key, args.html, 'text/html; charset=utf-8');
  return key;
}

// ─── Load HTML content from S3 ───
export async function loadRFPDocumentHtml(htmlContentKey: string): Promise<string> {
  return loadTextFromS3(DOCUMENTS_BUCKET, htmlContentKey);
}

// ─── Update Metadata with htmlContentKey (replaces storing HTML in DynamoDB) ───
export async function updateRFPDocumentHtmlKey(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  htmlContentKey: string;
  updatedBy: string;
}): Promise<Record<string, any>> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #htmlContentKey = :key, #updatedAt = :now, #updatedBy = :updatedBy',
      ExpressionAttributeNames: {
        '#htmlContentKey': 'htmlContentKey',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
      ExpressionAttributeValues: {
        ':key': args.htmlContentKey,
        ':now': now,
        ':updatedBy': args.updatedBy,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as Record<string, any>;
}

// ─── Update Linear Sync Status ───
export async function updateRFPDocumentLinearSync(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  linearSyncStatus: string;
  linearCommentId?: string;
}): Promise<void> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  const setParts: string[] = [
    '#linearSyncStatus = :syncStatus',
    '#lastSyncedAt = :now',
    '#updatedAt = :now',
  ];
  const names: Record<string, string> = {
    '#linearSyncStatus': 'linearSyncStatus',
    '#lastSyncedAt': 'lastSyncedAt',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, any> = {
    ':syncStatus': args.linearSyncStatus,
    ':now': now,
  };

  if (args.linearCommentId) {
    setParts.push('#linearCommentId = :commentId');
    names['#linearCommentId'] = 'linearCommentId';
    values[':commentId'] = args.linearCommentId;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

// ─── Update Document with Content (handles HTML upload to S3) ───
export async function updateRFPDocumentWithContent(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  dto: {
    name?: string;
    description?: string | null;
    documentType?: string;
    content?: Record<string, unknown> | null;
    status?: string;
    title?: string | null;
  };
  userId: string;
}): Promise<Record<string, any>> {
  const { orgId, projectId, opportunityId, documentId, dto, userId } = args;

  // Extract HTML from content payload and upload to S3
  let htmlContentKey: string | undefined;
  let contentForDb: Record<string, unknown> | null | undefined;

  if (dto.content !== undefined && dto.content !== null) {
    const incomingContent = dto.content;
    const htmlString = incomingContent.content as string | undefined;

    if (htmlString && typeof htmlString === 'string') {
      // Upload HTML to S3 — store only the key in DynamoDB
      htmlContentKey = await uploadRFPDocumentHtml({
        orgId,
        projectId,
        opportunityId,
        documentId,
        html: htmlString,
      });

      // Strip the HTML string — only metadata goes to DynamoDB, HTML lives in S3
      contentForDb = {
        title: incomingContent.title,
        customerName: incomingContent.customerName,
        opportunityId: incomingContent.opportunityId,
        outlineSummary: incomingContent.outlineSummary,
      };
    } else {
      // No HTML content provided, just store metadata
      contentForDb = {
        title: incomingContent.title,
        customerName: incomingContent.customerName,
        opportunityId: incomingContent.opportunityId,
        outlineSummary: incomingContent.outlineSummary,
      };
    }
  }

  const updates: Record<string, unknown> = {};
  if (dto.name !== undefined) updates.name = dto.name;
  if (dto.description !== undefined) updates.description = dto.description;
  if (dto.documentType !== undefined) updates.documentType = dto.documentType;
  if (contentForDb !== undefined) updates.content = contentForDb;
  if (htmlContentKey !== undefined) updates.htmlContentKey = htmlContentKey;
  if (dto.status !== undefined) updates.status = dto.status;
  if (dto.title !== undefined) updates.title = dto.title;

  // ── Create version snapshot when HTML content is saved ──
  if (htmlContentKey && dto.content) {
    try {
      // Get existing document for metadata
      const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);
      
      const latestVersionNum = await getLatestVersionNumber(projectId, opportunityId, documentId);
      const newVersionNumber = latestVersionNum + 1;
      const htmlContentStr = (dto.content.content as string) ?? '';

      // Save HTML to version-specific S3 location
      const versionHtmlKey = await saveVersionHtml(
        orgId,
        projectId,
        opportunityId,
        documentId,
        newVersionNumber,
        htmlContentStr,
      );

      // Create version metadata record in DynamoDB
      const versionId = uuidv4();
      await createVersion({
        versionId,
        documentId,
        projectId,
        opportunityId,
        orgId,
        versionNumber: newVersionNumber,
        htmlContentKey: versionHtmlKey,
        title: existingDoc?.title ?? existingDoc?.name ?? 'Untitled',
        documentType: existingDoc?.documentType ?? 'UNKNOWN',
        wordCount: htmlContentStr.split(/\s+/).length,
        changeNote: 'Content saved',
        createdBy: userId,
      });

      console.log(`Created version ${newVersionNumber} for document ${documentId}`);

    } catch (versionErr) {
      // Log but don't fail the save if version creation fails
      console.error('Failed to create version snapshot:', versionErr);
    }
  }

  return updateRFPDocumentMetadata({
    projectId,
    opportunityId,
    documentId,
    updates: updates as Parameters<typeof updateRFPDocumentMetadata>[0]['updates'],
    updatedBy: userId,
  });
}