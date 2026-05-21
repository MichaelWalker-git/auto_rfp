'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ExternalLink, Paperclip, Trash2 } from 'lucide-react';

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
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={detailHref} className="font-medium hover:underline">
              {form.name}
            </Link>
            <span
              data-doc-status={form.status}
              className={`text-xs px-1.5 py-0.5 rounded ${STATUS_TONE[form.status] ?? 'bg-slate-100 text-slate-700'}`}
            >
              {form.status}
            </span>
            <Badge variant="secondary">{FORM_TYPE_LABEL[form.formType] ?? form.formType}</Badge>
            {form.attachedToProposal && (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                In proposal
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {form.totalFieldCount} fields · {form.manualFieldCount} need review · {form.autoFillPercentage}% auto-filled
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={detailHref}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Open
            </Link>
          </Button>
          {form.status === 'DONE' && (
            form.attachedToProposal ? (
              <Button size="sm" variant="ghost" onClick={handleDetach}>
                <Paperclip className="h-3.5 w-3.5 mr-1" />
                Detach
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={handleAttach}>
                <Paperclip className="h-3.5 w-3.5 mr-1" />
                Attach to proposal
              </Button>
            )
          )}
          {isAdmin && (
            <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isMatrix && form.reviewRequired && <ReviewRequiredBanner />}
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

  if (isLoading) {
    return <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Loading required forms…</div>;
  }
  const forms = data?.forms ?? [];
  if (forms.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        No required forms detected. Forms appear here automatically when a solicitation document is processed.
      </div>
    );
  }

  return (
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
  );
};
