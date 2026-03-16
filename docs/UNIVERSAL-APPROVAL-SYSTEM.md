# Universal Approval System

> A flexible, entity-agnostic approval system that can handle approvals for any type of entity (RFP documents, briefs, opportunities, submissions, etc.) using a universal entitySK approach.

---

## 🎯 Overview

The Universal Approval System replaces the hardcoded RFP document approval system with a flexible solution that can handle approvals for any entity type. The key innovation is using `entitySK` (entity sort key) to store the full DynamoDB sort key of the entity being approved, making the system completely universal.

### Key Features

- **Universal Entity Support**: Works with RFP documents, executive briefs, opportunities, submissions, content library items, templates, FOIA requests, and debriefing requests
- **Backward Compatibility**: Existing RFP document approvals continue to work unchanged
- **EntitySK Approach**: Stores the full DynamoDB sort key of the entity, enabling universal querying
- **Type Safety**: Full TypeScript support with Zod schemas
- **Audit Trail**: Complete audit logging for all approval actions
- **Linear Integration**: Automatic Linear ticket creation for reviewers

---

## 🏗️ Architecture

### Data Model

The universal approval system uses a new DynamoDB partition key `UNIVERSAL_APPROVAL` with the following sort key structure:

```
SK: {orgId}#{entityType}#{entitySK}#{approvalId}
```

Where:
- `orgId`: Organization identifier
- `entityType`: Type of entity being approved (e.g., 'rfp-document', 'brief', 'opportunity')
- `entitySK`: The full sort key of the entity in its original DynamoDB table
- `approvalId`: Unique approval identifier

### Entity Types

```typescript
export const ApprovableEntityTypeSchema = z.enum([
  'rfp-document',         // RFP documents (backward compatibility)
  'brief',                // Executive opportunity briefs
  'opportunity',          // Opportunities
  'submission',           // Proposal submissions
  'content-library',      // Content library items
  'template',             // Templates
  'foia-request',         // FOIA requests
  'debriefing-request',   // Debriefing requests
]);
```

### Universal Approval Record

```typescript
export const UniversalApprovalItemSchema = z.object({
  approvalId:   z.string().uuid(),
  orgId:        z.string().min(1),
  projectId:    z.string().min(1).optional(), // Some entities might not be project-scoped
  
  // Universal entity identification
  entityType:   ApprovableEntityTypeSchema,
  entityId:     z.string().min(1),           // The ID of the entity being approved
  entitySK:     z.string().min(1),           // The full SK of the entity in DynamoDB
  entityName:   z.string().optional(),       // Display name of the entity
  
  // Legacy fields for backward compatibility with RFP documents
  opportunityId: z.string().min(1).optional(),
  documentId:    z.string().min(1).optional(),
  documentName:  z.string().optional(),

  status: UniversalApprovalStatusSchema,

  // Who requested the approval
  requestedBy:     z.string().min(1),   // userId
  requestedByName: z.string().optional(),
  requestedAt:     z.string().datetime(),

  // Who is assigned to review
  reviewerId:     z.string().min(1),    // userId
  reviewerName:   z.string().optional(),
  reviewerEmail:  z.string().email().optional(),

  // Review outcome
  reviewedAt:     z.string().datetime().optional(),
  reviewNote:     z.string().max(2000).optional(),

  // Revision (set when employee re-submits after rejection)
  revisionNote:   z.string().max(2000).optional(),

  // Linear ticket created for the reviewer
  linearTicketId:         z.string().optional(),
  linearTicketIdentifier: z.string().optional(),
  linearTicketUrl:        z.string().url().optional(),

  // Audit
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

---

## 🔧 Implementation

### Backend Handlers

#### 1. Request Approval
**File**: `apps/functions/src/handlers/universal-approval/request-approval.ts`

```typescript
// Request approval for any entity type
const requestData: RequestUniversalApproval = {
  orgId: 'org-123',
  projectId: 'proj-456', // optional for some entity types
  entityType: 'brief',
  entityId: 'brief-789',
  entitySK: 'org-123#proj-456#opp-123#brief-789', // Full SK of the brief
  entityName: 'Executive Brief for Opportunity ABC',
  reviewerId: 'user-456',
  
  // Legacy fields for backward compatibility
  opportunityId: 'opp-123', // optional
  documentId: undefined,    // not applicable for briefs
};
```

#### 2. Submit Review
**File**: `apps/functions/src/handlers/universal-approval/submit-review.ts`

```typescript
// Submit review decision
const reviewData: SubmitUniversalReview = {
  orgId: 'org-123',
  projectId: 'proj-456',
  entityType: 'brief',
  entityId: 'brief-789',
  approvalId: 'approval-uuid',
  decision: 'APPROVED', // or 'REJECTED'
  reviewNote: 'Looks good, approved for submission',
};
```

#### 3. Get Approval History
**File**: `apps/functions/src/handlers/universal-approval/get-approval-history.ts`

```typescript
// Get approval history for any entity
GET /universal-approval/history?orgId=org-123&entityType=brief&entitySK=org-123%23proj-456%23opp-123%23brief-789
```

### Frontend Hooks

#### Universal Hook
```typescript
import { useUniversalApprovalHistory } from '@/lib/hooks/use-universal-approval';

const { approvals, activeApproval, isLoading } = useUniversalApprovalHistory(
  orgId,
  'brief',
  'org-123#proj-456#opp-123#brief-789'
);
```

#### Entity-Specific Helper Hooks
```typescript
// RFP Documents (backward compatibility)
const { approvals } = useRfpDocumentApproval(orgId, projectId, opportunityId, documentId);

// Executive Briefs
const { approvals } = useBriefApproval(orgId, projectId, opportunityId, briefId);

// Opportunities
const { approvals } = useOpportunityApproval(orgId, projectId, opportunityId);

// Submissions
const { approvals } = useSubmissionApproval(orgId, projectId, opportunityId, submissionId);

// Content Library Items
const { approvals } = useContentLibraryApproval(orgId, contentId);

// Templates
const { approvals } = useTemplateApproval(orgId, templateId);
```

---

## 📋 Usage Examples

### 1. Executive Brief Approval

```typescript
// Request approval for an executive brief
const requestApproval = async () => {
  const briefEntitySK = buildBriefEntitySK(orgId, projectId, opportunityId, briefId);
  
  await requestUniversalApproval({
    orgId,
    projectId,
    entityType: 'brief',
    entityId: briefId,
    entitySK: briefEntitySK,
    entityName: 'Executive Brief for NASA Contract',
    reviewerId: 'manager-user-id',
    opportunityId, // for backward compatibility
  });
};

// Get approval history
const { approvals, activeApproval } = useBriefApproval(orgId, projectId, opportunityId, briefId);
```

### 2. Opportunity Approval

```typescript
// Request approval for an opportunity
const requestApproval = async () => {
  const opportunityEntitySK = buildOpportunityEntitySK(orgId, projectId, opportunityId);
  
  await requestUniversalApproval({
    orgId,
    projectId,
    entityType: 'opportunity',
    entityId: opportunityId,
    entitySK: opportunityEntitySK,
    entityName: 'NASA Space Technology Contract',
    reviewerId: 'director-user-id',
  });
};

// Get approval history
const { approvals, activeApproval } = useOpportunityApproval(orgId, projectId, opportunityId);
```

### 3. Content Library Item Approval

```typescript
// Request approval for a content library item
const requestApproval = async () => {
  const contentEntitySK = buildContentLibraryEntitySK(orgId, contentId);
  
  await requestUniversalApproval({
    orgId,
    entityType: 'content-library',
    entityId: contentId,
    entitySK: contentEntitySK,
    entityName: 'Company Capabilities Statement',
    reviewerId: 'content-manager-user-id',
    // No projectId for content library items
  });
};

// Get approval history
const { approvals, activeApproval } = useContentLibraryApproval(orgId, contentId);
```

### 4. Submission Approval

```typescript
// Request approval for a proposal submission
const requestApproval = async () => {
  const submissionEntitySK = buildSubmissionEntitySK(orgId, projectId, opportunityId, submissionId);
  
  await requestUniversalApproval({
    orgId,
    projectId,
    entityType: 'submission',
    entityId: submissionId,
    entitySK: submissionEntitySK,
    entityName: 'Final Proposal Submission',
    reviewerId: 'proposal-manager-user-id',
    opportunityId,
  });
};

// Get approval history
const { approvals, activeApproval } = useSubmissionApproval(orgId, projectId, opportunityId, submissionId);
```

---

## 🔄 Migration Strategy

### Phase 1: Universal System Deployment
1. Deploy universal approval schemas and handlers
2. Keep existing document approval system running
3. No breaking changes to existing functionality

### Phase 2: New Entity Types
1. Start using universal approval for new entity types (briefs, opportunities, submissions)
2. Existing RFP document approvals continue using legacy system
3. Gradual adoption of universal system

### Phase 3: Legacy Migration (Optional)
1. Migrate existing RFP document approvals to universal system
2. Update frontend components to use universal hooks
3. Deprecate legacy document approval handlers

### Backward Compatibility

The universal system maintains full backward compatibility:

- Legacy RFP document approval handlers continue to work
- Legacy frontend hooks continue to work
- Legacy approval records remain accessible
- No data migration required

---

## 🧪 Testing

### Schema Tests
```bash
cd packages/core
pnpm test src/schemas/universal-approval.test.ts
```

### Handler Tests
```bash
cd apps/functions
pnpm test src/handlers/universal-approval/
```

### Frontend Hook Tests
```bash
cd apps/web
pnpm test lib/hooks/use-universal-approval.test.ts
```

---

## 🔍 EntitySK Examples

The `entitySK` field stores the complete DynamoDB sort key of the entity being approved:

| Entity Type | EntitySK Format | Example |
|---|---|---|
| RFP Document | `{orgId}#{projectId}#{opportunityId}#{documentId}` | `org-123#proj-456#opp-789#doc-abc` |
| Executive Brief | `{orgId}#{projectId}#{opportunityId}#{briefId}` | `org-123#proj-456#opp-789#brief-def` |
| Opportunity | `{orgId}#{projectId}#{opportunityId}` | `org-123#proj-456#opp-789` |
| Submission | `{orgId}#{projectId}#{opportunityId}#{submissionId}` | `org-123#proj-456#opp-789#sub-ghi` |
| Content Library | `{orgId}#{contentId}` | `org-123#content-jkl` |
| Template | `{orgId}#{templateId}` | `org-123#template-mno` |
| FOIA Request | `{orgId}#{projectId}#{foiaId}` | `org-123#proj-456#foia-pqr` |
| Debriefing Request | `{orgId}#{projectId}#{debriefingId}` | `org-123#proj-456#debrief-stu` |

---

## 🚀 Benefits

### 1. Universal Flexibility
- Single approval system handles all entity types
- Easy to add new entity types without code changes
- Consistent approval workflow across all entities

### 2. Maintainability
- Single codebase for all approval logic
- Reduced code duplication
- Easier to add new features and fix bugs

### 3. Type Safety
- Full TypeScript support with Zod schemas
- Compile-time validation of entity types
- Runtime validation of all approval data

### 4. Scalability
- Efficient DynamoDB queries using entitySK
- Can handle millions of approvals across all entity types
- Optimized for high-throughput approval workflows

### 5. Backward Compatibility
- Existing RFP document approvals continue to work
- No breaking changes to existing functionality
- Gradual migration path available

---

## 📊 Monitoring & Observability

### Audit Logging
All approval actions are automatically logged with:
- User identification and organization context
- Entity type and ID being approved
- Approval decision and reasoning
- Timestamps and IP addresses
- Full audit trail for compliance

### Metrics
Track approval system performance:
- Approval request volume by entity type
- Average review time by entity type
- Approval/rejection rates
- Overdue approval alerts

### Linear Integration
- Automatic Linear ticket creation for reviewers
- Ticket updates when approvals are completed
- Integration with existing Linear workflows

---

## 🔐 Security & Permissions

### RBAC Integration
- Uses existing RBAC middleware for authentication
- Permission checks based on entity type and organization
- Reviewer authorization validation

### Data Protection
- No PII stored in approval records
- Secure handling of reviewer information
- Audit trail encryption with HMAC signatures

---

## 📚 API Reference

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/universal-approval/request` | Request approval for any entity |
| POST | `/universal-approval/submit-review` | Submit approval decision |
| GET | `/universal-approval/history` | Get approval history for entity |
| POST | `/universal-approval/cancel` | Cancel pending approval |
| POST | `/universal-approval/resubmit` | Resubmit after rejection |

### Request/Response Types

All types are defined in `packages/core/src/schemas/universal-approval.ts`:

- `RequestUniversalApproval`
- `SubmitUniversalReview`
- `UniversalApprovalItem`
- `UniversalApprovalHistoryResponse`
- `ApprovableEntityType`

---

## 🎉 Summary

The Universal Approval System provides a flexible, scalable, and maintainable solution for handling approvals across all entity types in the Auto RFP platform. By using the `entitySK` approach, the system can universally handle any entity without hardcoded logic, while maintaining full backward compatibility with existing RFP document approvals.

Key advantages:
- ✅ Universal entity support
- ✅ Backward compatibility
- ✅ Type safety with Zod schemas
- ✅ Complete audit trail
- ✅ Linear integration
- ✅ Scalable architecture
- ✅ Easy to extend for new entity types