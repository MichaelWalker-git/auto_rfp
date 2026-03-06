'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, AlertTriangle, CheckCircle2, Clock, RefreshCw, CloudOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ApnRegistrationBadge } from './ApnRegistrationBadge';
import { ApnRetryButton } from './ApnRetryButton';
import { useApnRegistration } from '../hooks/useApnRegistration';
import type { ApnRegistrationStatus } from '@auto-rfp/core';

interface ApnRegistrationCardProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

const STATUS_ICON: Record<ApnRegistrationStatus, React.ReactNode> = {
  PENDING:        <Clock className="h-4 w-4 text-slate-400" />,
  REGISTERED:     <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  FAILED:         <AlertTriangle className="h-4 w-4 text-destructive" />,
  RETRYING:       <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />,
  NOT_CONFIGURED: <CloudOff className="h-4 w-4 text-slate-400" />,
};

export const ApnRegistrationCard = ({ orgId, projectId, oppId }: ApnRegistrationCardProps) => {
  const { registration, isLoading, refresh } = useApnRegistration(orgId, projectId, oppId);

  // Don't render the card at all if there's no registration and we're done loading
  if (!isLoading && !registration) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">AWS Partner Network</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!registration) return null;

  const { status, apnOpportunityId, apnOpportunityUrl, lastError, lastAttemptAt, retryCount } = registration;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {STATUS_ICON[status]}
          AWS Partner Network
        </CardTitle>
        <ApnRegistrationBadge
          status={status}
          apnOpportunityUrl={apnOpportunityUrl}
        />
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {/* Registered — show APN opportunity link */}
          {status === 'REGISTERED' && apnOpportunityId && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">APN Opportunity ID</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                  {apnOpportunityId}
                </code>
                {apnOpportunityUrl && (
                  <a
                    href={apnOpportunityUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    View in Partner Portal
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Pending / Retrying — show info message */}
          {(status === 'PENDING' || status === 'RETRYING') && (
            <p className="text-sm text-muted-foreground">
              {status === 'PENDING'
                ? 'Registration is queued and will be processed shortly.'
                : 'Retrying registration with AWS Partner Central…'}
            </p>
          )}

          {/* Failed — show error + retry */}
          {status === 'FAILED' && (
            <div className="space-y-3">
              {lastError && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs ml-1">
                    {lastError}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-3">
                <ApnRetryButton registration={registration} onSuccess={refresh} />
                {retryCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {retryCount} {retryCount === 1 ? 'retry' : 'retries'} attempted
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Last attempt timestamp */}
          {lastAttemptAt && (
            <p className="text-xs text-muted-foreground pt-1 border-t">
              Last attempt {formatDistanceToNow(new Date(lastAttemptAt), { addSuffix: true })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
