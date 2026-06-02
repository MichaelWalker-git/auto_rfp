'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Download,
  FileDown,
  Loader2,
  Merge,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
  useExportAllRequiredForms,
  useExportMergedRequiredForms,
  type ExportAllRequiredFormsRequest,
} from '../hooks/useExportAllRequiredForms';
import type { RequiredFormItem } from '@auto-rfp/core';

type ExportMode = 'individual' | 'merged';
type WizardStep = 'mode' | 'configure';

const FORM_TYPE_LABEL: Record<string, string> = {
  PDF_FILLABLE: 'PDF · fillable',
  PDF_SCANNED: 'PDF · scanned',
  XLSX_MATRIX: 'XLSX · matrix',
  XLSX_FORM: 'XLSX · form',
  CONTRACT_TEMPLATE: 'Contract template',
};

interface ExportAllRequiredFormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId: string;
  opportunityTitle?: string;
  forms: RequiredFormItem[];
}

export const ExportAllRequiredFormsDialog = ({
  open,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  opportunityTitle,
  forms,
}: ExportAllRequiredFormsDialogProps) => {
  const { toast } = useToast();
  const { trigger: exportAll } = useExportAllRequiredForms(orgId);
  const { trigger: exportMerged } = useExportMergedRequiredForms(orgId);

  const [step, setStep] = useState<WizardStep>('mode');
  const [mode, setMode] = useState<ExportMode>('individual');
  const [isLoading, setIsLoading] = useState(false);

  // Individual mode state
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');

  // Merged mode state
  const exportableForms = useMemo(
    () => forms.filter((f) => f.fields.length > 0 && f.sourceFileKey),
    [forms],
  );
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>(() =>
    exportableForms.map((f) => f.formId),
  );
  const [formOrder, setFormOrder] = useState<string[]>(() => exportableForms.map((f) => f.formId));
  const [pageBreakBetween, setPageBreakBetween] = useState(true);
  const defaultFileName = useMemo(
    () => (opportunityTitle ? `${opportunityTitle} Required Forms` : 'Required Forms Package'),
    [opportunityTitle],
  );
  const [mergedFileName, setMergedFileName] = useState(defaultFileName);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep('mode');
      setIsLoading(false);
      // Use the stable memoized defaultFileName value
      setMergedFileName(defaultFileName);
      const ids = exportableForms.map((f) => f.formId);
      setSelectedFormIds(ids);
      setFormOrder(ids);
    }
    // Only depend on 'open' — defaultFileName is already stable via useMemo
  }, [open, exportableForms, defaultFileName]);

  const toggleForm = useCallback((formId: string) => {
    setSelectedFormIds((prev) =>
      prev.includes(formId) ? prev.filter((id) => id !== formId) : [...prev, formId],
    );
  }, []);

  const moveForm = useCallback((formId: string, direction: 'up' | 'down') => {
    setFormOrder((prev) => {
      const idx = prev.indexOf(formId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const orderedSelectedForms = useMemo(
    () => formOrder.filter((id) => selectedFormIds.includes(id)),
    [formOrder, selectedFormIds],
  );

  const triggerDownload = (url: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportIndividual = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      toast({
        title: 'Preparing export…',
        description: `Bundling ${exportableForms.length} forms. This may take a moment.`,
      });

      const request: ExportAllRequiredFormsRequest = {
        projectId,
        opportunityId,
        options: { pageSize },
      };

      const result = await exportAll(request);
      if (!result?.success || !result?.export?.url)
        throw new Error('Export failed');

      triggerDownload(result.export.url, result.export.fileName);
      toast({
        title: 'Export complete',
        description: `${result.summary.exportedForms} forms exported.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Failed to export',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    projectId,
    opportunityId,
    pageSize,
    exportableForms.length,
    exportAll,
    toast,
    onOpenChange,
  ]);

  const handleExportMerged = useCallback(async () => {
    if (isLoading || orderedSelectedForms.length === 0) return;
    setIsLoading(true);
    try {
      toast({
        title: 'Merging forms…',
        description: `Combining ${orderedSelectedForms.length} forms into one package.`,
      });

      const result = await exportMerged({
        projectId,
        opportunityId,
        documentIds: orderedSelectedForms,
        format: 'pdf',
        fileName: mergedFileName.trim() || undefined,
        options: { pageSize, pageBreakBetween },
      });

      if (!result?.success || !result?.url) throw new Error('Merge failed');

      triggerDownload(result.url, result.fileName);
      toast({
        title: 'Merged package ready',
        description: `${result.documentCount} forms merged.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Merge failed',
        description: err instanceof Error ? err.message : 'Failed to merge',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    orderedSelectedForms,
    projectId,
    opportunityId,
    pageSize,
    pageBreakBetween,
    mergedFileName,
    exportMerged,
    toast,
    onOpenChange,
  ]);

  const formMap = useMemo(() => {
    const m = new Map<string, RequiredFormItem>();
    for (const f of exportableForms) m.set(f.formId, f);
    return m;
  }, [exportableForms]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!isLoading) onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'configure' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setStep('mode')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            Export Required Forms
          </DialogTitle>
          <DialogDescription>
            {step === 'mode'
              ? `${exportableForms.length} exportable forms. Choose export mode.`
              : mode === 'individual'
                ? 'Export each form as a separate file in a ZIP.'
                : 'Merge selected forms into a single package.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Step 1: Mode selection */}
          {step === 'mode' && (
            <div className="grid gap-3">
              <button
                type="button"
                className="flex items-start gap-4 rounded-xl border p-4 text-left hover:bg-accent/50 transition-colors"
                onClick={() => {
                  setMode('individual');
                  setStep('configure');
                }}
              >
                <div className="rounded-lg bg-muted p-2.5">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Individual Files (ZIP)</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Export each form separately as PDF. Downloads as a ZIP archive.
                  </p>
                </div>
              </button>

              <button
                type="button"
                className="flex items-start gap-4 rounded-xl border p-4 text-left hover:bg-accent/50 transition-colors"
                onClick={() => {
                  setMode('merged');
                  setStep('configure');
                }}
              >
                <div className="rounded-lg bg-muted p-2.5">
                  <Merge className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Merged Package</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Combine selected forms into one package for submission.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step 2a: Individual — page size selection */}
          {step === 'configure' && mode === 'individual' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Page Size</Label>
                <Select
                  value={pageSize}
                  onValueChange={(v) => setPageSize(v as 'letter' | 'a4')}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letter">US Letter</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                {exportableForms.length} form{exportableForms.length !== 1 ? 's' : ''} × PDF
                format = {exportableForms.length} file{exportableForms.length !== 1 ? 's' : ''}{' '}
                in ZIP
              </div>
            </div>
          )}

          {/* Step 2b: Merged — form selection & ordering */}
          {step === 'configure' && mode === 'merged' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="merged-filename">Package Name</Label>
                <Input
                  id="merged-filename"
                  value={mergedFileName}
                  onChange={(e) => setMergedFileName(e.target.value)}
                  placeholder="e.g., Required Forms Package"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Select & Order Forms</Label>
                  <span className="text-xs text-muted-foreground">
                    {selectedFormIds.length} of {exportableForms.length} selected
                  </span>
                </div>
                <div className="space-y-1 max-h-[280px] overflow-y-auto rounded-lg border p-1">
                  {formOrder.map((formId, idx) => {
                    const form = formMap.get(formId);
                    if (!form) return null;
                    const isSelected = selectedFormIds.includes(formId);
                    const typeLabel = FORM_TYPE_LABEL[form.formType] ?? form.formType;

                    return (
                      <div
                        key={formId}
                        className="flex items-center gap-2 rounded-lg p-2 hover:bg-accent/50 transition-colors"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleForm(formId)}
                          disabled={isLoading}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{form.name}</p>
                          <Badge variant="outline" className="text-xs mt-0.5">
                            {typeLabel}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={idx === 0 || isLoading}
                            onClick={() => moveForm(formId, 'up')}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={idx === formOrder.length - 1 || isLoading}
                            onClick={() => moveForm(formId, 'down')}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Page Size</Label>
                  <Select
                    value={pageSize}
                    onValueChange={(v) => setPageSize(v as 'letter' | 'a4')}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="letter">US Letter</SelectItem>
                      <SelectItem value="a4">A4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="page-break-toggle" className="text-sm font-normal">
                      Page breaks
                    </Label>
                    <Switch
                      id="page-break-toggle"
                      checked={pageBreakBetween}
                      onCheckedChange={setPageBreakBetween}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with action buttons */}
        {step === 'configure' && (
          <div className="flex gap-3 justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            {mode === 'individual' ? (
              <Button onClick={handleExportIndividual} disabled={isLoading} className="gap-2">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isLoading ? 'Exporting…' : 'Export ZIP'}
              </Button>
            ) : (
              <Button
                onClick={handleExportMerged}
                disabled={isLoading || orderedSelectedForms.length === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Merge className="h-4 w-4" />
                )}
                {isLoading ? 'Merging…' : `Merge ${orderedSelectedForms.length} Forms`}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
