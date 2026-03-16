# RFP Document Approval System — UI & UX Improvements <!-- ⏳ PENDING -->

> Implementation-ready architecture for improving the RFP document approval system UI and making entities more informative.
> This document addresses the current UI issues and enhances the approval tracking experience.

---

## 0. Current Issues & Improvement Goals

### 🔴 Current UI Problems Identified

| Issue | Current State | Impact |
|---|---|---|
| **Poor Visual Hierarchy** | Approval information scattered across multiple components | Hard to understand approval status at a glance |
| **Lack of Context** | No clear indication of who requested approval and when | Users don't understand the approval workflow |
| **Inconsistent Information Display** | Requester/approver info shown differently across components | Confusing user experience |
| **Poor Mobile Experience** | Components not optimized for smaller screens | Difficult to use on mobile devices |
| **Overwhelming Approval History** | All approval history shown in a single card | Information overload, hard to find relevant info |
| **No Clear Action Items** | Users can't easily see what they need to do | Missed approvals and delayed workflows |

### 🎯 Improvement Goals

1. **Enhanced Visual Design** — Modern, clean UI with clear visual hierarchy
2. **Better Information Architecture** — Show who requested, who approved, when, and why
3. **Improved User Experience** — Clear action items and workflow status
4. **Mobile-First Design** — Responsive components that work on all devices
5. **Better Approval Tracking** — Enhanced visibility into approval workflow
6. **Contextual Information** — Show relevant details based on user role

---

## 1. Enhanced Data Model & Information Display

### 1.1 Additional User Information Schema

**File:** `packages/core/src/schemas/document-approval.ts`

Add enhanced user information to make approvals more informative:

```typescript
// Enhanced user information for better context
export const ApprovalUserInfoSchema = z.object({
  userId: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  avatar: z.string().url().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
});
export type ApprovalUserInfo = z.infer<typeof ApprovalUserInfoSchema>;

// Enhanced approval item with richer user context
export const EnhancedDocumentApprovalItemSchema = DocumentApprovalItemSchema.extend({
  // Enhanced requester information
  requesterInfo: ApprovalUserInfoSchema.optional(),
  
  // Enhanced reviewer information
  reviewerInfo: ApprovalUserInfoSchema.optional(),
  
  // Document context
  documentType: z.string().optional(),
  documentSize: z.number().optional(),
  documentVersion: z.number().optional(),
  
  // Workflow context
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  deadline: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  
  // Approval metrics
  timeToReview: z.number().optional(), // minutes from request to review
  isOverdue: z.boolean().default(false),
});
export type EnhancedDocumentApprovalItem = z.infer<typeof EnhancedDocumentApprovalItemSchema>;
```

### 1.2 Enhanced API Response Types

```typescript
export const EnhancedApprovalHistoryResponseSchema = z.object({
  items: z.array(EnhancedDocumentApprovalItemSchema),
  count: z.number(),
  activeApproval: EnhancedDocumentApprovalItemSchema.nullable(),
  
  // Summary statistics
  summary: z.object({
    totalPending: z.number(),
    totalApproved: z.number(),
    totalRejected: z.number(),
    averageReviewTime: z.number().optional(), // in minutes
    overdueCount: z.number(),
  }),
  
  // User-specific context
  userContext: z.object({
    isRequester: z.boolean(),
    isReviewer: z.boolean(),
    hasActionItems: z.boolean(),
    nextAction: z.string().optional(),
  }),
});
export type EnhancedApprovalHistoryResponse = z.infer<typeof EnhancedApprovalHistoryResponseSchema>;
```

---

## 2. Enhanced UI Components Architecture

### 2.1 New Component Structure

```
apps/web/features/document-approval/
├── components/
│   ├── enhanced/                    # New enhanced components
│   │   ├── ApprovalOverviewCard.tsx     # Main approval status overview
│   │   ├── ApprovalTimelineCard.tsx     # Visual timeline of approvals
│   │   ├── ApprovalActionCard.tsx       # Action items for current user
│   │   ├── ApprovalParticipantsCard.tsx # Who's involved in approval
│   │   ├── ApprovalMetricsCard.tsx      # Review time, deadlines, etc.
│   │   └── ApprovalMobileView.tsx       # Mobile-optimized view
│   ├── legacy/                      # Existing components (for migration)
│   │   ├── ApprovalHistoryCard.tsx
│   │   ├── ReviewDecisionPanel.tsx
│   │   └── ...
│   └── shared/                      # Shared components
│       ├── UserAvatar.tsx
│       ├── ApprovalStatusIcon.tsx
│       └── TimeAgo.tsx
├── hooks/
│   ├── enhanced/
│   │   ├── useEnhancedApprovalHistory.ts
│   │   ├── useApprovalMetrics.ts
│   │   └── useApprovalActions.ts
│   └── legacy/ # existing hooks
└── utils/
    ├── approval-utils.ts
    ├── time-utils.ts
    └── user-utils.ts
```

### 2.2 Enhanced Approval Overview Card

**File:** `apps/web/features/document-approval/components/enhanced/ApprovalOverviewCard.tsx`

A comprehensive card that shows the current approval status with clear visual hierarchy:

```typescript
'use client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, CheckCircle2, XCircle, AlertCircle, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

interface ApprovalOverviewCardProps {
  approval: EnhancedDocumentApprovalItem;
  currentUserId: string;
  showActions?: boolean;
}

export const ApprovalOverviewCard = ({
  approval,
  currentUserId,
  showActions = true,
}: ApprovalOverviewCardProps) => {
  const isRequester = approval.requestedBy === currentUserId;
  const isReviewer = approval.reviewerId === currentUserId;
  const isPending = approval.status === 'PENDING';

  const statusConfig = {
    PENDING: {
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      label: 'Pending Review',
    },
    APPROVED: {
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      label: 'Approved',
    },
    REJECTED: {
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: 'Rejected',
    },
  };

  const config = statusConfig[approval.status] || statusConfig.PENDING;
  const StatusIcon = config.icon;

  return (
    <Card className={`${config.borderColor} ${config.bgColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${config.bgColor} ${config.borderColor} border`}>
              <StatusIcon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <h3 className="font-semibold text-base">{config.label}</h3>
              <p className="text-sm text-muted-foreground">
                {approval.documentName || 'Document approval'}
              </p>
            </div>
          </div>
          
          {approval.priority !== 'NORMAL' && (
            <Badge 
              variant={approval.priority === 'URGENT' ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {approval.priority}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Participants */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Requester */}
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={approval.requesterInfo?.avatar} />
              <AvatarFallback className="text-xs">
                {approval.requesterInfo?.name?.charAt(0) || 
                 approval.requestedByName?.charAt(0) || 
                 <User className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {approval.requesterInfo?.name || approval.requestedByName || 'Unknown'}
                {isRequester && <span className="text-muted-foreground ml-1">(You)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                Requested {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
              </p>
            </div>
          </div>

          {/* Reviewer */}
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={approval.reviewerInfo?.avatar} />
              <AvatarFallback className="text-xs">
                {approval.reviewerInfo?.name?.charAt(0) || 
                 approval.reviewerName?.charAt(0) || 
                 <User className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {approval.reviewerInfo?.name || approval.reviewerName || 'Unknown'}
                {isReviewer && <span className="text-muted-foreground ml-1">(You)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {approval.reviewerInfo?.role || 'Reviewer'}
                {approval.reviewerInfo?.department && ` • ${approval.reviewerInfo.department}`}
              </p>
            </div>
          </div>
        </div>

        {/* Review Details */}
        {approval.reviewedAt && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">
              Reviewed {formatDistanceToNow(new Date(approval.reviewedAt), { addSuffix: true })}
              {approval.timeToReview && (
                <span className="ml-2">
                  • Review time: {Math.round(approval.timeToReview / 60)}h {approval.timeToReview % 60}m
                </span>
              )}
            </p>
            {approval.reviewNote && (
              <div className={`text-sm p-3 rounded-lg ${
                approval.status === 'APPROVED' 
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                <p className="font-medium text-xs mb-1">
                  {approval.status === 'APPROVED' ? 'Approval Note:' : 'Rejection Reason:'}
                </p>
                <p>{approval.reviewNote}</p>
              </div>
            )}
          </div>
        )}

        {/* Deadline Warning */}
        {approval.deadline && isPending && (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs">
              Deadline: {formatDistanceToNow(new Date(approval.deadline), { addSuffix: true })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

### 2.3 Enhanced Approval Timeline Card

**File:** `apps/web/features/document-approval/components/enhanced/ApprovalTimelineCard.tsx`

A visual timeline showing the approval workflow:

```typescript
'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle2, XCircle, Send, RefreshCw } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

interface ApprovalTimelineCardProps {
  approvals: EnhancedDocumentApprovalItem[];
  currentUserId: string;
}

export const ApprovalTimelineCard = ({
  approvals,
  currentUserId,
}: ApprovalTimelineCardProps) => {
  if (approvals.length === 0) return null;

  const getTimelineIcon = (status: string, isLast: boolean) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'REVISION_REQUESTED':
        return <RefreshCw className="h-4 w-4 text-blue-600" />;
      case 'PENDING':
        return <Clock className="h-4 w-4 text-amber-600" />;
      default:
        return <Send className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Approval Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {approvals.map((approval, index) => {
            const isLast = index === approvals.length - 1;
            const isRequester = approval.requestedBy === currentUserId;
            const isReviewer = approval.reviewerId === currentUserId;

            return (
              <div key={approval.approvalId} className="flex gap-3">
                {/* Timeline indicator */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background border-2 border-muted">
                    {getTimelineIcon(approval.status, isLast)}
                  </div>
                  {!isLast && <div className="w-px h-6 bg-border mt-1" />}
                </div>

                {/* Timeline content */}
                <div className="flex-1 min-w-0 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge 
                          variant={approval.status === 'APPROVED' ? 'default' : 
                                 approval.status === 'REJECTED' ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {approval.status.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(approval.requestedAt), 'MMM d, yyyy HH:mm')}
                        </span>
                      </div>

                      <div className="mt-2 space-y-2">
                        {/* Requester info */}
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={approval.requesterInfo?.avatar} />
                            <AvatarFallback className="text-xs">
                              {approval.requesterInfo?.name?.charAt(0) || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">
                            <span className="font-medium">
                              {approval.requesterInfo?.name || approval.requestedByName || 'Unknown'}
                            </span>
                            {isRequester && <span className="text-muted-foreground ml-1">(You)</span>}
                            <span className="text-muted-foreground"> requested approval from </span>
                            <span className="font-medium">
                              {approval.reviewerInfo?.name || approval.reviewerName || 'Unknown'}
                            </span>
                            {isReviewer && <span className="text-muted-foreground ml-1">(You)</span>}
                          </span>
                        </div>

                        {/* Review details */}
                        {approval.reviewedAt && (
                          <div className="ml-8 text-sm text-muted-foreground">
                            Reviewed {formatDistanceToNow(new Date(approval.reviewedAt), { addSuffix: true })}
                            {approval.timeToReview && (
                              <span className="ml-2">
                                ({Math.round(approval.timeToReview / 60)}h {approval.timeToReview % 60}m)
                              </span>
                            )}
                          </div>
                        )}

                        {/* Review note */}
                        {approval.reviewNote && (
                          <div className="ml-8">
                            <div className={`text-sm p-2 rounded border ${
                              approval.status === 'APPROVED' 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-red-50 text-red-800 border-red-200'
                            }`}>
                              "{approval.reviewNote}"
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
```

### 2.4 Enhanced Approval Action Card

**File:** `apps/web/features/document-approval/components/enhanced/ApprovalActionCard.tsx`

A focused card showing what the current user needs to do:

```typescript
'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  RefreshCw,
  User,
  ArrowRight 
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ReviewDecisionPanel } from '../legacy/ReviewDecisionPanel';
import { ResubmitForReviewButton } from '../legacy/ResubmitForReviewButton';
import { RequestApprovalButton } from '../legacy/RequestApprovalButton';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

interface ApprovalActionCardProps {
  approval: EnhancedDocumentApprovalItem | null;
  approvals: EnhancedDocumentApprovalItem[];
  currentUserId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  documentName?: string;
  onActionComplete?: () => void;
}

export const ApprovalActionCard = ({
  approval,
  approvals,
  currentUserId,
  orgId,
  projectId,
  opportunityId,
  documentId,
  documentName,
  onActionComplete,
}: ApprovalActionCardProps) => {
  // Find the most recent rejected approval where current user is the requester
  const latestRejected = approvals.find(
    (a) => a.status === 'REJECTED' && a.requestedBy === currentUserId,
  );

  // Determine user's role and required action
  const isReviewer = approval && approval.reviewerId === currentUserId;
  const isRequester = approval && approval.requestedBy === currentUserId;
  const needsReview = approval && approval.status === 'PENDING' && isReviewer;
  const needsResubmit = latestRejected && !approval;
  const needsInitialRequest = !approval && approvals.length === 0;

  // Don't show if no action is needed
  if (!needsReview && !needsResubmit && !needsInitialRequest) {
    return null;
  }

  const getActionConfig = () => {
    if (needsReview) {
      return {
        title: 'Your Review Required',
        description: `${approval!.requesterInfo?.name || approval!.requestedByName || 'A team member'} is waiting for your approval`,
        icon: Clock,
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
        urgency: approval!.isOverdue ? 'OVERDUE' : approval!.priority,
      };
    }
    
    if (needsResubmit) {
      return {
        title: 'Document Rejected',
        description: `${latestRejected!.reviewerInfo?.name || latestRejected!.reviewerName || 'The reviewer'} rejected this document`,
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        urgency: 'HIGH',
      };
    }

    return {
      title: 'Request Approval',
      description: 'This document needs approval before it can be submitted',
      icon: User,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      urgency: 'NORMAL',
    };
  };

  const config = getActionConfig();
  const ActionIcon = config.icon;

  return (
    <Card className={`${config.borderColor} ${config.bgColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${config.bgColor} ${config.borderColor} border`}>
              <ActionIcon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{config.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {config.description}
              </p>
            </div>
          </div>
          
          {config.urgency !== 'NORMAL' && (
            <Badge 
              variant={config.urgency === 'OVERDUE' || config.urgency === 'URGENT' ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {config.urgency}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {needsReview && approval && (
          <div className="space-y-4">
            {/* Requester info */}
            <div className="flex items-center gap-3 p-3 bg-background rounded-lg border">
              <Avatar className="h-8 w-8">
                <AvatarImage src={approval.requesterInfo?.avatar} />
                <AvatarFallback className="text-xs">
                  {approval.requesterInfo?.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {approval.requesterInfo?.name || approval.requestedByName || 'Unknown'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
                  {approval.requesterInfo?.department && ` • ${approval.requesterInfo.department}`}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="text-right">
                <p className="text-sm font-medium">You</p>
                <p className="text-xs text-muted-foreground">Reviewer</p>
              </div>
            </div>

            {/* Review panel */}
            <ReviewDecisionPanel
              approval={approval}
              currentUserId={currentUserId}
              onSuccess={onActionComplete}
            />
          </div>
        )}

        {needsResubmit && latestRejected && (
          <div className="space-y-4">
            {/* Rejection details */}
            <div className="p-3 bg-background rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-800">Rejection Reason</span>
              </div>
              <p className="text-sm text-red-700">
                {latestRejected.reviewNote || 'No reason provided'}
              </p>
            </div>

            {/* Re-submit button */}
            <ResubmitForReviewButton
              approval={latestRejected}
              currentUserId={currentUserId}
              onSuccess={onActionComplete}
            />
          </div>
        )}

        {needsInitialRequest && (
          <RequestApprovalButton
            orgId={orgId}
            projectId={projectId}
            opportunityId={opportunityId}
            documentId={documentId}
            documentName={documentName}
            onSuccess={onActionComplete}
          />
        )}
      </CardContent>
    </Card>
  );
};
```

### 2.5 Mobile-Optimized View

**File:** `apps/web/features/document-approval/components/enhanced/ApprovalMobileView.tsx`

A mobile-first component that consolidates all approval information:

```typescript
'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  User,
  Calendar,
  MessageSquare 
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ApprovalActionCard } from './ApprovalActionCard';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

interface ApprovalMobileViewProps {
  approvals: EnhancedDocumentApprovalItem[];
  activeApproval: EnhancedDocumentApprovalItem | null;
  currentUserId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  documentName?: string;
  onActionComplete?: () => void;
}

export const ApprovalMobileView = ({
  approvals,
  activeApproval,
  currentUserId,
  orgId,
  projectId,
  opportunityId,
  documentId,
  documentName,
  onActionComplete,
}: ApprovalMobileViewProps) => {
  const [showHistory, setShowHistory] = useState(false);

  if (approvals.length === 0 && !activeApproval) return null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'PENDING':
        return <Clock className="h-4 w-4 text-amber-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const currentApproval = activeApproval || approvals[0];

  return (
    <div className="space-y-3">
      {/* Action Card - Always visible if there's an action needed */}
      <ApprovalActionCard
        approval={activeApproval}
        approvals={approvals}
        currentUserId={currentUserId}
        orgId={orgId}
        projectId={projectId}
        opportunityId={opportunityId}
        documentId={documentId}
        documentName={documentName}
        onActionComplete={onActionComplete}
      />

      {/* Current Status - Compact view */}
      {currentApproval && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {getStatusIcon(currentApproval.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge 
                    variant={currentApproval.status === 'APPROVED' ? 'default' : 
                             currentApproval.status === 'REJECTED' ? 'destructive' : 'secondary'}
                    className="text-xs"
                  >
                    {currentApproval.status.replace('_', ' ')}
                  </Badge>
                  {currentApproval.priority !== 'NORMAL' && (
                    <Badge variant="outline" className="text-xs">
                      {currentApproval.priority}
                    </Badge>
                  )}
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={currentApproval.requesterInfo?.avatar} />
                      <AvatarFallback className="text-xs">
                        {currentApproval.requesterInfo?.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">
                      {currentApproval.requesterInfo?.name || currentApproval.requestedByName || 'Unknown'}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={currentApproval.reviewerInfo?.avatar} />
                      <AvatarFallback className="text-xs">
                        {currentApproval.reviewerInfo?.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">
                      {currentApproval.reviewerInfo?.name || currentApproval.reviewerName || 'Unknown'}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDistanceToNow(new Date(currentApproval.requestedAt), { addSuffix: true })}
                    </div>
                    {currentApproval.reviewNote && (
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        Note
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Review note - if present */}
            {currentApproval.reviewNote && (
              <div className={`mt-3 p-2 rounded text-sm ${
                currentApproval.status === 'APPROVED' 
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                <p className="font-medium text-xs mb-1">
                  {currentApproval.status === 'APPROVED' ? 'Note:' : 'Reason:'}
                </p>
                <p>{currentApproval.reviewNote}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History Toggle - Only show if there are multiple approvals */}
      {approvals.length > 1 && (
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between" size="sm">
              <span>Approval History ({approvals.length})</span>
              {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-2">
            {approvals.slice(1).map((approval) => (
              <Card key={approval.approvalId} className="border-muted">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    {getStatusIcon(approval.status)}
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {approval.status.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {approval.requesterInfo?.name || approval.requestedByName} → {approval.reviewerInfo?.name || approval.reviewerName}
                      </p>
                      {approval.reviewNote && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          "{approval.reviewNote}"
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};
```

---

## 3. Enhanced Backend Data Enrichment

### 3.1 Enhanced Approval History Handler

**File:** `apps/functions/src/handlers/document-approval/get-enhanced-approval-history.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalHistory } from '@/helpers/document-approval';
import { getUserByOrgAndId } from '@/helpers/user';
import { getRFPDocument } from '@/helpers/rfp-document';
import type { EnhancedDocumentApprovalItem, EnhancedApprovalHistoryResponse } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';

const enrichApprovalWithUserInfo = async (
  approval: any,
  orgId: string,
): Promise<EnhancedDocumentApprovalItem> => {
  // Get requester info
  const requesterInfo = await getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null);
  
  // Get reviewer info
  const reviewerInfo = await getUserByOrgAndId(orgId, approval.reviewerId).catch(() => null);
  
  // Calculate time to review if completed
  let timeToReview: number | undefined;
  if (approval.reviewedAt) {
    const requestTime = new Date(approval.requestedAt).getTime();
    const reviewTime = new Date(approval.reviewedAt).getTime();
    timeToReview = Math.round((reviewTime - requestTime) / (1000 * 60)); // minutes
  }
  
  // Check if overdue (assuming 48 hours is the default deadline)
  const isOverdue = approval.status === 'PENDING' && 
    new Date().getTime() - new Date(approval.requestedAt).getTime() > 48 * 60 * 60 * 1000;

  return {
    ...approval,
    requesterInfo: requesterInfo ? {
      userId: requesterInfo.userId,
      name: requesterInfo.name,
      email: requesterInfo.email,
      avatar: requesterInfo.avatar,
      role: requesterInfo.role,
      department: requesterInfo.department,
    } : undefined,
    reviewerInfo: reviewerInfo ? {
      userId: reviewerInfo.userId,
      name: reviewerInfo.name,
      email: reviewerInfo.email,
      avatar: reviewerInfo.avatar,
      role: reviewerInfo.role,
      department: reviewerInfo.department,
    } : undefined,
    timeToReview,
    isOverdue,
    priority: approval.priority || 'NORMAL',
    tags: approval.tags || [],
  };
};

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};
  if (!projectId || !opportunityId || !documentId) {
    return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
  }

  const currentUserId = getUserId(event) ?? 'system';

  // Get basic approval history
  const history = await getApprovalHistory(orgId, projectId, opportunityId, documentId);
  
  // Enrich with user information
  const enrichedApprovals = await Promise.all(
    history.items.map(approval => enrichApprovalWithUserInfo(approval, orgId))
  );

  // Calculate summary statistics
  const totalPending = enrichedApprovals.filter(a => a.status === 'PENDING').length;
  const totalApproved = enrichedApprovals.filter(a => a.status === 'APPROVED').length;
  const totalRejected = enrichedApprovals.filter(a => a.status === 'REJECTED').length;
  const overdueCount = enrichedApprovals.filter(a => a.isOverdue).length;
  
  const completedApprovals = enrichedApprovals.filter(a => a.timeToReview);
  const averageReviewTime = completedApprovals.length > 0 
    ? Math.round(completedApprovals.reduce((sum, a) => sum + (a.timeToReview || 0), 0) / completedApprovals.length)
    : undefined;

  // Determine user context
  const activeApproval = enrichedApprovals.find(a => a.status === 'PENDING');
  const isRequester = activeApproval?.requestedBy === currentUserId;
  const isReviewer = activeApproval?.reviewerId === currentUserId;
  const hasActionItems = isReviewer || (isRequester && enrichedApprovals.some(a => a.status === 'REJECTED'));
  
  let nextAction: string | undefined;
  if (isReviewer && activeApproval) {
    nextAction = 'Review and approve/reject document';
  } else if (isRequester && enrichedApprovals.some(a => a.status === 'REJECTED')) {
    nextAction = 'Address feedback and re-submit for review';
  } else if (!activeApproval && enrichedApprovals.length === 0) {
    nextAction = 'Request approval from a team member';
  }

  const response: EnhancedApprovalHistoryResponse = {
    items: enrichedApprovals,
    count: enrichedApprovals.length,
    activeApproval: activeApproval ? await enrichApprovalWithUserInfo(activeApproval, orgId) : null,
    summary: {
      totalPending,
      totalApproved,
      totalRejected,
      averageReviewTime,
      overdueCount,
    },
    userContext: {
      isRequester,
      isReviewer,
      hasActionItems,
      nextAction,
    },
  };

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
```

---

## 4. Enhanced Frontend Hook

### 4.1 Enhanced Approval History Hook

**File:** `apps/web/features/document-approval/hooks/enhanced/useEnhancedApprovalHistory.ts`

```typescript
'use client';
import useSWR from 'swr';
import { buildApiUrl } from '@/lib/hooks/api-helpers';
import type { EnhancedApprovalHistoryResponse } from '@auto-rfp/core';

export const useEnhancedApprovalHistory = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
) => {
  const { data, error, mutate } = useSWR<EnhancedApprovalHistoryResponse>(
    buildApiUrl(`document-approval/enhanced-history?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}&documentId=${documentId}`),
  );

  return {
    approvals: data?.items ?? [],
    count: data?.count ?? 0,
    activeApproval: data?.activeApproval ?? null,
    summary: data?.summary,
    userContext: data?.userContext,
    isLoading: !error && !data,
    error,
    refresh: mutate,
  };
};
```

---

## 5. Updated RFP Document Card Integration

### 5.1 Enhanced RFP Document Card

**File:** `apps/web/components/rfp-documents/enhanced-rfp-document-card.tsx`

```typescript
'use client';
import React, { useCallback, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ApprovalMobileView } from '@/features/document-approval/components/enhanced/ApprovalMobileView';
import { ApprovalOverviewCard } from '@/features/document-approval/components/enhanced/ApprovalOverviewCard';
import { useEnhancedApprovalHistory } from '@/features/document-approval/hooks/enhanced/useEnhancedApprovalHistory';
import { useMediaQuery } from '@/hooks/use-media-query';
import type { RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';

interface EnhancedRFPDocumentCardProps {
  document: RFPDocumentItem;
  orgId: string;
  projectId: string;
  onSyncComplete: () => void;
}

export const EnhancedRFPDocumentCard = ({
  document: doc,
  orgId,
  projectId,
  onSyncComplete,
}: EnhancedRFPDocumentCardProps) => {
  const { userSub } = useAuth();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [refreshKey, setRefreshKey] = useState(0);

  const { 
    approvals, 
    activeApproval, 
    summary, 
    userContext, 
    refresh 
  } = useEnhancedApprovalHistory(
    orgId, 
    projectId, 
    doc.opportunityId, 
    doc.documentId
  );

  const handleApprovalChange = useCallback(() => {
    setRefreshKey(k => k + 1);
    refresh();
    onSyncComplete();
  }, [refresh, onSyncComplete]);

  if (!userSub) return null;

  return (
    <div className="space-y-4">
      {/* Document basic info card would go here */}
      
      {/* Approval section */}
      {(approvals.length > 0 || userContext?.hasActionItems) && (
        <div className="space-y-3">
          {isMobile ? (
            <ApprovalMobileView
              key={refreshKey}
              approvals={approvals}
              activeApproval={activeApproval}
              currentUserId={userSub}
              orgId={orgId}
              projectId={projectId}
              opportunityId={doc.opportunityId}
              documentId={doc.documentId}
              documentName={doc.name}
              onActionComplete={handleApprovalChange}
            />
          ) : (
            activeApproval && (
              <ApprovalOverviewCard
                approval={activeApproval}
                currentUserId={userSub}
              />
            )
          )}
        </div>
      )}
    </div>
  );
};
```

---

## 6. Implementation Tickets

### UI-1 · Enhanced Data Model & Schemas (1h) <!-- ⏳ PENDING -->

**Files to modify:**
- `packages/core/src/schemas/document-approval.ts`
  - Add `ApprovalUserInfoSchema`
  - Add `EnhancedDocumentApprovalItemSchema`
  - Add `EnhancedApprovalHistoryResponseSchema`
- `packages/core/src/schemas/index.ts` — export new types

**Tests to add:**
- `document-approval.test.ts` — test enhanced schemas

---

### UI-2 · Enhanced Backend Handler (1.5h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/functions/src/handlers/document-approval/get-enhanced-approval-history.ts`

**Files to modify:**
- `packages/infra/api/routes/document-approval.routes.ts` — add enhanced-history route

**Tests to create:**
- `get-enhanced-approval-history.test.ts`

---

### UI-3 · Enhanced Frontend Hook (30min) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/web/features/document-approval/hooks/enhanced/useEnhancedApprovalHistory.ts`

---

### UI-4 · Enhanced UI Components - Core (2h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/web/features/document-approval/components/enhanced/ApprovalOverviewCard.tsx`
- `apps/web/features/document-approval/components/enhanced/ApprovalTimelineCard.tsx`
- `apps/web/features/document-approval/components/shared/UserAvatar.tsx`
- `apps/web/features/document-approval/components/shared/ApprovalStatusIcon.tsx`

---

### UI-5 · Enhanced UI Components - Actions & Mobile (2h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/web/features/document-approval/components/enhanced/ApprovalActionCard.tsx`
- `apps/web/features/document-approval/components/enhanced/ApprovalMobileView.tsx`
- `apps/web/features/document-approval/utils/approval-utils.ts`

---

### UI-6 · Enhanced RFP Document Card Integration (1h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/web/components/rfp-documents/enhanced-rfp-document-card.tsx`

**Files to modify:**
- `apps/web/components/rfp-documents/rfp-documents-content.tsx` — integrate enhanced card
- `apps/web/features/document-approval/index.ts` — add enhanced exports

---

### UI-7 · Responsive Design & Mobile Optimization (1h) <!-- ⏳ PENDING -->

**Files to modify:**
- All enhanced components — add responsive classes and mobile-first design
- `apps/web/hooks/use-media-query.ts` — create if doesn't exist

---

### UI-8 · Tests & Documentation (1h) <!-- ⏳ PENDING -->

**Files to create/update:**
- Component tests for all enhanced components
- Hook tests for enhanced hooks
- Update Storybook stories if applicable

---

## 7. Migration Strategy

### Phase 1: Enhanced Backend (Tickets UI-1, UI-2, UI-3)
- Add enhanced schemas and backend handler
- Create enhanced frontend hook
- No UI changes yet — purely additive

### Phase 2: New UI Components (Tickets UI-4, UI-5)
- Build enhanced UI components
- Test in isolation
- No integration yet

### Phase 3: Integration (Tickets UI-6, UI-7)
- Integrate enhanced components into RFP document cards
- Add feature flag to toggle between old and new UI
- Mobile optimization

### Phase 4: Testing & Rollout (Ticket UI-8)
- Comprehensive testing
- Gradual rollout with feature flag
- Remove legacy components once stable

---

## 8. Acceptance Criteria

### Enhanced Information Display
- [ ] Users can clearly see who requested approval and when
- [ ] Users can clearly see who the assigned reviewer is
- [ ] Users can see reviewer's role and department (if available)
- [ ] Users can see approval timeline with visual indicators
- [ ] Users can see review time metrics and deadlines

### Improved UI/UX
- [ ] Clean, modern visual design with proper hierarchy
- [ ] Mobile-responsive components that work on all screen sizes
- [ ] Clear action items for current user based on their role
- [ ] Contextual information shown based on user's involvement
- [ ] Reduced information overload with collapsible sections

### Better Workflow Visibility
- [ ] Clear indication of approval status at a glance
- [ ] Visual timeline showing approval progression
- [ ] Overdue approvals highlighted appropriately
- [ ] Next actions clearly communicated to users
- [ ] Summary statistics for approval performance

### Technical Requirements
- [ ] All components are responsive and mobile-first
- [ ] TypeScript compiles with no errors
- [ ] Components follow existing design system patterns
- [ ] Proper error handling and loading states
- [ ] Accessibility standards met (ARIA labels, keyboard navigation)

---

## 9. Summary of New Files

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/document-approval.ts` | Enhanced schemas with user info | ⏳ PENDING |
| `apps/functions/src/handlers/document-approval/get-enhanced-approval-history.ts` | Enhanced backend handler | ⏳ PENDING |
| `apps/web/features/document-approval/hooks/enhanced/useEnhancedApprovalHistory.ts` | Enhanced frontend hook | ⏳ PENDING |
| `apps/web/features/document-approval/components/enhanced/ApprovalOverviewCard.tsx` | Main approval status card | ⏳ PENDING |
| `apps/web/features/document-approval/components/enhanced/ApprovalTimelineCard.tsx` | Visual approval timeline | ⏳ PENDING |
| `apps/web/features/document-approval/components/enhanced/ApprovalActionCard.tsx` | User action items card | ⏳ PENDING |
| `apps/web/features/document-approval/components/enhanced/ApprovalMobileView.tsx` | Mobile-optimized view | ⏳ PENDING |
| `apps/web/components/rfp-documents/enhanced-rfp-document-card.tsx` | Enhanced document card | ⏳ PENDING |

**Total estimated effort: ~9 hours**

---

## 10. Before/After Comparison

### Current UI Issues:
- Approval information scattered across multiple small components
- No clear visual hierarchy or status indication
- Poor mobile experience with cramped layouts
- Lack of context about who requested/approved and when
- Information overload in approval history

### Enhanced UI Benefits:
- **Clear Visual Hierarchy**: Status, participants, and actions clearly organized
- **Rich Context**: Full user information with avatars, roles, and departments
- **Mobile-First Design**: Responsive components optimized for all screen sizes
- **Action-Oriented**: Clear indication of what each user needs to do
- **Better Information Architecture**: Timeline view, summary stats, and contextual details
- **Improved Accessibility**: Proper ARIA labels, keyboard navigation, and screen reader support

This enhanced system transforms the approval workflow from a confusing, scattered experience into a clear, actionable, and informative process that works beautifully on all devices.