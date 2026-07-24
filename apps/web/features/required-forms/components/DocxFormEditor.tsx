'use client';

import { useState, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, AlertTriangle, FileText } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { usePermission } from '@/components/permission-wrapper';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import Link from 'next/link';
import type { DetectedFormField, RequiredFormItem } from '@auto-rfp/core';

interface DocxFormEditorProps {
  doc: RequiredFormItem;
  orgId: string;
  onFieldUpdated?: () => void;
}

/**
 * Field-list editor for DOCX forms. DOCX-extracted fields have no PDF geometry
 * (null boundingBox), so we render a plain label/value list instead of the
 * PDF overlay editor. Values come from company-profile autofill; MANUAL_REQUIRED
 * fields (signatures, dates, contract numbers) are flagged for the user.
 */
export const DocxFormEditor = ({ doc, orgId, onFieldUpdated }: DocxFormEditorProps) => {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const canEdit = usePermission('form:edit');

  const [values, setValues] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fields = (doc.fields ?? []) as DetectedFormField[];
  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  // Seed local values from the server fields whenever they change (poll / reprocess).
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const f of fields) seeded[f.fieldId] = f.value ?? '';
    setValues(seeded);
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.formId, doc.updatedAt]);

  const handleValueChange = useCallback((fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setIsDirty(true);
  }, []);

  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      const allFields = fields.map((f) => {
        const value = values[f.fieldId] ?? f.value ?? null;
        // A previously-empty field that now has a value becomes AUTO_FILLED
        // (user-entered). Keep MANUAL_REQUIRED / AUTO_FILLED as-is otherwise.
        const status = f.status === 'EMPTY' && value ? ('AUTO_FILLED' as const) : f.status;
        return { ...f, value, status };
      });

      await apiMutate(buildApiUrl('/required-forms/save-fields', { orgId }), 'PUT', {
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        formId: doc.formId,
        fields: allFields,
      });

      setIsDirty(false);
      toast({ title: 'Saved' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [fields, values, doc, orgId, toast, onFieldUpdated]);

  const handleReprocess = useCallback(async () => {
    const ok = await confirm({
      title: 'Reprocess form?',
      description: 'This will re-extract fields and re-fill. Manual edits will be lost.',
      confirmLabel: 'Reprocess',
      variant: 'destructive',
    });
    if (!ok) return;
    setReprocessing(true);
    try {
      await apiMutate(buildApiUrl('/required-forms/reprocess', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }), 'POST', {});
      toast({ title: 'Form reprocessed' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Reprocess failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setReprocessing(false);
    }
  }, [doc, orgId, toast, onFieldUpdated, confirm]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await apiFetcher<{ downloadUrl: string }>(
        buildApiUrl('/required-forms/export', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }),
      );
      if (result?.downloadUrl) window.open(result.downloadUrl, '_blank');
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [doc, orgId, toast]);

  const handleDeleteForm = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete this form?',
      description: 'This will permanently remove the form and all its fields.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiMutate(buildApiUrl('/required-forms/delete', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }), 'DELETE');
      toast({ title: 'Form deleted' });
      window.location.href = backUrl;
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error)?.message, variant: 'destructive' });
    }
  }, [doc, orgId, toast, backUrl, confirm]);

  const filledCount = fields.filter((f) => (values[f.fieldId] ?? f.value)).length;
  const manualCount = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href={backUrl}><ArrowLeft className="h-4 w-4" />Back</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <p className="text-xs text-muted-foreground">{doc.sourceFileName}</p>
        </div>
        <Badge variant="outline" className="text-xs">{doc.status}</Badge>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={handleReprocess} disabled={reprocessing} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', reprocessing && 'animate-spin')} />
            Reprocess
          </Button>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || reprocessing || isDirty} className="gap-1.5">
                  {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export
                </Button>
              </span>
            </TooltipTrigger>
            {(isDirty || reprocessing) && (
              <TooltipContent side="top">
                <p>{reprocessing ? 'Wait for processing to complete' : 'Save the form before exporting'}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" variant={isDirty ? 'default' : 'outline'} onClick={handleSaveAll} disabled={isSaving || !isDirty || reprocessing} className="gap-1.5">
          {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
        <PermissionDeleteButton
          requiredPermission="org:delete"
          onClick={handleDeleteForm}
          size="sm"
          variant="ghost"
          className="text-red-500 hover:text-red-700 hover:bg-red-50"
          ariaLabel="Delete form"
          deniedTooltip="Only admins can delete required forms."
        />
      </div>

      <div className={cn('flex-1 overflow-y-auto bg-gray-50', reprocessing && 'opacity-50 pointer-events-none')}>
        <div className="mx-auto max-w-2xl px-4 py-6">
          {doc.status === 'FAILED' && doc.errorMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div><p className="font-medium">Form processing failed</p><p className="mt-0.5 text-red-700/90">{doc.errorMessage}</p></div>
            </div>
          )}

          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">Fields</p>
            <p className="text-[11px] text-gray-500">
              {filledCount}/{fields.length} filled{manualCount > 0 ? ` · ${manualCount} need you` : ''}
            </p>
          </div>

          {fields.length === 0 ? (
            <div className="rounded-lg border bg-white px-4 py-10 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No fillable fields were detected in this document.</p>
              <p className="mt-1 text-xs text-slate-400">Use Reprocess to try again, or Export to download the source file.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fields.map((f) => {
                const isManual = f.status === 'MANUAL_REQUIRED';
                const isAutoFilled = f.status === 'AUTO_FILLED';
                const value = values[f.fieldId] ?? '';
                return (
                  <div
                    key={f.fieldId}
                    className={cn(
                      'rounded-lg border bg-white px-3 py-2.5',
                      isManual && 'border-amber-300/70',
                      isAutoFilled && 'border-emerald-300/60',
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      {isManual && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                      <label className="text-[11px] font-medium text-slate-600">{f.label}</label>
                      {isAutoFilled && (
                        <Badge variant="secondary" className="ml-auto bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                          Auto-filled
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={value}
                      readOnly={!canEdit}
                      onChange={(e) => handleValueChange(f.fieldId, e.target.value)}
                      placeholder={isManual ? (f.manualReason ?? 'Needs your input') : 'Enter value'}
                      className={cn('h-8 text-sm', isManual && !value && 'placeholder:text-amber-600/70')}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog />
    </div>
  );
};
