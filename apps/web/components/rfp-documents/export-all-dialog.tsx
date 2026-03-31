'use client';

import React, { useCallback, useState } from 'react';
import { Download, Loader2, FileText, FileDown, Code, FileType, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/components/ui/use-toast';
import {
  useExportAllRFPDocuments,
  type ExportAllRFPDocumentsRequest,
} from '@/lib/hooks/use-rfp-documents';

type BulkExportFormat = 'docx' | 'pdf' | 'pptx' | 'html' | 'txt' | 'md';

interface FormatOption {
  value: BulkExportFormat;
  label: string;
  description: string;
  icon: typeof FileDown;
  emoji: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'docx',
    label: 'Word Document (.docx)',
    description: 'Professional Word document with full formatting.',
    icon: FileText,
    emoji: '📄',
  },
  {
    value: 'pdf',
    label: 'PDF Document (.pdf)',
    description: 'High-fidelity PDF identical to the editor view.',
    icon: FileDown,
    emoji: '📋',
  },
  {
    value: 'pptx',
    label: 'PowerPoint (.pptx)',
    description: 'Branded presentation with section slides.',
    icon: Presentation,
    emoji: '📊',
  },
  {
    value: 'html',
    label: 'HTML (.html)',
    description: 'Styled HTML for email or web submissions.',
    icon: Code,
    emoji: '🌐',
  },
  {
    value: 'txt',
    label: 'Plain Text (.txt)',
    description: 'Plain text for email or accessibility.',
    icon: FileType,
    emoji: '📝',
  },
  {
    value: 'md',
    label: 'Markdown (.md)',
    description: 'Markdown for version control and collaboration.',
    icon: FileType,
    emoji: '📑',
  },
];

interface ExportAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId?: string;
  documentCount: number;
}

export const ExportAllDialog = ({
  open,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  documentCount,
}: ExportAllDialogProps) => {
  const { toast } = useToast();
  const { trigger: exportAll } = useExportAllRFPDocuments(orgId);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<Set<BulkExportFormat>>(
    new Set(['docx', 'pdf']),
  );
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');

  const toggleFormat = useCallback((format: BulkExportFormat) => {
    setSelectedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(format)) {
        // Don't allow deselecting all formats
        if (next.size <= 1) return prev;
        next.delete(format);
      } else {
        next.add(format);
      }
      return next;
    });
  }, []);

  const needsPageSize = selectedFormats.has('docx') || selectedFormats.has('pdf') || selectedFormats.has('html');

  const handleExport = useCallback(async () => {
    if (selectedFormats.size === 0 || isLoading) return;

    try {
      setIsLoading(true);
      toast({
        title: 'Preparing export…',
        description: `Bundling ${documentCount} document${documentCount === 1 ? '' : 's'} in ${selectedFormats.size} format${selectedFormats.size === 1 ? '' : 's'}. This may take a moment.`,
      });

      const request: ExportAllRFPDocumentsRequest = {
        projectId,
        opportunityId: opportunityId || undefined,
        formats: Array.from(selectedFormats),
        options: { pageSize },
      };

      const result = await exportAll(request);

      if (!result?.success || !result?.export?.url) {
        throw new Error('Export failed — no download URL returned.');
      }

      // Trigger download
      const link = document.createElement('a');
      link.href = result.export.url;
      link.download = result.export.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const { summary } = result;
      const skippedMsg =
        summary.skippedDocuments > 0
          ? ` (${summary.skippedDocuments} skipped)`
          : '';
      const formatNames = summary.formats.map((f: string) => f.toUpperCase()).join(', ');

      toast({
        title: 'Export complete',
        description: `${summary.exportedDocuments} document${summary.exportedDocuments === 1 ? '' : 's'} exported as ${formatNames}${skippedMsg}.`,
      });

      onOpenChange(false);
    } catch (err) {
      console.error('Export all error:', err);
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Failed to export documents',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, opportunityId, selectedFormats, pageSize, documentCount, isLoading, exportAll, toast, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Export All Documents</DialogTitle>
          <DialogDescription>
            Export {documentCount} document{documentCount === 1 ? '' : 's'} as a ZIP bundle.
            Select the file formats to include.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Format selection */}
          <div className="space-y-3">
            <Label>Export Formats</Label>
            <div className="grid gap-2">
              {FORMAT_OPTIONS.map((opt) => {
                const isChecked = selectedFormats.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      isLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'
                    }`}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleFormat(opt.value)}
                      disabled={isLoading}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{opt.emoji}</span>
                        <span className="text-sm font-medium">{opt.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Page size — only shown when relevant formats are selected */}
          {needsPageSize && (
            <div className="space-y-2">
              <Label htmlFor="page-size-select">Page Size</Label>
              <Select
                value={pageSize}
                onValueChange={(value) => setPageSize(value as 'letter' | 'a4')}
                disabled={isLoading}
              >
                <SelectTrigger id="page-size-select" disabled={isLoading}>
                  <SelectValue placeholder="Select page size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letter">US Letter (8.5&quot; × 11&quot;)</SelectItem>
                  <SelectItem value="a4">A4 (210mm × 297mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Summary */}
          <div className="rounded-md border p-3 bg-muted/30">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {documentCount} document{documentCount === 1 ? '' : 's'} × {selectedFormats.size} format{selectedFormats.size === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The ZIP will contain {documentCount * selectedFormats.size} file{documentCount * selectedFormats.size === 1 ? '' : 's'} total
                  ({Array.from(selectedFormats).map((f) => `.${f}`).join(', ')}).
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isLoading || selectedFormats.size === 0}
            className="gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export All
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
