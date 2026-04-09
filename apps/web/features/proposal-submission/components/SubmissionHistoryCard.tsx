'use client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, FileText, Send, Undo2 } from 'lucide-react';
import { useSubmissionHistory } from '../hooks/useSubmissionHistory';
import { WithdrawSubmissionButton } from './WithdrawSubmissionButton';
import type { ProposalSubmissionItem } from '@auto-rfp/core';

interface SubmissionHistoryCardProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

const STATUS_CONFIG = {
  SUBMITTED: { label: 'Submitted', variant: 'default' as const },
  WITHDRAWN: { label: 'Withdrawn', variant: 'secondary' as const },
};

const METHOD_LABELS: Record<ProposalSubmissionItem['submissionMethod'], string> = {
  PORTAL: 'Agency Portal',
  EMAIL: 'Email',
  MANUAL: 'Manual',
  HAND_DELIVERY: 'Hand Delivery',
  OTHER: 'Other',
};

export const SubmissionHistoryCard = ({ orgId, projectId, oppId }: SubmissionHistoryCardProps) => {
  const { submissions, count, isLoading, refresh } = useSubmissionHistory(orgId, projectId, oppId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (count === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Send className="h-4 w-4" />
          Submission History
        </CardTitle>
        <Badge variant="outline" className="text-xs">
          {count} submission{count !== 1 ? 's' : ''}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {submissions.map((sub, idx) => {
            const cfg = STATUS_CONFIG[sub.status];
            return (
              <div
                key={sub.submissionId ?? `sub-${idx}`}
                className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={cfg.variant} className="text-xs">
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {METHOD_LABELS[sub.submissionMethod]}
                    </span>
                    {sub.submittedAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(sub.submittedAt), 'MMM d, yyyy HH:mm')}
                      </span>
                    )}
                    {sub.submittedByName && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub.submittedByName) && (
                      <span className="text-xs text-muted-foreground">
                        by {sub.submittedByName}
                      </span>
                    )}
                  </div>
                  {sub.submissionReference && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Ref: <code className="font-mono">{sub.submissionReference}</code>
                    </p>
                  )}
                  {sub.portalUrl && (
                    <a
                      href={sub.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View in Portal
                    </a>
                  )}
                  {sub.submissionNotes && (
                    <p className="text-xs text-muted-foreground italic">{sub.submissionNotes}</p>
                  )}
                  {sub.status === 'WITHDRAWN' && sub.withdrawalReason && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Undo2 className="h-3 w-3" />
                      Withdrawn: {sub.withdrawalReason}
                    </p>
                  )}
                </div>
                {sub.status === 'SUBMITTED' && (
                  <WithdrawSubmissionButton
                    orgId={orgId}
                    projectId={projectId}
                    oppId={oppId}
                    submissionId={sub.submissionId}
                    onSuccess={refresh}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
