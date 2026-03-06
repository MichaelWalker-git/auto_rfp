# Version Comparison Tool — Implementation Guide

> Side-by-side comparison of RFP proposal document versions with diff highlighting. Track changes and facilitate the review process.

---

## 1. Overview <!-- ⏳ PENDING -->

| Field | Value |
|-------|-------|
| **Feature** | Proposal Version Comparison Tool |
| **Priority** | P2 — Quality Control |
| **Estimated Hours** | 10 hours |
| **Domains** | rfp-document |
| **Main Entities** | RFPDocumentVersion, VersionDiff |

### Business Context

- RFP proposals (Technical Proposal, Executive Summary, etc.) go through multiple revisions
- Teams need to track what changed between document versions
- Review process requires comparing HTML content side-by-side
- Ability to revert to previous versions is critical for quality control

### Key Features

1. **Version Snapshot Storage** — Automatic snapshots of proposal HTML content on each save
2. **Diff View** — Side-by-side comparison with color-coded HTML changes
3. **Change Tracking** — Visual indicators for added, removed, and modified content
4. **Revert Capability** — Restore any previous version of a proposal document
5. **Cherry-Pick Changes** — Select specific changes from an older version to apply to current
6. **Line-by-Line Navigation** — Jump between changes with prev/next navigation controls

### Current State Analysis

The existing `RFPDocumentItem` schema already has:
- `version: number` — Current version number
- `previousVersionId: string` — Link to previous version (not yet fully utilized)
- `editHistory: EditHistoryEntry[]` — Tracks who edited and when
- `htmlContentKey: string` — S3 key for HTML content (versioned path: `v${version}/`)

**Gap**: While version numbers and edit history exist, the system doesn't store full snapshots of previous versions' HTML content, making comparison and revert impossible.

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

### Architecture Decision: S3 Versioning + DynamoDB Metadata

**Recommended approach**: Leverage S3 bucket versioning (already enabled) + store version metadata in DynamoDB

**Reasoning**:
1. **S3 versioning is already enabled** — The `documentsBucket` has versioning enabled in `storage-stack.ts`
2. **No additional S3 cost** — Versions are stored automatically, just need to track S3 version IDs
3. **Large HTML documents** — Proposals can be 50KB+ HTML, better suited for S3 than DynamoDB
4. **Existing pattern** — `htmlContentKey` pattern already stores HTML in S3
5. **Efficient diff** — Load only the versions needed for comparison

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Frontend (Next.js)                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐    │
│  │VersionHistory  │  │VersionDiffView │  │ RevertConfirmDialog    │    │
│  │ Panel          │  │ (Split Pane)   │  │                        │    │
│  └────────────────┘  └────────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       API Gateway (REST)                               │
│  GET /rfp-document/versions    GET /rfp-document/compare               │
│  POST /rfp-document/revert     GET /rfp-document/version-content       │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Lambda Handlers                                 │
│  get-versions.ts    compare-versions.ts    revert-version.ts           │
│  get-version-content.ts                                                │
└─────────────────────────────────────────────────────────────────────────┘
                  │                                    │
                  ▼                                    ▼
┌─────────────────────────────────┐    ┌──────────────────────────────────┐
│      DynamoDB (Single Table)    │    │         S3 (Documents Bucket)   │
│  PK: RFP_DOCUMENT_VERSION       │    │   - HTML content per version    │
│  SK: {projectId}#...#{version}  │    │   - S3 versioning enabled       │
│  Stores: metadata, s3VersionId  │    │   - Load by versionId           │
└─────────────────────────────────┘    └──────────────────────────────────┘
```

### Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Version Storage | S3 versioning + DynamoDB metadata | Leverages existing S3 versioning; HTML too large for DynamoDB |
| Diff Algorithm | Client-side (diff-match-patch or html-diff) | Reduces Lambda compute; instant UI feedback |
| Version Creation | On explicit save (not auto-save) | Avoids version explosion; meaningful snapshots |
| Retention | S3 lifecycle rule (90 days, keep 10 versions) | Already configured in storage-stack.ts |

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

### File: `packages/core/src/schemas/rfp-document-version.ts`

```typescript
import { z } from 'zod';

// ─── RFP Document Version ─────────────────────────────────────────────────────

/**
 * A snapshot of an RFP document at a specific version.
 * Metadata stored in DynamoDB; actual HTML content stored in S3.
 */
export const RFPDocumentVersionSchema = z.object({
  versionId: z.string().uuid(),              // Unique ID for this version record
  documentId: z.string().uuid(),             // Parent RFP document ID
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  orgId: z.string().uuid(),
  versionNumber: z.number().int().min(1),    // Sequential version number (1, 2, 3...)
  
  // S3 reference
  htmlContentKey: z.string(),                // S3 key for HTML content
  s3VersionId: z.string().optional(),        // S3 version ID (if using S3 versioning)
  
  // Snapshot metadata
  title: z.string().nullable().optional(),
  documentType: z.string(),                  // e.g., 'TECHNICAL_PROPOSAL'
  wordCount: z.number().int().optional(),    // For quick stats display
  
  // Change tracking
  changeNote: z.string().max(500).optional(), // User-provided description of changes
  createdBy: z.string().uuid(),
  createdByName: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type RFPDocumentVersion = z.infer<typeof RFPDocumentVersionSchema>;

// ─── Create Version DTO ───────────────────────────────────────────────────────

export const CreateVersionDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  changeNote: z.string().max(500).optional(),
});

export type CreateVersionDTO = z.infer<typeof CreateVersionDTOSchema>;

// ─── Version List Response ────────────────────────────────────────────────────

export const VersionListResponseSchema = z.object({
  items: z.array(RFPDocumentVersionSchema),
  count: z.number(),
});

export type VersionListResponse = z.infer<typeof VersionListResponseSchema>;

// ─── Version Comparison Request ───────────────────────────────────────────────

export const CompareVersionsRequestSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  fromVersion: z.number().int().min(1),      // Older version
  toVersion: z.number().int().min(1),        // Newer version
});

export type CompareVersionsRequest = z.infer<typeof CompareVersionsRequestSchema>;

// ─── Version Comparison Response ──────────────────────────────────────────────

export const VersionComparisonResponseSchema = z.object({
  fromVersion: RFPDocumentVersionSchema,
  toVersion: RFPDocumentVersionSchema,
  fromHtml: z.string(),                      // Raw HTML of older version
  toHtml: z.string(),                        // Raw HTML of newer version
  // Diff computed client-side for performance
});

export type VersionComparisonResponse = z.infer<typeof VersionComparisonResponseSchema>;

// ─── Revert Version DTO ───────────────────────────────────────────────────────

export const RevertVersionDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  targetVersion: z.number().int().min(1),    // Version to revert to
  changeNote: z.string().max(500).optional(),
});

export type RevertVersionDTO = z.infer<typeof RevertVersionDTOSchema>;

// ─── Cherry-Pick Changes DTO ──────────────────────────────────────────────────

/**
 * Cherry-pick allows applying selected changes from one version to the current.
 * The changes array contains indices of diff hunks to apply.
 * This is computed client-side using the diff algorithm.
 */
export const CherryPickDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  sourceVersion: z.number().int().min(1),    // Version to cherry-pick from
  /** 
   * Array of change indices to apply. 
   * These correspond to the diff hunks computed client-side.
   * The server receives the final merged HTML directly.
   */
  mergedHtml: z.string(),                    // Final HTML after cherry-picking
  changeNote: z.string().max(500).optional(),
});

export type CherryPickDTO = z.infer<typeof CherryPickDTOSchema>;

// ─── Diff Hunk (for client-side diff display) ─────────────────────────────────

/**
 * Represents a single change (hunk) in the diff.
 * Used by the frontend for line-by-line navigation.
 */
export const DiffHunkSchema = z.object({
  index: z.number().int(),                   // Unique index for this hunk
  type: z.enum(['added', 'removed', 'modified']),
  fromLineStart: z.number().int().optional(), // Line number in "from" version
  fromLineEnd: z.number().int().optional(),
  toLineStart: z.number().int().optional(),   // Line number in "to" version
  toLineEnd: z.number().int().optional(),
  fromContent: z.string().optional(),         // Content in older version
  toContent: z.string().optional(),           // Content in newer version
});

export type DiffHunk = z.infer<typeof DiffHunkSchema>;
```

### Export from `packages/core/src/schemas/index.ts`

Add this line:
```typescript
export * from './rfp-document-version';
```

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

### PK Constants

**File**: `apps/functions/src/constants/rfp-document-version.ts`

```typescript
export const RFP_DOCUMENT_VERSION_PK = 'RFP_DOCUMENT_VERSION';
```

### Access Patterns

| Access Pattern | PK | SK | Notes |
|----------------|----|----|-------|
| List versions for document | `RFP_DOCUMENT_VERSION` | `{projectId}#{opportunityId}#{documentId}#` prefix | Query by document |
| Get specific version | `RFP_DOCUMENT_VERSION` | `{projectId}#{opportunityId}#{documentId}#{versionNumber}` | Direct lookup |
| List all versions in project | `RFP_DOCUMENT_VERSION` | `{projectId}#` prefix | For project-level audit |

### SK Builder Functions

**File**: `apps/functions/src/helpers/rfp-document-version.ts`

```typescript
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_VERSION_PK } from '@/constants/rfp-document-version';
import { createItem, queryBySkPrefix, getItem } from '@/helpers/db';
import { loadTextFromS3, uploadToS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import type { RFPDocumentVersion } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── SK Builders ───────────────────────────────────────────────────────────────

export const buildVersionSK = (
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): string => {
  return `${projectId}#${opportunityId}#${documentId}#${String(versionNumber).padStart(6, '0')}`;
};

export const buildVersionPrefix = (
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => {
  return `${projectId}#${opportunityId}#${documentId}#`;
};

// ─── S3 Key Builder ────────────────────────────────────────────────────────────

export const buildVersionHtmlKey = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): string => {
  return `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/versions/v${versionNumber}.html`;
};

// ─── CRUD Operations ───────────────────────────────────────────────────────────

export const createVersion = async (
  version: Omit<RFPDocumentVersion, 'createdAt'>,
): Promise<RFPDocumentVersion> => {
  const sk = buildVersionSK(
    version.projectId,
    version.opportunityId,
    version.documentId,
    version.versionNumber,
  );
  return createItem<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, sk, version);
};

export const listVersions = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<RFPDocumentVersion[]> => {
  const prefix = buildVersionPrefix(projectId, opportunityId, documentId);
  const items = await queryBySkPrefix<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, prefix);
  // Sort by version number descending (newest first)
  return items.sort((a, b) => b.versionNumber - a.versionNumber);
};

export const getVersion = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): Promise<RFPDocumentVersion | null> => {
  const sk = buildVersionSK(projectId, opportunityId, documentId, versionNumber);
  return getItem<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, sk);
};

export const getLatestVersionNumber = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<number> => {
  const versions = await listVersions(projectId, opportunityId, documentId);
  return versions.length > 0 ? versions[0].versionNumber : 0;
};

// ─── S3 Operations ─────────────────────────────────────────────────────────────

export const saveVersionHtml = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
  html: string,
): Promise<string> => {
  const key = buildVersionHtmlKey(orgId, projectId, opportunityId, documentId, versionNumber);
  await uploadToS3(DOCUMENTS_BUCKET, key, html, 'text/html; charset=utf-8');
  return key;
};

export const loadVersionHtml = async (htmlContentKey: string): Promise<string> => {
  return loadTextFromS3(DOCUMENTS_BUCKET, htmlContentKey);
};
```

---

## 5. REST API Routes <!-- ⏳ PENDING -->

### API Endpoints Summary

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/rfp-document/versions` | `get-versions.ts` | List all versions for a document |
| GET | `/rfp-document/compare` | `compare-versions.ts` | Get two versions' HTML for diff |
| POST | `/rfp-document/revert` | `revert-version.ts` | Revert to a previous version |
| POST | `/rfp-document/cherry-pick` | `cherry-pick-version.ts` | Apply cherry-picked changes |

### Routes File: `packages/infra/api/routes/rfp-document.routes.ts`

Add the following routes to the existing `rfpDocumentDomain()`:

```typescript
// Version comparison routes
{ method: 'GET',  path: 'versions',    entry: lambdaEntry('rfp-document/get-versions.ts') },
{ method: 'GET',  path: 'compare',     entry: lambdaEntry('rfp-document/compare-versions.ts') },
{ method: 'POST', path: 'revert',      entry: lambdaEntry('rfp-document/revert-version.ts') },
{ method: 'POST', path: 'cherry-pick', entry: lambdaEntry('rfp-document/cherry-pick-version.ts') },
```

---

## 6. Backend — Lambda Handlers <!-- ⏳ PENDING -->

### File Structure

```
apps/functions/src/handlers/rfp-document/
├── get-versions.ts           # List all versions for a document
├── compare-versions.ts       # Get two versions with HTML for comparison
├── revert-version.ts         # Create new version from old version's content
└── cherry-pick-version.ts    # Apply cherry-picked changes as new version
```

### 6.1 GET /rfp-document/versions — `get-versions.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { listVersions } from '@/helpers/rfp-document-version';
import { getRFPDocument } from '@/helpers/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!opportunityId) return apiResponse(400, { message: 'opportunityId is required' });
  if (!documentId) return apiResponse(400, { message: 'documentId is required' });

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(projectId, opportunityId, documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  const versions = await listVersions(projectId, opportunityId, documentId);

  return apiResponse(200, { items: versions, count: versions.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 6.2 GET /rfp-document/compare — `compare-versions.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getVersion, loadVersionHtml } from '@/helpers/rfp-document-version';
import { getRFPDocument } from '@/helpers/rfp-document';
import { CompareVersionsRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { projectId, opportunityId, documentId, fromVersion, toVersion } = 
    event.queryStringParameters ?? {};

  const { success, data, error } = CompareVersionsRequestSchema.safeParse({
    documentId,
    projectId,
    opportunityId,
    fromVersion: fromVersion ? parseInt(fromVersion, 10) : undefined,
    toVersion: toVersion ? parseInt(toVersion, 10) : undefined,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request', issues: error.issues });
  }

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  // Fetch both versions in parallel
  const [fromVer, toVer] = await Promise.all([
    getVersion(data.projectId, data.opportunityId, data.documentId, data.fromVersion),
    getVersion(data.projectId, data.opportunityId, data.documentId, data.toVersion),
  ]);

  if (!fromVer) return apiResponse(404, { message: `Version ${data.fromVersion} not found` });
  if (!toVer) return apiResponse(404, { message: `Version ${data.toVersion} not found` });

  // Load HTML content from S3 in parallel
  const [fromHtml, toHtml] = await Promise.all([
    loadVersionHtml(fromVer.htmlContentKey),
    loadVersionHtml(toVer.htmlContentKey),
  ]);

  return apiResponse(200, {
    fromVersion: fromVer,
    toVersion: toVer,
    fromHtml,
    toHtml,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 6.3 POST /rfp-document/cherry-pick — `cherry-pick-version.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId, getUserName } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { v4 as uuidv4 } from 'uuid';
import {
  saveVersionHtml,
  createVersion,
  getLatestVersionNumber,
} from '@/helpers/rfp-document-version';
import { getRFPDocument, updateRFPDocumentMetadata, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { CherryPickDTOSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event);
  if (!userId) return apiResponse(401, { message: 'User not authenticated' });
  const userName = getUserName(event);

  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  const { success, data, error } = CherryPickDTOSchema.safeParse(JSON.parse(event.body));
  if (!success) {
    return apiResponse(400, { message: 'Invalid request', issues: error.issues });
  }

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  // Create new version number
  const latestVersionNum = await getLatestVersionNumber(
    data.projectId,
    data.opportunityId,
    data.documentId,
  );
  const newVersionNumber = latestVersionNum + 1;

  // Save the merged HTML (cherry-picked result) to new version location
  const newHtmlKey = await saveVersionHtml(
    orgId,
    data.projectId,
    data.opportunityId,
    data.documentId,
    newVersionNumber,
    data.mergedHtml,
  );

  // Create version record
  const newVersion = await createVersion({
    versionId: uuidv4(),
    documentId: data.documentId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    orgId,
    versionNumber: newVersionNumber,
    htmlContentKey: newHtmlKey,
    title: doc.title,
    documentType: doc.documentType,
    changeNote: data.changeNote || `Cherry-picked changes from version ${data.sourceVersion}`,
    createdBy: userId,
    createdByName: userName,
  });

  // Update the main document with the merged HTML
  await uploadRFPDocumentHtml({
    orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    html: data.mergedHtml,
  });

  await updateRFPDocumentMetadata({
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    updates: {
      editHistory: [
        ...(doc.editHistory || []),
        {
          editedBy: userId,
          editedByName: userName,
          editedAt: new Date().toISOString(),
          action: 'CONTENT_EDIT',
          changeNote: data.changeNote || `Cherry-picked from v${data.sourceVersion}`,
          version: newVersionNumber,
        },
      ],
    },
    updatedBy: userId,
  });

  return apiResponse(200, { ok: true, version: newVersion });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
```

---

## 7. Frontend — Hook & Components <!-- ⏳ PENDING -->

### 7.1 Combined Hook File

**File**: `apps/web/lib/hooks/use-document-versions.ts`

Following the project pattern (see `use-clustering.ts`), all version-related hooks and helpers are combined into a single file:

```typescript
'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  RFPDocumentVersion,
  VersionListResponse,
  VersionComparisonResponse,
  RevertVersionDTO,
  CherryPickDTO,
  DiffHunk,
} from '@auto-rfp/core';

// ---------- Fetchers ----------

const fetchVersions = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<VersionListResponse> => {
  const params = new URLSearchParams({
    projectId,
    opportunityId,
    documentId,
  });
  
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/versions?${params}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(raw || 'Failed to fetch versions');
  }

  return res.json();
};

const fetchComparison = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  fromVersion: number,
  toVersion: number,
): Promise<VersionComparisonResponse> => {
  const params = new URLSearchParams({
    projectId,
    opportunityId,
    documentId,
    fromVersion: fromVersion.toString(),
    toVersion: toVersion.toString(),
  });

  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/compare?${params}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(raw || 'Failed to fetch version comparison');
  }

  return res.json();
};

const revertVersion = async (
  _key: string,
  { arg }: { arg: RevertVersionDTO },
): Promise<{ ok: boolean; version: RFPDocumentVersion }> => {
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(raw || 'Failed to revert version');
  }

  return res.json();
};

const cherryPickChanges = async (
  _key: string,
  { arg }: { arg: CherryPickDTO },
): Promise<{ ok: boolean; version: RFPDocumentVersion }> => {
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/cherry-pick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(raw || 'Failed to cherry-pick changes');
  }

  return res.json();
};

// ---------- Hooks ----------

/**
 * Get all versions for a document
 */
export const useDocumentVersions = (
  projectId?: string,
  opportunityId?: string,
  documentId?: string,
) => {
  return useSWR<VersionListResponse, Error>(
    projectId && opportunityId && documentId
      ? ['document-versions', projectId, opportunityId, documentId]
      : null,
    () => fetchVersions(projectId!, opportunityId!, documentId!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    },
  );
};

/**
 * Compare two versions of a document
 */
export const useVersionComparison = (
  projectId?: string,
  opportunityId?: string,
  documentId?: string,
  fromVersion?: number | null,
  toVersion?: number | null,
) => {
  return useSWR<VersionComparisonResponse, Error>(
    projectId && opportunityId && documentId && fromVersion && toVersion
      ? ['version-comparison', projectId, opportunityId, documentId, fromVersion, toVersion]
      : null,
    () => fetchComparison(projectId!, opportunityId!, documentId!, fromVersion!, toVersion!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );
};

/**
 * Revert to a previous version (mutation)
 */
export const useRevertVersion = () => {
  return useSWRMutation<
    { ok: boolean; version: RFPDocumentVersion },
    Error,
    string,
    RevertVersionDTO
  >('revert-version', revertVersion);
};

/**
 * Cherry-pick changes from another version (mutation)
 */
export const useCherryPick = () => {
  return useSWRMutation<
    { ok: boolean; version: RFPDocumentVersion },
    Error,
    string,
    CherryPickDTO
  >('cherry-pick-version', cherryPickChanges);
};

// ---------- Diff Navigation Hook (client-side state) ----------

interface UseDiffNavigationOptions {
  hunks: DiffHunk[];
  onNavigate?: (hunk: DiffHunk) => void;
}

/**
 * Hook for line-by-line navigation through diff hunks
 */
export const useDiffNavigation = ({ hunks, onNavigate }: UseDiffNavigationOptions) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentHunk = useMemo(() => hunks[currentIndex] ?? null, [hunks, currentIndex]);
  const totalHunks = hunks.length;
  const hasNext = currentIndex < totalHunks - 1;
  const hasPrev = currentIndex > 0;

  const goToNext = useCallback(() => {
    if (hasNext) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      onNavigate?.(hunks[nextIndex]);
    }
  }, [currentIndex, hasNext, hunks, onNavigate]);

  const goToPrev = useCallback(() => {
    if (hasPrev) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      onNavigate?.(hunks[prevIndex]);
    }
  }, [currentIndex, hasPrev, hunks, onNavigate]);

  const goToIndex = useCallback((index: number) => {
    if (index >= 0 && index < totalHunks) {
      setCurrentIndex(index);
      onNavigate?.(hunks[index]);
    }
  }, [totalHunks, hunks, onNavigate]);

  return {
    currentIndex,
    currentHunk,
    totalHunks,
    hasNext,
    hasPrev,
    goToNext,
    goToPrev,
    goToIndex,
  };
};

// ---------- Cherry-Pick Selection Hook (client-side state) ----------

/**
 * Hook to manage cherry-pick hunk selection
 */
export const useCherryPickSelection = () => {
  const [selectedHunks, setSelectedHunks] = useState<Set<number>>(new Set());

  const toggleHunk = useCallback((index: number) => {
    setSelectedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((indices: number[]) => {
    setSelectedHunks(new Set(indices));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedHunks(new Set());
  }, []);

  const isSelected = useCallback((index: number) => selectedHunks.has(index), [selectedHunks]);

  return {
    selectedHunks,
    selectedCount: selectedHunks.size,
    toggleHunk,
    selectAll,
    clearSelection,
    isSelected,
  };
};

// ---------- Helper Functions ----------

/**
 * Compute diff hunks from two HTML strings (uses 'diff' npm package)
 * Install: pnpm add diff @types/diff
 */
export const computeDiffHunks = (fromHtml: string, toHtml: string): DiffHunk[] => {
  // Note: In implementation, use: import { diffWords } from 'diff';
  // This is a simplified representation
  const hunks: DiffHunk[] = [];
  // Actual implementation would use diffWords(fromHtml, toHtml)
  return hunks;
};

/**
 * Apply selected hunks to create merged HTML for cherry-pick
 */
export const applySelectedHunks = (
  currentHtml: string,
  sourceHtml: string,
  hunks: DiffHunk[],
  selectedIndices: Set<number>,
): string => {
  // Simplified - actual implementation would use proper diff/patch logic
  let result = currentHtml;
  
  hunks.forEach((hunk) => {
    if (selectedIndices.has(hunk.index) && hunk.fromContent) {
      // Apply the change from source version
      result = result.replace(hunk.toContent || '', hunk.fromContent);
    }
  });

  return result;
};
```

### 7.2 Components Structure

```
apps/web/components/rfp-document/
├── version-history/
│   ├── VersionHistoryPanel.tsx       # Sidebar listing all versions
│   └── VersionListItem.tsx           # Single version entry
├── version-diff/
│   ├── VersionDiffView.tsx           # Main split-pane diff viewer
│   ├── DiffNavigationBar.tsx         # Prev/Next change navigation
│   └── CherryPickControls.tsx        # Cherry-pick selection UI
└── dialogs/
    ├── RevertConfirmDialog.tsx       # Confirm revert action
    └── CherryPickConfirmDialog.tsx   # Confirm cherry-pick with preview
```

### 7.3 Key UI Requirements

**Diff Navigation Bar** (line-by-line navigation):
- "Change X of Y" counter
- Previous/Next buttons (↑/↓)
- Keyboard shortcuts: Ctrl+↑ / Ctrl+↓
- Jump to change by clicking on change indicator

**Cherry-Pick Mode**:
- Toggle button to enter cherry-pick mode
- Checkboxes on each diff hunk
- "Apply X changes" button when hunks selected
- Preview merged result before applying

**Version History Panel**:
- List of versions with version number, date, author
- Change note preview
- Click to select for comparison
- "Compare with current" and "Compare with previous" actions

---

## 8. Implementation Tickets <!-- ⏳ PENDING -->

### VC-1 · Core Schemas & Types (1 hour) <!-- ⏳ PENDING -->

**Files**:
- `packages/core/src/schemas/rfp-document-version.ts`
- `packages/core/src/schemas/index.ts`

**Tasks**:
- [ ] Create `RFPDocumentVersionSchema` with all fields
- [ ] Create DTOs: `CreateVersionDTO`, `RevertVersionDTO`, `CherryPickDTO`
- [ ] Create `DiffHunkSchema` for client-side diff
- [ ] Export from index.ts

**Acceptance Criteria**:
- All schemas compile without errors
- Types are properly exported from `@auto-rfp/core`

---

### VC-2 · Backend Helpers (1.5 hours) <!-- ⏳ PENDING -->

**Files**:
- `apps/functions/src/constants/rfp-document-version.ts`
- `apps/functions/src/helpers/rfp-document-version.ts`

**Tasks**:
- [ ] Add PK constant `RFP_DOCUMENT_VERSION_PK`
- [ ] Implement SK builders: `buildVersionSK`, `buildVersionPrefix`
- [ ] Implement S3 key builder: `buildVersionHtmlKey`
- [ ] Implement CRUD: `createVersion`, `listVersions`, `getVersion`, `getLatestVersionNumber`
- [ ] Implement S3 ops: `saveVersionHtml`, `loadVersionHtml`

**Acceptance Criteria**:
- All helper functions compile
- SK padded to 6 digits for proper sorting

---

### VC-3 · Lambda Handlers (2.5 hours) <!-- ⏳ PENDING -->

**Files**:
- `apps/functions/src/handlers/rfp-document/get-versions.ts`
- `apps/functions/src/handlers/rfp-document/compare-versions.ts`
- `apps/functions/src/handlers/rfp-document/revert-version.ts`
- `apps/functions/src/handlers/rfp-document/cherry-pick-version.ts`

**Tasks**:
- [ ] Implement `get-versions` handler with org verification
- [ ] Implement `compare-versions` handler with parallel S3 fetch
- [ ] Implement `revert-version` handler (creates new version from old)
- [ ] Implement `cherry-pick-version` handler (saves merged HTML)
- [ ] Add proper middleware stack to all handlers

**Acceptance Criteria**:
- All handlers follow thin Lambda pattern
- safeParse results destructured
- orgId from query params / body
- Uses `apiResponse` helper

---

### VC-4 · CDK Routes (30 min) <!-- ⏳ PENDING -->

**Files**:
- `packages/infra/api/routes/rfp-document.routes.ts`

**Tasks**:
- [ ] Add routes for `versions`, `compare`, `revert`, `cherry-pick`
- [ ] Ensure proper CloudWatch log groups

**Acceptance Criteria**:
- Routes registered and deployed
- All 4 endpoints accessible via API Gateway

---

### VC-5 · Frontend Hook (1 hour) <!-- ⏳ PENDING -->

**Files**:
- `apps/web/lib/hooks/use-document-versions.ts`

**Tasks**:
- [ ] Implement `useDocumentVersions` hook (SWR)
- [ ] Implement `useVersionComparison` hook (SWR)
- [ ] Implement `useRevertVersion` mutation
- [ ] Implement `useCherryPick` mutation
- [ ] Implement `useDiffNavigation` (client-side state)
- [ ] Implement `useCherryPickSelection` (client-side state)
- [ ] Add diff helper functions

**Acceptance Criteria**:
- All hooks work with SWR caching
- Mutations trigger proper cache invalidation

---

### VC-6 · UI Components (3 hours) <!-- ⏳ PENDING -->

**Files**:
- `apps/web/components/rfp-document/version-history/VersionHistoryPanel.tsx`
- `apps/web/components/rfp-document/version-history/VersionListItem.tsx`
- `apps/web/components/rfp-document/version-diff/VersionDiffView.tsx`
- `apps/web/components/rfp-document/version-diff/DiffNavigationBar.tsx`
- `apps/web/components/rfp-document/version-diff/CherryPickControls.tsx`
- `apps/web/components/rfp-document/dialogs/RevertConfirmDialog.tsx`
- `apps/web/components/rfp-document/dialogs/CherryPickConfirmDialog.tsx`

**Tasks**:
- [ ] Create `VersionHistoryPanel` with version list
- [ ] Create `VersionDiffView` with split-pane layout
- [ ] Create `DiffNavigationBar` with prev/next buttons
- [ ] Add keyboard shortcuts (Ctrl+↑/↓)
- [ ] Create cherry-pick UI with checkboxes
- [ ] Create confirmation dialogs
- [ ] Add skeleton loading states

**Acceptance Criteria**:
- Side-by-side diff view renders correctly
- Navigation jumps to changes and scrolls into view
- Cherry-pick mode allows selecting individual hunks
- All loading states use skeleton components

---

### VC-7 · Integration & Testing (30 min) <!-- ⏳ PENDING -->

**Tasks**:
- [ ] Test version creation on document save
- [ ] Test diff view with sample documents
- [ ] Test revert flow end-to-end
- [ ] Test cherry-pick with multiple selections
- [ ] Verify keyboard navigation works

**Acceptance Criteria**:
- All acceptance criteria from ticket met
- No console errors
- Proper error handling for edge cases

---

## 9. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

From original ticket, mapped to implementation:

| # | Criterion | Ticket | Status |
|---|-----------|--------|--------|
| 1 | Version creation automatic | VC-3 | ⏳ |
| 2 | Diff calculation working | VC-5, VC-6 | ⏳ |
| 3 | Side-by-side view functional | VC-6 | ⏳ |
| 4 | Change highlighting correct (green/red/yellow) | VC-6 | ⏳ |
| 5 | Revert capability working | VC-3, VC-6 | ⏳ |
| 6 | Cherry-pick changes working | VC-3, VC-5, VC-6 | ⏳ |
| 7 | Line-by-line navigation working | VC-5, VC-6 | ⏳ |
| 8 | Tested with sample changes | VC-7 | ⏳ |

---

## 10. Summary of New Files <!-- ⏳ PENDING -->

| File Path | Purpose | Status |
|-----------|---------|--------|
| `packages/core/src/schemas/rfp-document-version.ts` | Zod schemas for versions | ⏳ |
| `apps/functions/src/constants/rfp-document-version.ts` | PK constant | ⏳ |
| `apps/functions/src/helpers/rfp-document-version.ts` | DynamoDB + S3 helpers | ⏳ |
| `apps/functions/src/handlers/rfp-document/get-versions.ts` | List versions handler | ⏳ |
| `apps/functions/src/handlers/rfp-document/compare-versions.ts` | Compare versions handler | ⏳ |
| `apps/functions/src/handlers/rfp-document/revert-version.ts` | Revert handler | ⏳ |
| `apps/functions/src/handlers/rfp-document/cherry-pick-version.ts` | Cherry-pick handler | ⏳ |
| `apps/web/lib/hooks/use-document-versions.ts` | All version hooks | ⏳ |
| `apps/web/components/rfp-document/version-history/VersionHistoryPanel.tsx` | History panel | ⏳ |
| `apps/web/components/rfp-document/version-history/VersionListItem.tsx` | Version list item | ⏳ |
| `apps/web/components/rfp-document/version-diff/VersionDiffView.tsx` | Diff viewer | ⏳ |
| `apps/web/components/rfp-document/version-diff/DiffNavigationBar.tsx` | Navigation bar | ⏳ |
| `apps/web/components/rfp-document/version-diff/CherryPickControls.tsx` | Cherry-pick UI | ⏳ |
| `apps/web/components/rfp-document/dialogs/RevertConfirmDialog.tsx` | Revert dialog | ⏳ |
| `apps/web/components/rfp-document/dialogs/CherryPickConfirmDialog.tsx` | Cherry-pick dialog | ⏳ |

---

## 11. Dependencies <!-- ⏳ PENDING -->

**NPM packages to install**:

```bash
# In apps/web
pnpm add diff @types/diff
```

The `diff` package provides the Myers diff algorithm for computing changes between HTML strings.

---

## 12. Open Questions / Future Enhancements

1. **Merge Conflicts** — The ticket mentions "merge conflicts need resolution". This implementation handles cherry-pick (selective changes), but true 3-way merge conflicts (when multiple users edit simultaneously) would require:
   - WebSocket-based collaborative editing (like the existing collaboration feature)
   - Conflict detection when saving
   - This is out of scope for initial implementation (10 hours)

2. **Export Diff Report** — The ticket mentions "Export diff report". Could add a "Download as PDF" button that generates a styled diff report. Deferred for future sprint.

3. **Retention Policy** — Currently relies on S3 lifecycle rules. May want to add a "Delete old versions" admin feature or version limit per document.


