'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Paperclip,
  PaperclipIcon,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { useApi, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
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
  READY: 'bg-emerald-50 text-emerald-700',
  DONE: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-50 text-rose-700',
};

const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const FormRow = ({
  form, orgId, projectId, opportunityId, onChanged, isAdmin,
}: {
  form: RequiredFormItem;
  orgId: string;
  projectId: string;
  opportunityId: string;
  onChanged: () => void;
  isAdmin: boolean;
}) => {
  const { toast } = useToast();
  const { attach, detach } = useAttachFormToProposal();

  const handleAttach = useCallback(async () => {
    try {
      await attach({ orgId, projectId, opportunityId, formId: form.formId });
      toast({ title: 'Attached to proposal', description: form.name });
      onChanged();
    } catch (err) {
      toast({
        title: 'Failed to attach',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [attach, orgId, projectId, opportunityId, form.formId, form.name, toast, onChanged]);

  const handleDetach = useCallback(async () => {
    try {
      await detach({ orgId, projectId, opportunityId, formId: form.formId });
      toast({ title: 'Detached from proposal', description: form.name });
      onChanged();
    } catch (err) {
      toast({
        title: 'Failed to detach',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [detach, orgId, projectId, opportunityId, form.formId, form.name, toast, onChanged]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Delete required form "${form.name}"? This cannot be undone.`)) return;
    try {
      const url = buildApiUrl('/required-forms/delete', { orgId, projectId, opportunityId, formId: form.formId });
      await apiMutate<{ ok: boolean }>(url, 'DELETE');
      toast({ title: 'Form deleted' });
      onChanged();
    } catch (err) {
      toast({
        title: 'Failed to delete',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [orgId, projectId, opportunityId, form.formId, form.name, toast, onChanged]);

  const isMatrix = form.formType === 'XLSX_MATRIX';
  const isXlsx = form.formType === 'XLSX_MATRIX' || form.formType === 'XLSX_FORM';
  const FormIcon = isXlsx ? FileSpreadsheet : FileText;
  const detailHref = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/forms/${form.formId}`;

  return (
    <div
      className={cn('rounded-xl border bg-background p-3 hover:bg-muted/50 transition-colors')}
      data-doc-status={form.status}
    >
      <Link href={detailHref} className="block">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted hidden sm:flex items-center justify-center shrink-0">
            <FormIcon className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium truncate text-sm" title={form.name}>
                {form.name}
              </p>
              <span
                className={cn('text-xs px-1.5 py-0.5 rounded font-medium', STATUS_TONE[form.status] ?? 'bg-slate-100 text-slate-700')}
              >
                {form.status}
              </span>
              {form.attachedToProposal && (
                <Badge variant="secondary" className="gap-1 text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  In proposal
                </Badge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="font-medium">{FORM_TYPE_LABEL[form.formType] ?? form.formType}</span>
              <span>·</span>
              <span>{form.totalFieldCount} fields</span>
              {form.manualFieldCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-amber-700">{form.manualFieldCount} need review</span>
                </>
              )}
              {form.autoFillPercentage > 0 && (
                <>
                  <span>·</span>
                  <span className="text-emerald-700">{form.autoFillPercentage}% auto-filled</span>
                </>
              )}
              <span>·</span>
              <span>{formatDateTime(form.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0" title="Edit form">
              <Link href={detailHref}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.preventDefault()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={detailHref} className="flex items-center">
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Link>
                </DropdownMenuItem>
                {form.status === 'DONE' && (
                  form.attachedToProposal ? (
                    <DropdownMenuItem onClick={handleDetach}>
                      <PaperclipIcon className="h-4 w-4 mr-2" /> Detach from proposal
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={handleAttach}>
                      <Paperclip className="h-4 w-4 mr-2" /> Attach to proposal
                    </DropdownMenuItem>
                  )
                )}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Link>

      {form.status === 'FAILED' && form.errorMessage && (
        <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {form.errorMessage}
        </p>
      )}

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
 * solicitation documents. Mirrors the visual pattern used by OpportunityRFPDocuments
 * (Card wrapper + rounded-xl row with icon + meta line + dropdown actions).
 */
export const RequiredFormsList = ({ orgId, projectId, opportunityId }: RequiredFormsListProps) => {
  const url = orgId && projectId && opportunityId
    ? buildApiUrl('/required-forms/list', { orgId, projectId, opportunityId })
    : null;
  const { data, isLoading, mutate } = useApi<RequiredFormsListResponse>(url, url, {
    refreshInterval: 10_000,
    dedupingInterval: 5_000,
  });
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';

  const forms = data?.forms ?? [];
  const attachedCount = forms.filter((f) => f.attachedToProposal).length;

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
                  : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'} detected${attachedCount > 0 ? ` · ${attachedCount} in proposal` : ''}`}
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
                onChanged={() => mutate()}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
