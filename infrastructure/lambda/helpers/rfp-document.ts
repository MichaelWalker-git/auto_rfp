import { PutCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const { PK_NAME, SK_NAME } = require('../../constants/common');
const { RFP_DOCUMENT_PK } = require('../../constants/rfp-document');
const { requireEnv } = require('./env');
const { docClient } = require('./db');

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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

// ─── List by Project ───
export async function listRFPDocumentsByProject(args: {
  projectId: string;
  limit?: number;
  nextToken?: Record<string, any>;
}): Promise<{
  items: Record<string, any>[];
  nextToken: Record<string, any> | null;
}> {
  const skPrefix = `${args.projectId}#`;

  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'attribute_not_exists(deletedAt) OR deletedAt = :null',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': RFP_DOCUMENT_PK,
        ':skPrefix': skPrefix,
        ':null': null,
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

// ─── Update Signature Status ───
export async function updateRFPDocumentSignatureStatus(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  signatureStatus: string;
  signatureDetails?: any;
  updatedBy: string;
}): Promise<Record<string, any>> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  const setParts: string[] = [
    '#signatureStatus = :signatureStatus',
    '#updatedAt = :now',
    '#updatedBy = :updatedBy',
  ];
  const names: Record<string, string> = {
    '#signatureStatus': 'signatureStatus',
    '#updatedAt': 'updatedAt',
    '#updatedBy': 'updatedBy',
  };
  const values: Record<string, any> = {
    ':signatureStatus': args.signatureStatus,
    ':now': now,
    ':updatedBy': args.updatedBy,
  };

  if (args.signatureDetails !== undefined) {
    setParts.push('#signatureDetails = :signatureDetails');
    names['#signatureDetails'] = 'signatureDetails';
    values[':signatureDetails'] = args.signatureDetails;
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