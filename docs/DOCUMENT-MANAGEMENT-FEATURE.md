# RFP Document Management Feature — Technical Implementation Specification

## Overview

This document provides the complete technical implementation specification for a centralized RFP document management system within AutoRFP. It is based on the client request from Jhoan and covers:

1. A new "RFP Documents" section where users can upload and manage documents developed throughout the RFP process
2. Automatic synchronization of every document upload/update to Linear (as comments on the Executive Brief ticket)
3. In-app document preview and download via presigned URLs
4. Signature status tracking with optional Google Drive integration

This specification follows the exact patterns established in the existing codebase.

---

## Document Types in AutoRFP — Context

### Existing: Knowledge Base Document (`DOCUMENT` partition key)

These are company-wide reference materials stored in a Knowledge Base. They are indexed for AI semantic search (Pinecone vector embeddings) and used by the AI when generating proposals.

**Current schema** (`infrastructure/lambda/schemas/document.ts`):
```typescript
const DocumentItemSchema = z.object({
  [PK_NAME]: z.literal('DOCUMENT'),
  [SK_NAME]: z.string(), // "KB#<knowledgeBaseId>#DOC#<id>"
  id: z.string(),
  knowledgeBaseId: z.string(),
  name: z.string(),
  fileKey: z.string(),
  textFileKey: z.string(),
  indexStatus: z.enum(['pending', 'processing', 'ready', 'failed']),
  indexVectorKey: z.string().optional(),
  taskToken: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

**Scope:** Organization-level (shared across all projects).  
**CRUD lambdas:** `infrastructure/lambda/document/` (create, get, get-list, edit, delete, start-pipeline).  
**Routes:** `infrastructure/lib/api/routes/document.routes.ts` under `basePath: 'document'`.

### Existing: Question File (`QUESTION_FILE` partition key)

These are the actual RFP/solicitation documents uploaded for analysis. They go through Textract for text extraction and are used as input for Executive Brief generation.

**Current schema** (from `infrastructure/lambda/helpers/questionFile.ts`):
```typescript
// QuestionFileItem fields:
{
  [PK_NAME]: 'QUESTION_FILE',
  [SK_NAME]: `${projectId}#${oppId}#${questionFileId}`,
  orgId: string,
  projectId: string,
  oppId: string,
  questionFileId: string,
  fileKey: string,
  textFileKey: string | null,
  status: 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'CANCELLED',
  originalFileName: string | null,
  mimeType: string,
  sourceDocumentId: string | null,
  createdAt: string,
  updatedAt: string,
}
```

**Scope:** Per project + opportunity.  
**CRUD lambdas:** `infrastructure/lambda/question-file/`.  
**Routes:** `infrastructure/lib/api/routes/questionfile.routes.ts` under `basePath: 'questionfile'`.

### NEW: RFP Document (`RFP_DOCUMENT` partition key)

These are the working documents the team creates during the proposal response process (technical proposals, cost proposals, teaming agreements, NDAs, signed contracts). They have version control, signature tracking, Linear auto-sync, and in-app preview/download.

**Scope:** Per project + opportunity.  
**New lambdas:** `infrastructure/lambda/rfp-document/` (to be created).  
**New routes:** `infrastructure/lib/api/routes/rfp-document.routes.ts` (to be created).

---

## Part 1: Database Schema

### 1.1 New Constant File

**File:** `infrastructure/constants/rfp-document.js`

```javascript
module.exports.RFP_DOCUMENT_PK = 'RFP_DOCUMENT';
```

This follows the existing pattern used by `infrastructure/constants/question-file.js`, `infrastructure/constants/exec-brief.js`, etc.

### 1.2 New Shared Schema

**File:** `shared/src/schemas/rfp-document.ts`

```typescript
import { z } from 'zod';

// ─── Document Type Enum ───
export const RFPDocumentTypeSchema = z.enum([
  'EXECUTIVE_BRIEF',
  'TECHNICAL_PROPOSAL',
  'COST_PROPOSAL',
  'PAST_PERFORMANCE',
  'MANAGEMENT_APPROACH',
  'COMPLIANCE_MATRIX',
  'TEAMING_AGREEMENT',
  'NDA',
  'CONTRACT',
  'AMENDMENT',
  'CORRESPONDENCE',
  'OTHER',
]);
export type RFPDocumentType = z.infer<typeof RFPDocumentTypeSchema>;

// ─── Signature Status Enum ───
export const SignatureStatusSchema = z.enum([
  'NOT_REQUIRED',
  'PENDING_SIGNATURE',
  'PARTIALLY_SIGNED',
  'FULLY_SIGNED',
  'REJECTED',
]);
export type SignatureStatus = z.infer<typeof SignatureStatusSchema>;

// ─── Signer Status Enum ───
export const SignerStatusSchema = z.enum(['PENDING', 'SIGNED', 'REJECTED']);
export type SignerStatus = z.infer<typeof SignerStatusSchema>;

// ─── Signature Method Enum ───
export const SignatureMethodSchema = z.enum(['MANUAL', 'DRIVE', 'DOCUSIGN', 'ADOBE_SIGN']);
export type SignatureMethod = z.infer<typeof SignatureMethodSchema>;

// ─── Linear Sync Status Enum ───
export const LinearSyncStatusSchema = z.enum(['NOT_SYNCED', 'SYNCED', 'SYNC_FAILED']);
export type LinearSyncStatus = z.infer<typeof LinearSyncStatusSchema>;

// ─── Signer Schema ───
export const SignerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().min(1),
  status: SignerStatusSchema,
  signedAt: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type Signer = z.infer<typeof SignerSchema>;

// ─── Signature Details Schema ───
export const SignatureDetailsSchema = z.object({
  signers: z.array(SignerSchema).default([]),
  signatureMethod: SignatureMethodSchema.optional().nullable(),
  externalSignatureId: z.string().optional().nullable(),
  driveFileId: z.string().optional().nullable(),
  driveFileUrl: z.string().url().optional().nullable(),
  lastCheckedAt: z.string().datetime().optional().nullable(),
});
export type SignatureDetails = z.infer<typeof SignatureDetailsSchema>;

// ─── RFP Document Item (DynamoDB record) ───
export const RFPDocumentItemSchema = z.object({
  partition_key: z.literal('RFP_DOCUMENT'),
  sort_key: z.string(), // `${projectId}#${opportunityId}#${documentId}`

  documentId: z.string().uuid(),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  orgId: z.string().min(1),

  // Document metadata
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  documentType: RFPDocumentTypeSchema,
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().nonnegative(),
  originalFileName: z.string().optional().nullable(),

  // S3 storage
  fileKey: z.string().min(1),

  // Version tracking
  version: z.number().int().positive().default(1),
  previousVersionId: z.string().uuid().optional().nullable(),

  // Signature tracking
  signatureStatus: SignatureStatusSchema.default('NOT_REQUIRED'),
  signatureDetails: SignatureDetailsSchema.optional().nullable(),

  // Linear sync
  linearSyncStatus: LinearSyncStatusSchema.default('NOT_SYNCED'),
  linearCommentId: z.string().optional().nullable(),
  lastSyncedAt: z.string().datetime().optional().nullable(),

  // Soft delete
  deletedAt: z.string().datetime().optional().nullable(),

  // Audit
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RFPDocumentItem = z.infer<typeof RFPDocumentItemSchema>;

// ─── Create DTO ───
export const CreateRFPDocumentDTOSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  documentType: RFPDocumentTypeSchema,
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().nonnegative(),
  originalFileName: z.string().optional().nullable(),
});
export type CreateRFPDocumentDTO = z.infer<typeof CreateRFPDocumentDTOSchema>;

// ─── Update DTO ───
export const UpdateRFPDocumentDTOSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  documentType: RFPDocumentTypeSchema.optional(),
});
export type UpdateRFPDocumentDTO = z.infer<typeof UpdateRFPDocumentDTOSchema>;

// ─── Update Signature Status DTO ───
export const UpdateSignatureStatusDTOSchema = z.object({
  signatureStatus: SignatureStatusSchema,
  signatureDetails: SignatureDetailsSchema.optional().nullable(),
});
export type UpdateSignatureStatusDTO = z.infer<typeof UpdateSignatureStatusDTOSchema>;

// ─── Linear Sync Message (SQS payload) ───
export const LinearDocSyncMessageSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  orgId: z.string().min(1),
  action: z.enum(['CREATE', 'UPDATE', 'VERSION', 'SIGNATURE_UPDATE', 'DELETE']),
});
export type LinearDocSyncMessage = z.infer<typeof LinearDocSyncMessageSchema>;
```

### 1.3 Export from Shared Index

**File:** `shared/src/index.ts` — add the following export:

```typescript
export * from './schemas/rfp-document';
```

### 1.4 Sort Key Structure

The sort key follows the same pattern as Question Files:

```
${projectId}#${opportunityId}#${documentId}
```

This allows efficient DynamoDB queries:
- All documents for a project: `begins_with(SK, '${projectId}#')`
- All documents for an opportunity: `begins_with(SK, '${projectId}#${opportunityId}#')`
- Single document: exact match on `${projectId}#${opportunityId}#${documentId}`

### 1.5 S3 Key Structure

```
${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/v${version}/${sanitizedFileName}
```

Example:
```
org-abc123/proj-def456/opp-ghi789/rfp-documents/doc-jkl012/v1/Technical_Proposal.pdf
org-abc123/proj-def456/opp-ghi789/rfp-documents/doc-jkl012/v2/Technical_Proposal_v2.pdf
```

---

## Part 2: Backend Lambda Functions

### 2.1 Helper Functions

**File:** `infrastructure/lambda/helpers/rfp-document.ts`

```typescript
import { PutCommand, QueryCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import { requireEnv } from './env';
import { docClient } from './db';
import { nowIso } from './date';
import type { RFPDocumentItem, LinearDocSyncMessage } from '@auto-rfp/shared';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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
export async function putRFPDocument(item: RFPDocumentItem): Promise<void> {
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
): Promise<RFPDocumentItem | null> {
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
  return Item ? (Item as RFPDocumentItem) : null;
}

// ─── List by Opportunity ───
export async function listRFPDocumentsByOpportunity(args: {
  projectId: string;
  opportunityId: string;
  limit?: number;
  nextToken?: Record<string, any>;
  includeDeleted?: boolean;
}): Promise<{
  items: RFPDocumentItem[];
  nextToken: Record<string, any> | null;
}> {
  const skPrefix = `${args.projectId}#${args.opportunityId}#`;

  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      // Filter out soft-deleted unless includeDeleted is true
      ...(args.includeDeleted
        ? {}
        : {
            FilterExpression: 'attribute_not_exists(deletedAt) OR deletedAt = :null',
            ExpressionAttributeValues: {
              ':pk': RFP_DOCUMENT_PK,
              ':skPrefix': skPrefix,
              ':null': null,
            },
          }),
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': RFP_DOCUMENT_PK,
        ':skPrefix': skPrefix,
        ...(args.includeDeleted ? {} : { ':null': null }),
      },
      Limit: args.limit ?? 50,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );

  return {
    items: (res.Items ?? []) as RFPDocumentItem[],
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
}): Promise<RFPDocumentItem> {
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

  return res.Attributes as RFPDocumentItem;
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
}): Promise<RFPDocumentItem> {
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

  return res.Attributes as RFPDocumentItem;
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

// ─── Update Version (for new version upload) ───
export async function updateRFPDocumentVersion(args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  newVersion: number;
  newFileKey: string;
  newFileSizeBytes: number;
  previousVersionId: string;
  updatedBy: string;
}): Promise<RFPDocumentItem> {
  const sk = buildRFPDocumentSK(args.projectId, args.opportunityId, args.documentId);
  const now = nowIso();

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression:
        'SET #version = :version, #fileKey = :fileKey, #fileSizeBytes = :fileSize, ' +
        '#previousVersionId = :prevId, #updatedAt = :now, #updatedBy = :updatedBy',
      ExpressionAttributeNames: {
        '#version': 'version',
        '#fileKey': 'fileKey',
        '#fileSizeBytes': 'fileSizeBytes',
        '#previousVersionId': 'previousVersionId',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
      ExpressionAttributeValues: {
        ':version': args.newVersion,
        ':fileKey': args.newFileKey,
        ':fileSize': args.newFileSizeBytes,
        ':prevId': args.previousVersionId,
        ':now': now,
        ':updatedBy': args.updatedBy,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as RFPDocumentItem;
}
```

### 2.2 Linear Sync Queue Helper

**File:** `infrastructure/lambda/helpers/rfp-document-sync-queue.ts`

This follows the same pattern as `infrastructure/lambda/helpers/executive-brief-queue.ts`:

```typescript
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';
import type { LinearDocSyncMessage } from '@auto-rfp/shared';

const sqs = new SQSClient({});
const RFP_DOC_SYNC_QUEUE_URL = requireEnv('RFP_DOC_SYNC_QUEUE_URL');

export async function enqueueLinearDocSync(message: LinearDocSyncMessage): Promise<void> {
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: RFP_DOC_SYNC_QUEUE_URL,
        MessageBody: JSON.stringify(message),
        // Use documentId as deduplication group to serialize updates per document
        MessageGroupId: message.documentId,
      }),
    );
    console.log(`Enqueued Linear sync for document ${message.documentId}, action=${message.action}`);
  } catch (err) {
    // Log but don't fail the main operation
    console.error('Failed to enqueue Linear doc sync (non-fatal):', err);
  }
}
```

### 2.3 Linear Client Extension

**File:** `infrastructure/lambda/helpers/linear.ts` — add these functions to the existing file:

```typescript
// ─── NEW: Comment Operations ───

export async function createLinearComment(
  orgId: string,
  issueId: string,
  body: string,
): Promise<{ id: string }> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const commentPayload = await client.createComment({
    issueId,
    body,
  });

  const comment = await commentPayload.comment;
  if (!comment) {
    throw new Error('Failed to create Linear comment');
  }

  console.log(`Created Linear comment ${comment.id} on issue ${issueId}`);
  return { id: comment.id };
}

export async function updateLinearComment(
  orgId: string,
  commentId: string,
  body: string,
): Promise<void> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  await client.updateComment(commentId, { body });
  console.log(`Updated Linear comment ${commentId}`);
}
```

### 2.4 Lambda Functions

Each Lambda follows the exact pattern of existing handlers (middy middleware chain, Zod validation, apiResponse helper, withSentryLambda wrapper).

#### 2.4.1 Create RFP Document

**File:** `infrastructure/lambda/rfp-document/create-rfp-document.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { nowIso } from '../helpers/date';
import { putRFPDocument, buildRFPDocumentS3Key } from '../helpers/rfp-document';
import { enqueueLinearDocSync } from '../helpers/rfp-document-sync-queue';
import { CreateRFPDocumentDTOSchema } from '@auto-rfp/shared';
import { PK_NAME, SK_NAME } from '../constants/common';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const s3Client = new S3Client({ region: REGION });

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/plain',
  'text/markdown',
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const rawBody = JSON.parse(event.body);
    const { success, data, error } = CreateRFPDocumentDTOSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.has(data.mimeType)) {
      return apiResponse(400, {
        message: `Unsupported file type: ${data.mimeType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      });
    }

    // Validate file size
    if (data.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      return apiResponse(400, {
        message: `File too large: ${data.fileSizeBytes} bytes. Maximum: ${MAX_FILE_SIZE_BYTES} bytes (100 MB)`,
      });
    }

    const documentId = uuidv4();
    const now = nowIso();

    const fileKey = buildRFPDocumentS3Key({
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      documentId,
      version: 1,
      fileName: data.originalFileName || data.name,
    });

    // Generate presigned upload URL (same pattern as infrastructure/lambda/presigned/generate-presigned-url.ts)
    const putCmd = new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: fileKey,
      ContentType: data.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client as any, putCmd, { expiresIn: 900 }); // 15 min

    // Build DynamoDB item
    const sk = `${data.projectId}#${data.opportunityId}#${documentId}`;
    const item: any = {
      [PK_NAME]: RFP_DOCUMENT_PK,
      [SK_NAME]: sk,
      documentId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      orgId,
      name: data.name,
      description: data.description ?? null,
      documentType: data.documentType,
      mimeType: data.mimeType,
      fileSizeBytes: data.fileSizeBytes,
      originalFileName: data.originalFileName ?? null,
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
    };

    await putRFPDocument(item);

    // Enqueue Linear sync (non-blocking)
    await enqueueLinearDocSync({
      documentId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      orgId,
      action: 'CREATE',
    });

    return apiResponse(201, {
      ok: true,
      document: item,
      upload: {
        url: uploadUrl,
        method: 'PUT',
        bucket: DOCUMENTS_BUCKET,
        key: fileKey,
        expiresIn: 900,
      },
    });
  } catch (err) {
    console.error('Error in create-rfp-document:', err);
    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:create'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.2 List RFP Documents

**File:** `infrastructure/lambda/rfp-document/get-rfp-documents.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { listRFPDocumentsByOpportunity } from '../helpers/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const projectId = event.queryStringParameters?.projectId;
    const opportunityId = event.queryStringParameters?.opportunityId;

    if (!projectId || !opportunityId) {
      return apiResponse(400, { message: 'projectId and opportunityId are required' });
    }

    const limit = Math.min(Number(event.queryStringParameters?.limit || 50), 100);
    const nextToken = event.queryStringParameters?.nextToken
      ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString())
      : undefined;
    const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

    const result = await listRFPDocumentsByOpportunity({
      projectId,
      opportunityId,
      limit,
      nextToken,
      includeDeleted,
    });

    return apiResponse(200, {
      ok: true,
      items: result.items,
      nextToken: result.nextToken
        ? Buffer.from(JSON.stringify(result.nextToken)).toString('base64')
        : null,
      count: result.items.length,
    });
  } catch (err) {
    console.error('Error in get-rfp-documents:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.3 Get Single RFP Document

**File:** `infrastructure/lambda/rfp-document/get-rfp-document.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument } from '../helpers/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const projectId = event.queryStringParameters?.projectId;
    const opportunityId = event.queryStringParameters?.opportunityId;
    const documentId = event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const document = await getRFPDocument(projectId, opportunityId, documentId);

    if (!document || document.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }

    // Verify org ownership
    if (document.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    return apiResponse(200, { ok: true, document });
  } catch (err) {
    console.error('Error in get-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.4 Update RFP Document

**File:** `infrastructure/lambda/rfp-document/update-rfp-document.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument, updateRFPDocumentMetadata } from '../helpers/rfp-document';
import { enqueueLinearDocSync } from '../helpers/rfp-document-sync-queue';
import { UpdateRFPDocumentDTOSchema } from '@auto-rfp/shared';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const rawBody = JSON.parse(event.body);
    const projectId = rawBody.projectId || event.queryStringParameters?.projectId;
    const opportunityId = rawBody.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = rawBody.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    // Verify document exists and belongs to org
    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (existing.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    const { success, data, error } = UpdateRFPDocumentDTOSchema.safeParse(rawBody);
    if (!success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const updated = await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: data,
      updatedBy: userId,
    });

    // Enqueue Linear sync
    await enqueueLinearDocSync({
      documentId,
      projectId,
      opportunityId,
      orgId,
      action: 'UPDATE',
    });

    return apiResponse(200, { ok: true, document: updated });
  } catch (err) {
    console.error('Error in update-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:update'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.5 Delete RFP Document

**File:** `infrastructure/lambda/rfp-document/delete-rfp-document.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument, softDeleteRFPDocument } from '../helpers/rfp-document';
import { enqueueLinearDocSync } from '../helpers/rfp-document-sync-queue';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    const body = event.body ? JSON.parse(event.body) : {};
    const projectId = body.projectId || event.queryStringParameters?.projectId;
    const opportunityId = body.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = body.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (existing.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    await softDeleteRFPDocument({ projectId, opportunityId, documentId, deletedBy: userId });

    await enqueueLinearDocSync({
      documentId,
      projectId,
      opportunityId,
      orgId,
      action: 'DELETE',
    });

    return apiResponse(200, { ok: true, message: 'Document deleted' });
  } catch (err) {
    console.error('Error in delete-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:delete'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.6 Get Document Preview URL

**File:** `infrastructure/lambda/rfp-document/get-document-preview-url.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument } from '../helpers/rfp-document';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const s3Client = new S3Client({ region: REGION });
const URL_EXPIRATION_SECONDS = 3600; // 1 hour

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const body = event.body ? JSON.parse(event.body) : {};
    const projectId = body.projectId || event.queryStringParameters?.projectId;
    const opportunityId = body.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = body.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const document = await getRFPDocument(projectId, opportunityId, documentId);
    if (!document || document.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (document.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    const getCmd = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: document.fileKey,
      ResponseContentDisposition: 'inline',
      ResponseContentType: document.mimeType,
    });

    const url = await getSignedUrl(s3Client as any, getCmd, {
      expiresIn: URL_EXPIRATION_SECONDS,
    });

    return apiResponse(200, {
      ok: true,
      url,
      mimeType: document.mimeType,
      fileName: document.name,
      expiresIn: URL_EXPIRATION_SECONDS,
    });
  } catch (err) {
    console.error('Error in get-document-preview-url:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.7 Get Document Download URL

**File:** `infrastructure/lambda/rfp-document/get-document-download-url.ts`

Same as preview URL but with `ResponseContentDisposition: 'attachment; filename="${document.name}"'` instead of `'inline'`.

#### 2.4.8 Update Signature Status

**File:** `infrastructure/lambda/rfp-document/update-signature-status.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument, updateRFPDocumentSignatureStatus } from '../helpers/rfp-document';
import { enqueueLinearDocSync } from '../helpers/rfp-document-sync-queue';
import { UpdateSignatureStatusDTOSchema } from '@auto-rfp/shared';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  'NOT_REQUIRED': ['PENDING_SIGNATURE'],
  'PENDING_SIGNATURE': ['PARTIALLY_SIGNED', 'FULLY_SIGNED', 'REJECTED', 'NOT_REQUIRED'],
  'PARTIALLY_SIGNED': ['FULLY_SIGNED', 'REJECTED', 'PENDING_SIGNATURE'],
  'FULLY_SIGNED': ['PENDING_SIGNATURE'], // Allow re-opening if needed
  'REJECTED': ['PENDING_SIGNATURE', 'NOT_REQUIRED'],
};

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const rawBody = JSON.parse(event.body);
    const projectId = rawBody.projectId;
    const opportunityId = rawBody.opportunityId;
    const documentId = rawBody.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (existing.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    const { success, data, error } = UpdateSignatureStatusDTOSchema.safeParse(rawBody);
    if (!success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // Validate status transition
    const currentStatus = existing.signatureStatus || 'NOT_REQUIRED';
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(data.signatureStatus)) {
      return apiResponse(400, {
        message: `Invalid status transition: ${currentStatus} → ${data.signatureStatus}. Allowed: ${allowedTransitions.join(', ')}`,
      });
    }

    const updated = await updateRFPDocumentSignatureStatus({
      projectId,
      opportunityId,
      documentId,
      signatureStatus: data.signatureStatus,
      signatureDetails: data.signatureDetails,
      updatedBy: userId,
    });

    await enqueueLinearDocSync({
      documentId,
      projectId,
      opportunityId,
      orgId,
      action: 'SIGNATURE_UPDATE',
    });

    return apiResponse(200, { ok: true, document: updated });
  } catch (err) {
    console.error('Error in update-signature-status:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:update'))
    .use(httpErrorMiddleware()),
);
```

#### 2.4.9 Linear Sync Worker

**File:** `infrastructure/lambda/rfp-document/sync-document-to-linear.ts`

This is an SQS-triggered Lambda (not API Gateway), following the same pattern as `infrastructure/lambda/brief/exec-brief-worker.ts`:

```typescript
import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { LinearDocSyncMessageSchema } from '@auto-rfp/shared';
import { getRFPDocument, updateRFPDocumentLinearSync } from '../helpers/rfp-document';
import { getExecutiveBriefByProjectId } from '../helpers/executive-opportunity-brief';
import { createLinearComment, updateLinearComment } from '../helpers/linear';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireEnv } from '../helpers/env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const s3Client = new S3Client({ region: REGION });

function buildLinearCommentBody(doc: any, previewUrl: string, downloadUrl: string): string {
  const parts: string[] = [];

  const actionEmoji = doc.deletedAt ? '🗑️' : '📄';
  parts.push(`## ${actionEmoji} Document: ${doc.name}`);
  parts.push('');
  parts.push(`**Type:** ${doc.documentType}`);
  parts.push(`**Version:** v${doc.version}`);

  if (doc.signatureStatus && doc.signatureStatus !== 'NOT_REQUIRED') {
    const statusEmoji: Record<string, string> = {
      'PENDING_SIGNATURE': '⏳',
      'PARTIALLY_SIGNED': '✍️',
      'FULLY_SIGNED': '✅',
      'REJECTED': '❌',
    };
    parts.push(`**Signature:** ${statusEmoji[doc.signatureStatus] || ''} ${doc.signatureStatus}`);

    // List signers if available
    if (doc.signatureDetails?.signers?.length) {
      parts.push('');
      parts.push('**Signers:**');
      for (const signer of doc.signatureDetails.signers) {
        const signerEmoji = signer.status === 'SIGNED' ? '✅' : signer.status === 'REJECTED' ? '❌' : '⏳';
        parts.push(`- ${signerEmoji} ${signer.name} (${signer.role}) — ${signer.status}`);
      }
    }
  }

  parts.push(`**Updated:** ${doc.updatedAt}`);

  if (doc.description) {
    parts.push('');
    parts.push(doc.description);
  }

  if (!doc.deletedAt) {
    parts.push('');
    parts.push(`📎 [Preview Document](${previewUrl}) | [Download](${downloadUrl})`);
  } else {
    parts.push('');
    parts.push('*This document has been deleted.*');
  }

  parts.push('');
  parts.push('---');
  parts.push('*Auto-synced from AutoRFP*');

  return parts.join('\n');
}

async function generatePresignedUrls(fileKey: string, mimeType: string, fileName: string) {
  const previewCmd = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: fileKey,
    ResponseContentDisposition: 'inline',
    ResponseContentType: mimeType,
  });
  const downloadCmd = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: fileKey,
    ResponseContentDisposition: `attachment; filename="${fileName}"`,
    ResponseContentType: mimeType,
  });

  const [previewUrl, downloadUrl] = await Promise.all([
    getSignedUrl(s3Client as any, previewCmd, { expiresIn: 604800 }), // 7 days
    getSignedUrl(s3Client as any, downloadCmd, { expiresIn: 604800 }),
  ]);

  return { previewUrl, downloadUrl };
}

async function processMessage(record: any): Promise<void> {
  const message = LinearDocSyncMessageSchema.parse(JSON.parse(record.body));

  const doc = await getRFPDocument(message.projectId, message.opportunityId, message.documentId);
  if (!doc) {
    console.warn(`Document not found: ${message.documentId}, skipping sync`);
    return;
  }

  // Get the executive brief to find the Linear ticket
  let brief;
  try {
    brief = await getExecutiveBriefByProjectId(message.projectId, message.opportunityId);
  } catch {
    console.warn(`No executive brief found for project=${message.projectId}, opp=${message.opportunityId}. Skipping Linear sync.`);
    await updateRFPDocumentLinearSync({
      projectId: message.projectId,
      opportunityId: message.opportunityId,
      documentId: message.documentId,
      linearSyncStatus: 'SYNC_FAILED',
    });
    return;
  }

  if (!brief.linearTicketId) {
    console.warn(`Executive brief has no Linear ticket. Skipping sync for document ${message.documentId}`);
    return;
  }

  // Generate presigned URLs for the comment
  const { previewUrl, downloadUrl } = await generatePresignedUrls(
    doc.fileKey,
    doc.mimeType,
    doc.name,
  );

  const commentBody = buildLinearCommentBody(doc, previewUrl, downloadUrl);

  try {
    if (doc.linearCommentId && (message.action === 'UPDATE' || message.action === 'SIGNATURE_UPDATE' || message.action === 'DELETE')) {
      // Update existing comment
      await updateLinearComment(doc.orgId, doc.linearCommentId, commentBody);
    } else {
      // Create new comment
      const { id: commentId } = await createLinearComment(doc.orgId, brief.linearTicketId, commentBody);
      await updateRFPDocumentLinearSync({
        projectId: message.projectId,
        opportunityId: message.opportunityId,
        documentId: message.documentId,
        linearSyncStatus: 'SYNCED',
        linearCommentId: commentId,
      });
      return;
    }

    await updateRFPDocumentLinearSync({
      projectId: message.projectId,
      opportunityId: message.opportunityId,
      documentId: message.documentId,
      linearSyncStatus: 'SYNCED',
    });
  } catch (err) {
    console.error(`Failed to sync document ${message.documentId} to Linear:`, err);
    await updateRFPDocumentLinearSync({
      projectId: message.projectId,
      opportunityId: message.opportunityId,
      documentId: message.documentId,
      linearSyncStatus: 'SYNC_FAILED',
    });
    throw err; // Re-throw so SQS retries
  }
}

export const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      await processMessage(record);
    } catch (err) {
      console.error(`Failed to process SQS message ${record.messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
```

---

## Part 3: API Routes & CDK Integration

### 3.1 Route Definition

**File:** `infrastructure/lib/api/routes/rfp-document.routes.ts`

Following the exact pattern of `infrastructure/lib/api/routes/document.routes.ts`:

```typescript
import type { DomainRoutes } from './types';

export function rfpDocumentDomain(args: {
  rfpDocSyncQueueUrl: string;
}): DomainRoutes {
  const { rfpDocSyncQueueUrl } = args;

  return {
    basePath: 'rfp-document',
    routes: [
      {
        method: 'POST',
        path: 'create',
        entry: 'lambda/rfp-document/create-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: rfpDocSyncQueueUrl },
      },
      {
        method: 'GET',
        path: 'list',
        entry: 'lambda/rfp-document/get-rfp-documents.ts',
      },
      {
        method: 'GET',
        path: 'get',
        entry: 'lambda/rfp-document/get-rfp-document.ts',
      },
      {
        method: 'PATCH',
        path: 'update',
        entry: 'lambda/rfp-document/update-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: rfpDocSyncQueueUrl },
      },
      {
        method: 'DELETE',
        path: 'delete',
        entry: 'lambda/rfp-document/delete-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: rfpDocSyncQueueUrl },
      },
      {
        method: 'POST',
        path: 'preview-url',
        entry: 'lambda/rfp-document/get-document-preview-url.ts',
      },
      {
        method: 'POST',
        path: 'download-url',
        entry: 'lambda/rfp-document/get-document-download-url.ts',
      },
      {
        method: 'POST',
        path: 'update-signature',
        entry: 'lambda/rfp-document/update-signature-status.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: rfpDocSyncQueueUrl },
      },
    ],
  };
}
```

### 3.2 CDK Stack Changes

**File:** `infrastructure/lib/api/api-orchestrator-stack.ts` — add the following changes:

#### 3.2.1 Import the new route

```typescript
import { rfpDocumentDomain } from './routes/rfp-document.routes';
```

#### 3.2.2 Create the SQS queue (after `execBriefQueue` setup)

```typescript
// Create SQS queue for RFP Document → Linear sync
const rfpDocSyncQueue = new sqs.Queue(this, `RfpDocSyncQueue-${stage}`, {
  queueName: `auto-rfp-doc-linear-sync-${stage}.fifo`,
  fifo: true,
  contentBasedDeduplication: true,
  visibilityTimeout: cdk.Duration.seconds(60),
  retentionPeriod: cdk.Duration.days(7),
  deadLetterQueue: {
    queue: new sqs.Queue(this, `RfpDocSyncDLQ-${stage}`, {
      queueName: `auto-rfp-doc-linear-sync-dlq-${stage}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    }),
    maxReceiveCount: 3,
  },
});

rfpDocSyncQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);
```

#### 3.2.3 Create the sync worker Lambda (after `execBriefWorker`)

```typescript
// Create the RFP Document Linear sync worker Lambda
const rfpDocSyncWorker = new lambdaNodejs.NodejsFunction(this, `RfpDocSyncWorker-${stage}`, {
  functionName: `auto-rfp-doc-sync-worker-${stage}`,
  entry: path.join(__dirname, '../../lambda/rfp-document/sync-document-to-linear.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.seconds(60),
  memorySize: 512,
  role: sharedInfraStack.commonLambdaRole,
  environment: {
    ...commonEnv,
  },
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'],
  },
});

rfpDocSyncWorker.addEventSource(
  new lambdaEventSources.SqsEventSource(rfpDocSyncQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
  }),
);

rfpDocSyncQueue.grantConsumeMessages(rfpDocSyncWorker);
```

#### 3.2.4 Add the route nested stack (alongside other domain stacks)

```typescript
new ApiDomainRoutesStack(this, 'RfpDocumentRoutes', {
  api: this.api,
  rootResourceId: this.rootResourceId,
  userPoolId: userPool.userPoolId,
  lambdaRole: sharedInfraStack.commonLambdaRole,
  commonEnv: sharedInfraStack.commonEnv,
  domain: rfpDocumentDomain({ rfpDocSyncQueueUrl: rfpDocSyncQueue.queueUrl }),
  authorizer,
});
```

---

## Part 4: Frontend Implementation

### 4.1 React Hooks

**File:** `web-app/lib/hooks/use-rfp-documents.ts`

Following the exact pattern of `web-app/lib/hooks/use-executive-brief.ts`:

```typescript
'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  RFPDocumentItem,
  CreateRFPDocumentDTO,
  UpdateRFPDocumentDTO,
  UpdateSignatureStatusDTO,
} from '@auto-rfp/shared';

// ─── Types ───

interface RFPDocumentsListResponse {
  ok: boolean;
  items: RFPDocumentItem[];
  nextToken: string | null;
  count: number;
}

interface RFPDocumentResponse {
  ok: boolean;
  document: RFPDocumentItem;
}

interface CreateRFPDocumentResponse {
  ok: boolean;
  document: RFPDocumentItem;
  upload: {
    url: string;
    method: string;
    bucket: string;
    key: string;
    expiresIn: number;
  };
}

interface PresignedUrlResponse {
  ok: boolean;
  url: string;
  mimeType: string;
  fileName: string;
  expiresIn: number;
}

// ─── Helpers ───

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }
  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;
  try { return JSON.parse(raw) as T; } catch { return { ok: true } as T; }
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

async function deleteJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

const BASE = `${env.BASE_API_URL}/rfp-document`;

// ─── Hooks ───

/** List all RFP documents for an opportunity */
export function useRFPDocuments(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
) {
  const key = projectId && opportunityId && orgId
    ? `${BASE}/list?projectId=${projectId}&opportunityId=${opportunityId}&orgId=${orgId}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<RFPDocumentsListResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch documents');
      return res.json();
    },
  );

  return {
    documents: data?.items ?? [],
    count: data?.count ?? 0,
    nextToken: data?.nextToken ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/** Create a new RFP document (returns presigned upload URL) */
export function useCreateRFPDocument(orgId?: string) {
  return useSWRMutation<CreateRFPDocumentResponse, Error, string, CreateRFPDocumentDTO>(
    `${BASE}/create${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<CreateRFPDocumentResponse>(url, arg),
  );
}

/** Update RFP document metadata */
export function useUpdateRFPDocument(orgId?: string) {
  return useSWRMutation<RFPDocumentResponse, Error, string, UpdateRFPDocumentDTO & {
    projectId: string;
    opportunityId: string;
    documentId: string;
  }>(
    `${BASE}/update${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => patchJson<RFPDocumentResponse>(url, arg),
  );
}

/** Delete RFP document */
export function useDeleteRFPDocument(orgId?: string) {
  return useSWRMutation<{ ok: boolean }, Error, string, {
    projectId: string;
    opportunityId: string;
    documentId: string;
  }>(
    `${BASE}/delete${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => deleteJson<{ ok: boolean }>(url, arg),
  );
}

/** Get preview URL for a document */
export function useDocumentPreviewUrl(orgId?: string) {
  return useSWRMutation<PresignedUrlResponse, Error, string, {
    projectId: string;
    opportunityId: string;
    documentId: string;
  }>(
    `${BASE}/preview-url${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<PresignedUrlResponse>(url, arg),
  );
}

/** Get download URL for a document */
export function useDocumentDownloadUrl(orgId?: string) {
  return useSWRMutation<PresignedUrlResponse, Error, string, {
    projectId: string;
    opportunityId: string;
    documentId: string;
  }>(
    `${BASE}/download-url${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<PresignedUrlResponse>(url, arg),
  );
}

/** Update signature status */
export function useUpdateSignatureStatus(orgId?: string) {
  return useSWRMutation<RFPDocumentResponse, Error, string, UpdateSignatureStatusDTO & {
    projectId: string;
    opportunityId: string;
    documentId: string;
  }>(
    `${BASE}/update-signature${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<RFPDocumentResponse>(url, arg),
  );
}

/** Upload file to S3 using presigned URL */
export async function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}
```

### 4.2 Integration into Executive Brief View

The RFP Documents section should be added as a new tab in the `ExecutiveBriefView.tsx` component, following the existing tab pattern:

**File:** `web-app/components/brief/ExecutiveBriefView.tsx` — add to the `TABS` array:

```typescript
{ id: 'documents', label: 'Documents', icon: FolderOpen, section: null },
```

And add the corresponding `TabsContent`:

```typescript
<TabsContent value="documents" className="space-y-6 mt-6">
  <RFPDocumentsSection
    projectId={projectId}
    opportunityId={selectedOpportunityId!}
    orgId={currentOrganization?.id ?? ''}
  />
</TabsContent>
```

### 4.3 Frontend Component Structure

```
web-app/components/rfp-documents/
├── RFPDocumentsSection.tsx       # Main container (Card with header + upload button + list)
├── DocumentList.tsx              # Grid/list of DocumentCard components
├── DocumentCard.tsx              # Single document card with actions
├── DocumentUploadDialog.tsx      # Modal: file drop zone + metadata form
├── DocumentPreviewDialog.tsx     # Modal: PDF/image/text viewer
├── SignatureStatusBadge.tsx      # Color-coded badge component
├── SignatureTrackerPanel.tsx     # Signer list + status management
└── LinearSyncIndicator.tsx       # Small icon showing sync status
```

Each component uses Shadcn UI components (`Card`, `Dialog`, `Badge`, `Button`, `Input`, `Select`, `Tabs`) consistent with the existing codebase.

---

## Part 5: Signature Tracking — Google Drive Integration (Optional/Future)

### 5.1 Flow

1. User clicks "Upload to Drive" on a document in AutoRFP
2. Lambda fetches file from S3, uploads to Google Drive via service account
3. Drive file URL and ID stored in `signatureDetails.driveFileId` / `driveFileUrl`
4. User shares the Drive file with signers externally
5. User clicks "Sync from Drive" to check for updates
6. Lambda compares Drive file modification date with last sync
7. If changed, downloads new version from Drive, uploads to S3 as new version
8. Updates signature status and triggers Linear sync

### 5.2 Required Infrastructure

- Google Cloud project with Drive API enabled
- Service account with Drive API access
- Service account credentials stored in AWS Secrets Manager
- Two new Lambda functions: `upload-to-drive.ts` and `sync-from-drive.ts`
- NPM dependency: `googleapis`

### 5.3 New Lambda Endpoints

```typescript
// In rfp-document.routes.ts, add:
{
  method: 'POST',
  path: 'upload-to-drive',
  entry: 'lambda/rfp-document/upload-to-drive.ts',
  timeoutSeconds: 60,
},
{
  method: 'POST',
  path: 'sync-from-drive',
  entry: 'lambda/rfp-document/sync-from-drive.ts',
  timeoutSeconds: 60,
},
```

---

## Part 6: Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js)                             │
│                                                                          │
│  ExecutiveBriefView                                                      │
│  ├── Overview Tab                                                        │
│  ├── Deadlines Tab                                                       │
│  ├── Requirements Tab                                                    │
│  ├── ...                                                                 │
│  └── Documents Tab (NEW)                                                 │
│      └── RFPDocumentsSection                                             │
│          ├── DocumentUploadDialog → POST /rfp-document/create            │
│          ├── DocumentList                                                │
│          │   └── DocumentCard                                            │
│          │       ├── Preview → POST /rfp-document/preview-url            │
│          │       ├── Download → POST /rfp-document/download-url          │
│          │       ├── Edit → PATCH /rfp-document/update                   │
│          │       ├── Delete → DELETE /rfp-document/delete                │
│          │       └── Signature → POST /rfp-document/update-signature     │
│          └── DocumentPreviewDialog (PDF.js / Image / Text viewer)        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (REST API)                              │
│  /rfp-document/create    → create-rfp-document Lambda                    │
│  /rfp-document/list      → get-rfp-documents Lambda                     │
│  /rfp-document/get       → get-rfp-document Lambda                      │
│  /rfp-document/update    → update-rfp-document Lambda                   │
│  /rfp-document/delete    → delete-rfp-document Lambda                   │
│  /rfp-document/preview-url → get-document-preview-url Lambda            │
│  /rfp-document/download-url → get-document-download-url Lambda          │
│  /rfp-document/update-signature → update-signature-status Lambda        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────┐    ┌──────────┐    ┌──────────────────┐
            │ DynamoDB  │    │    S3    │    │   SQS Queue      │
            │ (main     │    │ (docs   │    │ (rfp-doc-linear  │
            │  table)   │    │  bucket)│    │  -sync.fifo)     │
            │           │    │         │    └────────┬─────────┘
            │ PK: RFP_  │    │ orgId/  │             │
            │ DOCUMENT  │    │ projId/ │             ▼
            │ SK: proj# │    │ oppId/  │    ┌──────────────────┐
            │ opp#docId │    │ rfp-doc/│    │ sync-document-   │
            └──────────┘    │ docId/  │    │ to-linear Lambda │
                            │ v1/file │    └────────┬─────────┘
                            └─────────┘             │
                                                    ▼
                                            ┌──────────────────┐
                                            │   Linear API     │
                                            │ (create/update   │
                                            │  comment on      │
                                            │  Brief ticket)   │
                                            └──────────────────┘
```
