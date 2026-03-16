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

/**
 * Helper to resolve a human-readable display name.
 * Returns the stored name only when it looks like a real name (not a raw UUID/ID).
 */
const resolveDisplayName = (
  name: string | undefined,
  fallback = 'Unknown',
): string => {
  if (!name) return fallback;
  if (name.length > 50 || /^[0-9a-f]{8}-/.test(name)) return fallback;
  return name;
};

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
      case 'REVISION_REQUESTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'CANCELLED':
        return <XCircle className="h-4 w-4 text-gray-600" />;
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
                      <AvatarFallback className="text-xs">
                        {resolveDisplayName(currentApproval.requesterInfo?.name || currentApproval.requestedByName).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">
                      {resolveDisplayName(currentApproval.requesterInfo?.name || currentApproval.requestedByName)}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-xs">
                        {resolveDisplayName(currentApproval.reviewerInfo?.name || currentApproval.reviewerName).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">
                      {resolveDisplayName(currentApproval.reviewerInfo?.name || currentApproval.reviewerName)}
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
                        {resolveDisplayName(approval.requesterInfo?.name || approval.requestedByName)} → {resolveDisplayName(approval.reviewerInfo?.name || approval.reviewerName)}
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