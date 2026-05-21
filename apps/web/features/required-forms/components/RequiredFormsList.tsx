'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, ClipboardList, ExternalLink, Paperclip, Trash2 } from 'lucide-react';

import { useApi } from '@/lib/hooks/api-helpers';
import { buildApiUrl } from '@/lib/hooks/api-helpers';
import { apiMutate } from '@/lib/hooks/api-helpers';
import { useAuth } from '@/components/AuthProvider';
import { ReviewRequiredBanner } from './ReviewRequiredBanner';
import { useAttachFormToProposal } from '../hooks/useAttachFormToProposal';

import type { RequiredFormItem, RequiredFormsListResponse } from '@auto-rfp/core';

interface RequiredFormsListProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

const FORM_TYPE_LABEL: Record<string, string> = {
  PDF_FILLABLE: 'PDF · fillable',
  PDF_SCANNED: 'PDF · scanned',
  XLSX_MATRIX: 'XLSX · matrix',
  XLSX_FORM: 'XLSX · form',
  CONTRACT_TEMPLATE: 'Contract template',
};

const STATUS_TONE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  READY: 'bg-emerald-100 text-emerald-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
};

const FormRow = ({
  form, orgId, projectId, opportunityId, onDeleted, isAdmin,
}: {
  form: RequiredFormItem;
  orgId: string;
  projectId: string;
  opportunityId: string;
  onDeleted: () => void;
  isAdmin: boolean;
}) => {
  const { toast } = useToast();
  const { attach, detach } = useAttachFormToProposal();

  const handleAttach = useCallback(async () => {
    try {
      await attach({ orgId, projectId, opportunityId, formId: form.formId });
      toast({ title: 'Attached to proposal', description: form.name });
    } catch (err) {
      toast({
        title: 'Failed to attach',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [attach, orgId, projectId, opportunityId, form.formId, form.name, toast]);

  const handleDetach = useCallback(async () => {
    try {
      await detach({ orgId, projectId, opportunityId, formId: form.formId });
      toast({ title: 'Detached from proposal', description: form.name });
    } catch (err) {
      toast({
        title: 'Failed to detach',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [detach, orgId, projectId, opportunityId, form.formId, form.name, toast]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Delete required form "${form.name}"? This cannot be undone.`)) return;
    try {
      const url = buildApiUrl('/required-forms/delete', { orgId, projectId, opportunityId, formId: form.formId });
      await apiMutate<{ ok: boolean }>(url, 'DELETE');
      onDeleted();
      toast({ title: 'Form deleted' });
    } catch (err) {
      toast({
        title: 'Failed to delete',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [orgId, projectId, opportunityId, form.formId, form.name, toast, onDeleted]);

  const isMatrix = form.formType === 'XLSX_MATRIX';
  const detailHref = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/forms/${form.formId}`;

  return (
    <div className="rounded-xl border bg-background p-3" data-doc-status={form.status}>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted hidden sm:flex items-center justify-center shrink-0">
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={detailHref} className="font-medium hover:underline truncate">
              {form.name}
            </Link>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${STATUS_TONE[form.status] ?? 'bg-slate-100 text-slate-700'}`}
            >
              {form.status}
            </span>
            <Badge variant="secondary" className="text-xs">{FORM_TYPE_LABEL[form.formType] ?? form.formType}</Badge>
            {form.attachedToProposal && (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                In proposal
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {form.totalFieldCount} fields · {form.manualFieldCount} need review · {form.autoFillPercentage}% auto-filled
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button asChild size="sm" variant="outline">
            <Link href={detailHref}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Open
            </Link>
          </Button>
          {form.status === 'DONE' && (
            form.attachedToProposal ? (
              <Button size="sm" variant="ghost" onClick={handleDetach} title="Remove from proposal">
                <Paperclip className="h-3.5 w-3.5 mr-1" />
                Detach
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={handleAttach}>
                <Paperclip className="h-3.5 w-3.5 mr-1" />
                Attach
              </Button>
            )
          )}
          {isAdmin && (
            <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={handleDelete} title="Delete form">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isMatrix && form.reviewRequired && (
        <div className="mt-2.5">
          <ReviewRequiredBanner />
        </div>
      )}
    </div>
  );
};

/**
 * Dedicated section listing the opportunity's required forms, separated from
 * solicitation documents. Renders the Review Required banner for matrix forms,
 * an attach/detach control once the form is DONE, and a delete button only
 * for admins (mirrors the backend RBAC tightening).
 */
export const RequiredFormsList = ({ orgId, projectId, opportunityId }: RequiredFormsListProps) => {
  const url = buildApiUrl('/required-forms/list', { orgId, projectId, opportunityId });
  const { data, isLoading, mutate } = useApi<RequiredFormsListResponse>(url, url, {
    refreshInterval: 10_000,
    dedupingInterval: 5_000,
  });
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';

  const forms = data?.forms ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">Required Forms</CardTitle>
            <CardDescription className="mt-1">
              {isLoading
                ? 'Loading…'
                : forms.length === 0
                  ? 'No required forms detected for this opportunity'
                  : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'} detected · ${forms.filter((f) => f.attachedToProposal).length} in proposal`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : forms.length === 0 ? (
          <div className="text-center py-6">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Forms appear here automatically when a solicitation document is processed.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {forms.map((form) => (
              <FormRow
                key={form.formId}
                form={form}
                orgId={orgId}
                projectId={projectId}
                opportunityId={opportunityId}
                isAdmin={isAdmin}
                onDeleted={() => mutate()}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
