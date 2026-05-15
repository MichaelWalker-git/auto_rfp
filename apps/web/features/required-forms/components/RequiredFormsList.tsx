'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useApi, buildApiUrl } from '@/lib/hooks/api-helpers';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { RequiredFormItem, FormProcessingStatus, RequiredFormsListResponse } from '@auto-rfp/core';

interface RequiredFormsListProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

const STATUS_CONFIG: Record<FormProcessingStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof Clock }> = {
  DETECTED: { label: 'Detected', variant: 'outline', icon: Clock },
  ANALYZING: { label: 'Analyzing', variant: 'secondary', icon: Clock },
  READY_FOR_REVIEW: { label: 'Review', variant: 'default', icon: AlertTriangle },
  REVIEWED: { label: 'Reviewed', variant: 'secondary', icon: CheckCircle2 },
  EXPORTED: { label: 'Exported', variant: 'secondary', icon: CheckCircle2 },
  FAILED: { label: 'Failed', variant: 'destructive', icon: AlertTriangle },
};

const FormRow = ({ form, orgId, projectId, opportunityId }: { form: RequiredFormItem; orgId: string; projectId: string; opportunityId: string }) => {
  const config = STATUS_CONFIG[form.status] ?? STATUS_CONFIG.DETECTED;
  const Icon = config.icon;

  return (
    <Link
      href={`/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/forms/${form.formId}`}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50',
        form.status === 'FAILED' && 'border-red-200 bg-red-50/50',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{form.name}</p>
        <p className="text-xs text-muted-foreground">
          {form.sourceFileName}
          {form.totalFieldCount > 0 && (
            <> &middot; {form.autoFillPercentage}% filled &middot; {form.manualFieldCount} manual</>
          )}
        </p>
      </div>
      <Badge variant={config.variant} className="gap-1 text-xs">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    </Link>
  );
};

export const RequiredFormsList = ({ orgId, projectId, opportunityId }: RequiredFormsListProps) => {
  const url = orgId && projectId && opportunityId
    ? buildApiUrl('/required-forms/list', { orgId, projectId, opportunityId })
    : null;

  const { data, isLoading } = useApi<RequiredFormsListResponse>(url, url, {
    refreshInterval: 10_000,
  });

  const forms = data?.forms ?? [];

  if (isLoading && forms.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Required Forms</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Required Forms</CardTitle>
            <CardDescription className="mt-1">
              {forms.length > 0
                ? `${forms.length} form${forms.length === 1 ? '' : 's'} detected in solicitation documents`
                : 'Forms will appear after solicitation documents are processed'}
            </CardDescription>
          </div>
          {forms.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {forms.filter((f) => f.status === 'READY_FOR_REVIEW' || f.status === 'REVIEWED').length}/{forms.length} ready
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {forms.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No required forms detected yet.</p>
        ) : (
          <div className="space-y-2">
            {forms.map((form) => (
              <FormRow key={form.formId} form={form} orgId={orgId} projectId={projectId} opportunityId={opportunityId} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
