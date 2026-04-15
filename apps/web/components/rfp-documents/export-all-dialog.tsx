'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  Download,
  FileText,
  FileDown,
  Code,
  FileType,
  Loader2,
  Merge,
  Package,
  Presentation,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/components/ui/use-toast';
import {
  useExportAllRFPDocuments,
  useExportMergedRFPDocuments,
  type ExportAllRFPDocumentsRequest,
  type RFPDocumentItem,
  RFP_DOCUMENT_TYPES,
} from '@/lib/hooks/use-rfp-documents';

type BulkExportFormat = 'docx' | 'pdf' | 'pptx' | 'html' | 'txt' | 'md';
type ExportMode = 'individual' | 'merged';
type WizardStep = 'mode' | 'configure';

interface FormatOption {
  value: BulkExportFormat;
  label: string;
  icon: typeof FileDown;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'docx', label: 'Word (.docx)', icon: FileText },
  { value: 'pdf', label: 'PDF (.pdf)', icon: FileDown },
  { value: 'pptx', label: 'PowerPoint (.pptx)', icon: Presentation },
  { value: 'html', label: 'HTML (.html)', icon: Code },
  { value: 'txt', label: 'Plain Text (.txt)', icon: FileType },
  { value: 'md', label: 'Markdown (.md)', icon: FileType },
];

interface ExportAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId?: string;
  opportunityTitle?: string;
  documents: RFPDocumentItem[];
}

export const ExportAllDialog = ({
  open,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  opportunityTitle,
  documents,
}: ExportAllDialogProps) => {
  const { toast } = useToast();
  const { trigger: exportAll } = useExportAllRFPDocuments(orgId);
  const { trigger: exportMerged } = useExportMergedRFPDocuments(orgId);

  const [step, setStep] = useState<WizardStep>('mode');
  const [mode, setMode] = useState<ExportMode>('individual');
  const [isLoading, setIsLoading] = useState(false);

  // Individual mode state
  const [selectedFormats, setSelectedFormats] = useState<Set<BulkExportFormat>>(new Set(['docx']));
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');

  // Merged mode state
  const exportableDocs = useMemo(
    () => documents.filter((d) => d.status !== 'GENERATING' && (d.htmlContentKey || d.content)),
    [documents],
  );
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(() => exportableDocs.map((d) => d.documentId));
  const [docOrder, setDocOrder] = useState<string[]>(() => exportableDocs.map((d) => d.documentId));
  const [mergeFormat, setMergeFormat] = useState<'docx' | 'pdf'>('docx');
  const [pageBreakBetween, setPageBreakBetween] = useState(true);
  const defaultFileName = opportunityTitle ? `${opportunityTitle} Proposal` : 'Merged Proposal';
  const [mergedFileName, setMergedFileName] = useState(defaultFileName);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep('mode');
      setIsLoading(false);
      setMergedFileName(defaultFileName);
      const ids = exportableDocs.map((d) => d.documentId);
      setSelectedDocIds(ids);
      setDocOrder(ids);
    }
  }, [open, exportableDocs]);

  const toggleDoc = useCallback((docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  }, []);

  const moveDoc = useCallback((docId: string, direction: 'up' | 'down') => {
    setDocOrder((prev) => {
      const idx = prev.indexOf(docId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const toggleFormat = useCallback((format: BulkExportFormat) => {
    setSelectedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(format)) {
        if (next.size <= 1) return prev;
        next.delete(format);
      } else {
        next.add(format);
      }
      return next;
    });
  }, []);

  const orderedSelectedDocs = useMemo(
    () => docOrder.filter((id) => selectedDocIds.includes(id)),
    [docOrder, selectedDocIds],
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
      toast({ title: 'Preparing export…', description: `Bundling ${exportableDocs.length} documents. This may take a moment.` });

      const request: ExportAllRFPDocumentsRequest = {
        projectId,
        opportunityId: opportunityId || undefined,
        formats: Array.from(selectedFormats),
        options: { pageSize },
      };

      const result = await exportAll(request);
      if (!result?.success || !result?.export?.url) throw new Error('Export failed');

      triggerDownload(result.export.url, result.export.fileName);
      toast({ title: 'Export complete', description: `${result.summary.exportedDocuments} documents exported.` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Failed to export', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projectId, opportunityId, selectedFormats, pageSize, exportableDocs.length, exportAll, toast, onOpenChange]);

  const handleExportMerged = useCallback(async () => {
    if (isLoading || orderedSelectedDocs.length === 0) return;
    setIsLoading(true);
    try {
      toast({ title: 'Merging documents…', description: `Combining ${orderedSelectedDocs.length} documents into one ${mergeFormat.toUpperCase()}.` });

      const result = await exportMerged({
        projectId,
        opportunityId: opportunityId || '',
        documentIds: orderedSelectedDocs,
        format: mergeFormat,
        fileName: mergedFileName.trim() || undefined,
        options: { pageSize, pageBreakBetween },
      });

      if (!result?.success || !result?.url) throw new Error('Merge failed');

      triggerDownload(result.url, result.fileName);
      toast({ title: 'Merged document ready', description: `${result.documentCount} documents merged into one ${mergeFormat.toUpperCase()}.` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Merge failed', description: err instanceof Error ? err.message : 'Failed to merge', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, orderedSelectedDocs, mergeFormat, projectId, opportunityId, pageSize, pageBreakBetween, exportMerged, toast, onOpenChange]);

  const docMap = useMemo(() => {
    const m = new Map<string, RFPDocumentItem>();
    for (const d of exportableDocs) m.set(d.documentId, d);
    return m;
  }, [exportableDocs]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'configure' && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setStep('mode')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            Export Documents
          </DialogTitle>
          <DialogDescription>
            {step === 'mode'
              ? `${exportableDocs.length} exportable documents. Choose export mode.`
              : mode === 'individual'
                ? 'Export each document as a separate file in a ZIP.'
                : 'Merge selected documents into a single file.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Step 1: Mode selection */}
          {step === 'mode' && (
            <div className="grid gap-3">
              <button
                type="button"
                className="flex items-start gap-4 rounded-xl border p-4 text-left hover:bg-accent/50 transition-colors"
                onClick={() => { setMode('individual'); setStep('configure'); }}
              >
                <div className="rounded-lg bg-muted p-2.5">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Individual Files (ZIP)</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Export each document separately. Choose formats (DOCX, PDF, etc). Downloads as a ZIP.
                  </p>
                </div>
              </button>

              <button
                type="button"
                className="flex items-start gap-4 rounded-xl border p-4 text-left hover:bg-accent/50 transition-colors"
                onClick={() => { setMode('merged'); setStep('configure'); }}
              >
                <div className="rounded-lg bg-muted p-2.5">
                  <Merge className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Merged Document</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Combine selected documents into one DOCX or PDF with page breaks between sections.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step 2a: Individual — format selection */}
          {step === 'configure' && mode === 'individual' && (
            <div className="space-y-5">
              <div className="space-y-3">
                <Label>Export Formats</Label>
                <div className="grid gap-2">
                  {FORMAT_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedFormats.has(opt.value)}
                        onCheckedChange={() => toggleFormat(opt.value)}
                        disabled={isLoading}
                      />
                      <opt.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Page Size</Label>
                <Select value={pageSize} onValueChange={(v) => setPageSize(v as 'letter' | 'a4')} disabled={isLoading}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letter">US Letter</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                {exportableDocs.length} documents × {selectedFormats.size} format{selectedFormats.size !== 1 ? 's' : ''} = {exportableDocs.length * selectedFormats.size} files in ZIP
              </div>
            </div>
          )}

          {/* Step 2b: Merged — document selection & ordering */}
          {step === 'configure' && mode === 'merged' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="merged-filename">File Name</Label>
                <Input
                  id="merged-filename"
                  value={mergedFileName}
                  onChange={(e) => setMergedFileName(e.target.value)}
                  placeholder="e.g., Merged Proposal"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Select & Order Documents</Label>
                  <span className="text-xs text-muted-foreground">
                    {selectedDocIds.length} of {exportableDocs.length} selected
                  </span>
                </div>
                <div className="space-y-1 max-h-[280px] overflow-y-auto rounded-lg border p-1">
                  {docOrder.map((docId, idx) => {
                    const doc = docMap.get(docId);
                    if (!doc) return null;
                    const isSelected = selectedDocIds.includes(docId);
                    const typeLabel = RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType;

                    return (
                      <div
                        key={docId}
                        className="flex items-center gap-2 rounded-lg p-2 hover:bg-accent/50 transition-colors"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleDoc(docId)}
                          disabled={isLoading}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          <Badge variant="outline" className="text-xs mt-0.5">{typeLabel}</Badge>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={idx === 0 || isLoading}
                            onClick={() => moveDoc(docId, 'up')}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={idx === docOrder.length - 1 || isLoading}
                            onClick={() => moveDoc(docId, 'down')}
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
                  <Label>Output Format</Label>
                  <RadioGroup value={mergeFormat} onValueChange={(v) => setMergeFormat(v as 'docx' | 'pdf')}>
                    <label className="flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer hover:bg-accent/50">
                      <RadioGroupItem value="docx" />
                      <span className="text-sm">Word (.docx)</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer hover:bg-accent/50">
                      <RadioGroupItem value="pdf" />
                      <span className="text-sm">PDF (.pdf)</span>
                    </label>
                  </RadioGroup>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Page Size</Label>
                    <Select value={pageSize} onValueChange={(v) => setPageSize(v as 'letter' | 'a4')} disabled={isLoading}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="letter">US Letter</SelectItem>
                        <SelectItem value="a4">A4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="page-break-toggle" className="text-sm font-normal">Page breaks</Label>
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
              <Button onClick={handleExportIndividual} disabled={isLoading || selectedFormats.size === 0} className="gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isLoading ? 'Exporting…' : 'Export ZIP'}
              </Button>
            ) : (
              <Button onClick={handleExportMerged} disabled={isLoading || orderedSelectedDocs.length === 0} className="gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                {isLoading ? 'Merging…' : `Merge ${orderedSelectedDocs.length} Docs`}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
