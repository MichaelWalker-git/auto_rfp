# Implementation Tickets - Document Management & Linear Sync Features

## Epic Overview

**Epic Name:** RFP Document Management & Linear Integration Enhancement  
**Epic Description:** Implement a centralized document management system within AutoRFP that enables document upload, preview, download, automatic Linear synchronization, and signature tracking.  
**Total Estimated Effort:** 89-119 story points (~3-4 sprints)

---

## Milestone 1: Backend Infrastructure (34-44 points)

### Ticket 1.1: RFP Document Database Schema & Helpers

**Name:** Create RFP Document DynamoDB Schema and Helper Functions

**Description:**  
Implement the database schema for RFP working documents including the Zod schema, DynamoDB helper functions, and constants. This forms the foundation for all document management operations.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `RFPDocumentItemSchema` in `shared/src/schemas/rfp-document.ts`
- [ ] Define document types enum (EXECUTIVE_BRIEF, TECHNICAL_PROPOSAL, COST_PROPOSAL, etc.)
- [ ] Define signature status enum (NOT_REQUIRED, PENDING_SIGNATURE, PARTIALLY_SIGNED, FULLY_SIGNED, REJECTED)
- [ ] Define Linear sync status enum (NOT_SYNCED, SYNCED, SYNC_FAILED)
- [ ] Create `RFP_DOCUMENT_PK` constant in `infrastructure/constants/rfp-document.js`
- [ ] Create helper functions in `infrastructure/lambda/helpers/rfp-document.ts`:
  - `buildRFPDocumentSK(projectId, opportunityId, documentId)`
  - `getRFPDocument(documentId)`
  - `listRFPDocuments(projectId, opportunityId)`
  - `putRFPDocument(item)`
  - `updateRFPDocument(documentId, updates)`
  - `deleteRFPDocument(documentId)` (soft delete)
- [ ] Add GSI for querying by `orgId` and `projectId`
- [ ] Unit tests for all helper functions pass
- [ ] Schema exports added to `shared/src/index.ts`

---

### Ticket 1.2: Document Upload Lambda

**Name:** Implement RFP Document Upload Lambda Function

**Description:**  
Create the Lambda function to handle document uploads. This includes generating presigned URLs for S3 upload, creating the document record in DynamoDB, and triggering the Linear sync queue.

**Estimate:** 8 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/create-rfp-document.ts`
- [ ] Implement request validation with Zod schema:
  - Required: `projectId`, `opportunityId`, `name`, `documentType`, `mimeType`, `fileSizeBytes`
  - Optional: `description`
- [ ] Generate unique `documentId` using UUID v4
- [ ] Build S3 key following pattern: `{orgId}/{projectId}/{opportunityId}/rfp-documents/{documentId}/v1/original.{ext}`
- [ ] Create DynamoDB record with initial status
- [ ] Return presigned upload URL with 15-minute expiry
- [ ] Add RBAC middleware with `document:create` permission
- [ ] Implement file size validation (max 100MB)
- [ ] Implement file type validation (PDF, DOCX, XLSX, PNG, JPG, TXT)
- [ ] Add Sentry error tracking
- [ ] Unit tests cover success and error cases
- [ ] Integration test with actual S3 upload works

---

### Ticket 1.3: Document List & Get Lambdas

**Name:** Implement RFP Document List and Get Lambda Functions

**Description:**  
Create Lambda functions to list all documents for an opportunity and retrieve individual document details.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/get-rfp-documents.ts`
  - Accept `projectId` and `opportunityId` as path parameters
  - Support pagination with `limit` and `nextToken` query params
  - Default limit: 50, max limit: 100
  - Return documents sorted by `createdAt` descending
  - Include total count in response
- [ ] Create `infrastructure/lambda/rfp-document/get-rfp-document.ts`
  - Accept `documentId` as path parameter
  - Return full document details including version history count
  - Return 404 if document not found or deleted
- [ ] Add RBAC middleware with `document:read` permission
- [ ] Filter out soft-deleted documents by default
- [ ] Add optional `includeDeleted=true` query param for admins
- [ ] Unit tests for pagination edge cases
- [ ] Unit tests for permission checks

---

### Ticket 1.4: Document Update & Delete Lambdas

**Name:** Implement RFP Document Update and Delete Lambda Functions

**Description:**  
Create Lambda functions to update document metadata and soft-delete documents.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/update-rfp-document.ts`
  - Accept `documentId` as path parameter
  - Updatable fields: `name`, `description`, `documentType`
  - Update `updatedAt` and `updatedBy` fields
  - Trigger Linear sync on update
  - Return updated document
- [ ] Create `infrastructure/lambda/rfp-document/delete-rfp-document.ts`
  - Accept `documentId` as path parameter
  - Implement soft delete (set `deletedAt` timestamp)
  - Trigger Linear sync to update comment status
  - Return success confirmation
- [ ] Add RBAC middleware with `document:update` and `document:delete` permissions
- [ ] Validate document belongs to user's organization
- [ ] Unit tests for update validation
- [ ] Unit tests for delete idempotency

---

### Ticket 1.5: Presigned URL Generation Lambdas

**Name:** Implement Document Preview and Download URL Generation

**Description:**  
Create Lambda functions to generate presigned URLs for document preview (inline) and download (attachment).

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/get-document-preview-url.ts`
  - Accept `documentId` as path parameter
  - Generate presigned URL with `ResponseContentDisposition: inline`
  - Set appropriate `ResponseContentType` based on document mimeType
  - URL expires in 1 hour
  - Return URL and expiry timestamp
- [ ] Create `infrastructure/lambda/rfp-document/get-document-download-url.ts`
  - Accept `documentId` as path parameter
  - Generate presigned URL with `ResponseContentDisposition: attachment; filename="{name}"`
  - URL expires in 1 hour
  - Return URL and expiry timestamp
- [ ] Add RBAC middleware with `document:read` permission
- [ ] Handle missing S3 objects gracefully (return 404)
- [ ] Unit tests for URL generation
- [ ] Manual test: URLs work in browser

---

### Ticket 1.6: Document Version Management Lambdas

**Name:** Implement Document Version Upload and History

**Description:**  
Create Lambda functions to upload new document versions and retrieve version history.

**Estimate:** 6 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/create-document-version.ts`
  - Accept `documentId` as path parameter
  - Increment version number from current document
  - Create new S3 key: `{orgId}/{projectId}/{opportunityId}/rfp-documents/{documentId}/v{n}/original.{ext}`
  - Update document record with new version info
  - Store `previousVersionId` reference
  - Trigger Linear sync with version update
  - Return presigned upload URL
- [ ] Create `infrastructure/lambda/rfp-document/get-document-versions.ts`
  - Accept `documentId` as path parameter
  - Return list of all versions with metadata
  - Include version number, createdAt, createdBy, fileSize
  - Sort by version number descending
- [ ] Add RBAC middleware with appropriate permissions
- [ ] Limit max versions per document (configurable, default 50)
- [ ] Unit tests for version increment logic
- [ ] Unit tests for version history retrieval

---

## Milestone 2: Linear Integration (21-28 points)

### Ticket 2.1: Linear Sync SQS Queue Infrastructure

**Name:** Create SQS Queue for Linear Document Sync

**Description:**  
Set up the SQS queue infrastructure for asynchronous document-to-Linear synchronization.

**Estimate:** 3 story points

**Acceptance Criteria:**
- [ ] Create SQS queue `rfp-document-linear-sync` in CDK stack
- [ ] Configure dead-letter queue for failed messages
- [ ] Set visibility timeout to 60 seconds
- [ ] Set message retention to 7 days
- [ ] Configure max receive count of 3 before DLQ
- [ ] Add CloudWatch alarms for DLQ messages
- [ ] Export queue URL and ARN for Lambda access
- [ ] Document queue configuration in README

---

### Ticket 2.2: Linear Sync Worker Lambda

**Name:** Implement Linear Document Sync Worker

**Description:**  
Create the Lambda function that processes the sync queue and creates/updates Linear comments.

**Estimate:** 8 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/sync-document-to-linear.ts`
- [ ] Configure as SQS event source from `rfp-document-linear-sync` queue
- [ ] Implement message schema validation:
  ```typescript
  {
    documentId: string,
    projectId: string,
    opportunityId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE'
  }
  ```
- [ ] Fetch document details from DynamoDB
- [ ] Fetch executive brief to get `linearTicketId`
- [ ] Handle case where no Linear ticket exists (skip sync, log warning)
- [ ] Fetch Linear API key from Secrets Manager
- [ ] Generate presigned preview and download URLs
- [ ] Build markdown comment body with document info
- [ ] Create new comment for CREATE action
- [ ] Update existing comment for UPDATE action (if `linearCommentId` exists)
- [ ] Mark comment as deleted for DELETE action
- [ ] Update document record with `linearCommentId` and `lastSyncedAt`
- [ ] Handle Linear API rate limiting with exponential backoff
- [ ] Log all sync operations for debugging
- [ ] Unit tests for comment body generation
- [ ] Integration test with Linear sandbox

---

### Ticket 2.3: Linear API Client Enhancement

**Name:** Enhance Linear API Client for Comment Operations

**Description:**  
Extend the existing Linear integration to support comment creation and updates.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/helpers/linear-client.ts`
- [ ] Implement `createLinearComment(apiKey, issueId, body)` function
- [ ] Implement `updateLinearComment(apiKey, commentId, body)` function
- [ ] Implement `getLinearComment(apiKey, commentId)` function
- [ ] Handle Linear GraphQL API authentication
- [ ] Implement proper error handling for API errors
- [ ] Add retry logic for transient failures
- [ ] Add rate limit detection and backoff
- [ ] Unit tests with mocked API responses
- [ ] Document Linear API scopes required

---

### Ticket 2.4: Sync Trigger Integration

**Name:** Integrate Linear Sync Triggers into Document Operations

**Description:**  
Add SQS message publishing to document CRUD operations to trigger Linear sync.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/helpers/linear-sync-queue.ts`
- [ ] Implement `enqueueLinearSync(payload)` function
- [ ] Add sync trigger to `create-rfp-document.ts` after successful creation
- [ ] Add sync trigger to `update-rfp-document.ts` after successful update
- [ ] Add sync trigger to `delete-rfp-document.ts` after successful deletion
- [ ] Add sync trigger to `create-document-version.ts` after successful version upload
- [ ] Add sync trigger to signature status update operations
- [ ] Handle queue publish failures gracefully (log error, don't fail main operation)
- [ ] Unit tests for queue message format
- [ ] Integration test: document upload triggers sync

---

## Milestone 3: Frontend Components (26-35 points)

### Ticket 3.1: Document Management Hooks

**Name:** Create React Hooks for RFP Document Management

**Description:**  
Implement SWR-based hooks for document CRUD operations, preview URLs, and version management.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `web-app/lib/hooks/use-rfp-documents.ts`
  - `useRFPDocuments(projectId, opportunityId)` - list documents with pagination
  - `useRFPDocument(documentId)` - get single document
  - `useCreateRFPDocument()` - upload new document
  - `useUpdateRFPDocument()` - update document metadata
  - `useDeleteRFPDocument()` - delete document
- [ ] Create `web-app/lib/hooks/use-document-preview.ts`
  - `useDocumentPreviewUrl(documentId)` - get preview URL with caching
  - `useDocumentDownloadUrl(documentId)` - get download URL
- [ ] Create `web-app/lib/hooks/use-document-versions.ts`
  - `useDocumentVersions(documentId)` - list versions
  - `useCreateDocumentVersion()` - upload new version
- [ ] Implement optimistic updates for better UX
- [ ] Handle loading and error states
- [ ] Add proper TypeScript types
- [ ] Unit tests for hook behavior

---

### Ticket 3.2: Document List Component

**Name:** Implement Document List and Card Components

**Description:**  
Create the UI components for displaying the list of documents with filtering and sorting.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `web-app/components/rfp-documents/DocumentList.tsx`
  - Display documents in a responsive grid/list layout
  - Show document name, type, version, and status badges
  - Support sorting by name, date, type
  - Support filtering by document type
  - Show empty state when no documents
  - Show loading skeleton while fetching
- [ ] Create `web-app/components/rfp-documents/DocumentCard.tsx`
  - Display document thumbnail/icon based on type
  - Show document name (truncated if long)
  - Show document type badge
  - Show signature status badge
  - Show Linear sync status indicator
  - Show version number
  - Show last updated date
  - Action buttons: Preview, Download, Edit, Delete
- [ ] Create `web-app/components/rfp-documents/DocumentListSkeleton.tsx`
- [ ] Implement responsive design (mobile-friendly)
- [ ] Add keyboard navigation support
- [ ] Unit tests for component rendering

---

### Ticket 3.3: Document Upload Component

**Name:** Implement Document Upload Dialog

**Description:**  
Create the upload dialog component with drag-and-drop support and progress tracking.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `web-app/components/rfp-documents/DocumentUploadDialog.tsx`
  - Modal dialog with form fields
  - Document name input (auto-filled from filename)
  - Document type dropdown
  - Description textarea (optional)
  - Drag-and-drop file zone
  - File type validation with user feedback
  - File size validation (max 100MB) with user feedback
  - Upload progress indicator
  - Cancel upload functionality
  - Success/error toast notifications
- [ ] Create `web-app/components/rfp-documents/DocumentUploader.tsx`
  - Reusable file drop zone component
  - Support multiple file selection
  - Show file preview before upload
  - Remove file from selection
- [ ] Integrate with `useCreateRFPDocument` hook
- [ ] Handle upload errors gracefully
- [ ] Unit tests for form validation
- [ ] E2E test for upload flow

---

### Ticket 3.4: Document Preview Component

**Name:** Implement Document Preview Modal

**Description:**  
Create the preview modal component supporting PDF, images, and text files.

**Estimate:** 8 story points

**Acceptance Criteria:**
- [ ] Create `web-app/components/rfp-documents/DocumentPreview.tsx`
  - Full-screen modal with close button
  - Loading state while fetching preview URL
  - Error state for failed preview
- [ ] Create `web-app/components/rfp-documents/PDFViewer.tsx`
  - Use `@react-pdf-viewer/core` for PDF rendering
  - Page navigation controls
  - Zoom controls
  - Full-screen toggle
  - Download button
- [ ] Create `web-app/components/rfp-documents/ImageViewer.tsx`
  - Support PNG, JPG, GIF
  - Zoom and pan controls
  - Download button
- [ ] Create `web-app/components/rfp-documents/TextViewer.tsx`
  - Syntax highlighting for code files
  - Line numbers
  - Copy to clipboard
- [ ] Create `web-app/components/rfp-documents/UnsupportedPreview.tsx`
  - Show file icon and name
  - Download button
  - Message explaining preview not available
- [ ] Handle preview URL expiry (refresh if needed)
- [ ] Keyboard shortcuts (Escape to close, arrows for PDF pages)
- [ ] Unit tests for viewer selection logic

---

### Ticket 3.5: Main Documents Section Component

**Name:** Implement RFP Documents Section Container

**Description:**  
Create the main container component that integrates all document management features.

**Estimate:** 3 story points

**Acceptance Criteria:**
- [ ] Create `web-app/components/rfp-documents/RFPDocumentsSection.tsx`
  - Header with title and upload button
  - Document list with filtering/sorting
  - Empty state for no documents
  - Loading state
  - Error state with retry
- [ ] Integrate into Executive Brief view as new tab
- [ ] Add to opportunity detail page
- [ ] Ensure proper permission checks (hide if no access)
- [ ] Responsive layout
- [ ] Unit tests for integration

---

## Milestone 4: Signature Tracking (8-12 points)

### Ticket 4.1: Signature Status Update Lambda

**Name:** Implement Signature Status Update Endpoint

**Description:**  
Create the Lambda function to update document signature status and signer information.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/update-signature-status.ts`
  - Accept `documentId` as path parameter
  - Request body schema:
    ```typescript
    {
      signatureStatus: 'NOT_REQUIRED' | 'PENDING_SIGNATURE' | 'PARTIALLY_SIGNED' | 'FULLY_SIGNED' | 'REJECTED',
      signers?: Array<{
        id?: string, // UUID, generated if not provided
        name: string,
        email: string,
        role: string,
        status: 'PENDING' | 'SIGNED' | 'REJECTED',
        signedAt?: string, // ISO datetime
        notes?: string
      }>,
      signatureMethod?: 'MANUAL' | 'DRIVE' | 'DOCUSIGN' | 'ADOBE_SIGN',
      driveFileId?: string,
      driveFileUrl?: string
    }
    ```
  - Validate status transitions (e.g., can't go from FULLY_SIGNED to PENDING)
  - Update document record
  - Trigger Linear sync
  - Return updated document
- [ ] Add RBAC middleware with `document:update` permission
- [ ] Unit tests for status transition validation
- [ ] Unit tests for signer management

---

### Ticket 4.2: Signature Tracking UI Components

**Name:** Implement Signature Tracking UI

**Description:**  
Create UI components for displaying and managing document signature status.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `web-app/components/rfp-documents/SignatureStatusBadge.tsx`
  - Color-coded badge based on status
  - Tooltip with status details
- [ ] Create `web-app/components/rfp-documents/SignatureTracker.tsx`
  - Display list of signers with status
  - Add signer form
  - Update signer status buttons
  - Remove signer button
  - Status change dropdown
  - Notes field for each signer
- [ ] Create `web-app/lib/hooks/use-signature-tracking.ts`
  - `useUpdateSignatureStatus()` hook
- [ ] Integrate into DocumentCard component
- [ ] Add signature tracking panel to document detail view
- [ ] Unit tests for status badge rendering
- [ ] Unit tests for signer management

---

### Ticket 4.3: Google Drive Integration (Optional/Future)

**Name:** Implement Google Drive Upload and Sync

**Description:**  
Create integration with Google Drive for document sharing and signature tracking.

**Estimate:** 8 story points (OPTIONAL - can be deferred)

**Acceptance Criteria:**
- [ ] Create `infrastructure/lambda/rfp-document/upload-to-drive.ts`
  - Accept `documentId` as path parameter
  - Fetch document from S3
  - Upload to Google Drive using service account
  - Set sharing permissions
  - Store `driveFileId` and `driveFileUrl` in document record
  - Return Drive file URL
- [ ] Create `infrastructure/lambda/rfp-document/sync-from-drive.ts`
  - Accept `documentId` as path parameter
  - Fetch latest version from Drive
  - Compare with current version
  - If changed, create new version in AutoRFP
  - Update signature status if detected
- [ ] Set up Google Cloud project and service account
- [ ] Store Google credentials in Secrets Manager
- [ ] Create UI for Drive upload button
- [ ] Create UI for Drive sync button
- [ ] Document Google API setup process

---

## Milestone 5: API Routes & CDK Integration (8-10 points)

### Ticket 5.1: API Gateway Routes

**Name:** Add API Gateway Routes for RFP Documents

**Description:**  
Configure API Gateway routes for all RFP document endpoints.

**Estimate:** 3 story points

**Acceptance Criteria:**
- [ ] Create `infrastructure/lib/api/routes/rfp-document.routes.ts`
- [ ] Add routes:
  - `POST /projects/{projectId}/opportunities/{opportunityId}/documents`
  - `GET /projects/{projectId}/opportunities/{opportunityId}/documents`
  - `GET /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}`
  - `PUT /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}`
  - `DELETE /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}`
  - `GET /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}/preview`
  - `GET /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}/download`
  - `POST /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}/versions`
  - `GET /projects/{projectId}/opportunities/{opportunityId}/documents/{documentId}/versions`
  - `PUT /documents/{documentId}/signature-status`
- [ ] Configure CORS for all routes
- [ ] Add request validation
- [ ] Add rate limiting
- [ ] Update API documentation

---

### Ticket 5.2: CDK Stack Updates

**Name:** Update CDK Stacks for RFP Document Infrastructure

**Description:**  
Add all new Lambda functions, SQS queues, and IAM permissions to CDK stacks.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Add Lambda functions to appropriate stack
- [ ] Configure Lambda environment variables
- [ ] Add SQS queue for Linear sync
- [ ] Configure SQS event source for sync worker
- [ ] Add IAM permissions:
  - Lambda to DynamoDB (read/write)
  - Lambda to S3 (read/write)
  - Lambda to SQS (send/receive)
  - Lambda to Secrets Manager (read)
- [ ] Add CloudWatch log groups
- [ ] Add CloudWatch alarms for errors
- [ ] Update CDK tests
- [ ] Deploy to dev environment successfully

---

## Milestone 6: Testing & Documentation (5-8 points)

### Ticket 6.1: Integration Tests

**Name:** Write Integration Tests for Document Management

**Description:**  
Create comprehensive integration tests for the document management feature.

**Estimate:** 5 story points

**Acceptance Criteria:**
- [ ] Create `e2e/rfp-documents.spec.ts`
- [ ] Test document upload flow end-to-end
- [ ] Test document list and filtering
- [ ] Test document preview and download
- [ ] Test document version upload
- [ ] Test signature status updates
- [ ] Test Linear sync (with mocked Linear API)
- [ ] Test permission checks (unauthorized access)
- [ ] Test error handling (invalid file types, size limits)
- [ ] All tests pass in CI pipeline

---

### Ticket 6.2: Documentation Updates

**Name:** Update User and Developer Documentation

**Description:**  
Create user guides and update developer documentation for the new features.

**Estimate:** 3 story points

**Acceptance Criteria:**
- [ ] Create user guide for document management
- [ ] Create user guide for signature tracking
- [ ] Update API documentation with new endpoints
- [ ] Update README with new features
- [ ] Add architecture diagram to docs
- [ ] Document Linear sync behavior
- [ ] Document supported file types and limits
- [ ] Review and approve documentation

---

## Summary

| Milestone | Tickets | Story Points |
|-----------|---------|--------------|
| 1. Backend Infrastructure | 6 | 34-44 |
| 2. Linear Integration | 4 | 21-28 |
| 3. Frontend Components | 5 | 26-35 |
| 4. Signature Tracking | 3 | 8-12 (1 optional) |
| 5. API Routes & CDK | 2 | 8-10 |
| 6. Testing & Documentation | 2 | 5-8 |
| **Total** | **22** | **89-119** |

## Recommended Sprint Breakdown

### Sprint 1 (Focus: Backend Foundation)
- Ticket 1.1: RFP Document Database Schema & Helpers (5 pts)
- Ticket 1.2: Document Upload Lambda (8 pts)
- Ticket 1.3: Document List & Get Lambdas (5 pts)
- Ticket 5.1: API Gateway Routes (3 pts)
- **Total: 21 points**

### Sprint 2 (Focus: Backend Completion + Linear)
- Ticket 1.4: Document Update & Delete Lambdas (5 pts)
- Ticket 1.5: Presigned URL Generation Lambdas (5 pts)
- Ticket 1.6: Document Version Management Lambdas (6 pts)
- Ticket 2.1: Linear Sync SQS Queue Infrastructure (3 pts)
- **Total: 19 points**

### Sprint 3 (Focus: Linear Integration + Frontend Start)
- Ticket 2.2: Linear Sync Worker Lambda (8 pts)
- Ticket 2.3: Linear API Client Enhancement (5 pts)
- Ticket 2.4: Sync Trigger Integration (5 pts)
- Ticket 3.1: Document Management Hooks (5 pts)
- **Total: 23 points**

### Sprint 4 (Focus: Frontend Completion)
- Ticket 3.2: Document List Component (5 pts)
- Ticket 3.3: Document Upload Component (5 pts)
- Ticket 3.4: Document Preview Component (8 pts)
- Ticket 3.5: Main Documents Section Component (3 pts)
- **Total: 21 points**

### Sprint 5 (Focus: Signature Tracking + Polish)
- Ticket 4.1: Signature Status Update Lambda (5 pts)
- Ticket 4.2: Signature Tracking UI Components (5 pts)
- Ticket 5.2: CDK Stack Updates (5 pts)
- Ticket 6.1: Integration Tests (5 pts)
- Ticket 6.2: Documentation Updates (3 pts)
- **Total: 23 points**

### Future Sprint (Optional)
- Ticket 4.3: Google Drive Integration (8 pts)