'use client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { useSubmissionReadiness } from '../hooks/useSubmissionReadiness';
import type { ReadinessCheckItem } from '@auto-rfp/core';

interface SubmissionChecklistProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

const CheckRow = ({ check }: { check: ReadinessCheckItem }) => {
  const icon = check.passed
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
    : check.blocking
      ? <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;

  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${
          check.passed ? 'text-foreground' : check.blocking ? 'text-destructive' : 'text-amber-700'
        }`}>
          {check.label}
        </p>
        {check.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
        )}
      </div>
      {!check.blocking && !check.passed && (
        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 shrink-0">
          Warning
        </Badge>
      )}
    </div>
  );
};

export const SubmissionChecklist = ({ orgId, projectId, oppId }: SubmissionChecklistProps) => {
  const { readiness, isReady, checks, blockingFails, isLoading } = useSubmissionReadiness(orgId, projectId, oppId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!readiness) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {isReady
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              : <Clock className="h-4 w-4 text-amber-500" />}
            Submission Readiness
          </CardTitle>
          <Badge variant={isReady ? 'default' : 'secondary'}>
            {isReady
              ? 'Ready to Submit'
              : `${blockingFails} issue${blockingFails !== 1 ? 's' : ''} to resolve`}
          </Badge>
        </div>
        <CardDescription>
          Complete all required steps before submitting your proposal to the agency.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
