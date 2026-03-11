'use client';

import React, { useState } from 'react';
import { FileDown, Loader2, FileText, FileType, Code, Presentation } from 'lucide-react';
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
import { useToast } from '@/components/ui/use-toast';
import {
  type ExportFormat,
  EXPORT_FORMAT_LABELS,
  type RFPDocumentItem,
  useExportRFPDocument,
} from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
  /**
   * Pre-resolved HTML content from the editor.
   * No longer used for client-side conversion — kept for API compatibility.
   * @deprecated All exports now happen server-side.
   */
  htmlContent?: string;
}

const FORMAT_ICONS: Record<ExportFormat, typeof FileDown> = {
  docx: FileText,
  pdf: FileDown,
  html: Code,
  txt: FileType,
  pptx: Presentation,
  md: FileType,
};

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  docx: 'Professional Word document with full formatting, tables, and images.',
  pdf: 'High-fidelity PDF with full formatting, identical to the editor view.',
  html: 'Styled HTML file ready for email or web-based submissions.',
  txt: 'Plain text format for email submissions or accessibility.',
  pptx: 'Branded PowerPoint presentation with section slides and agenda.',
  md: 'Markdown format for version control and collaboration.',
};

/**
 * Trigger a file download from a URL.
 */
const downloadFromUrl = (url: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const RFPDocumentExportDialog = ({ open, onOpenChange, document: doc, orgId }: Props) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');

  // Backend export mutation
  const { trigger: triggerExport } = useExportRFPDocument(orgId);

  const handleExport = async () => {
    if (!doc) return;

    try {
      setIsLoading(true);

      // Call the backend export API
      const result = await triggerExport({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
        format: selectedFormat,
        options: {
          pageSize,
        },
      });

      if (!result?.success || !result?.export?.url) {
        throw new Error('Export failed — no download URL returned.');
      }

      // Download the exported file from the presigned S3 URL
      const fileName = result.export.fileName || `${doc.title || doc.name || 'document'}.${selectedFormat}`;
      downloadFromUrl(result.export.url, fileName);

      toast({
        title: 'Export successful',
        description: `Document exported as ${EXPORT_FORMAT_LABELS[selectedFormat]}.`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Failed to export document',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!doc) return null;

  const FormatIcon = FORMAT_ICONS[selectedFormat];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Export Document</DialogTitle>
          <DialogDescription>
            Choose a format to export &quot;{doc.title || doc.name}&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="format-select">Export Format</Label>
            <Select
              value={selectedFormat}
              onValueChange={(value) => setSelectedFormat(value as ExportFormat)}
            >
              <SelectTrigger id="format-select">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="docx">📄 Word Document (.docx)</SelectItem>
                <SelectItem value="pdf">📋 PDF Document (.pdf)</SelectItem>
                <SelectItem value="pptx">📊 PowerPoint (.pptx)</SelectItem>
                <SelectItem value="html">🌐 HTML (.html)</SelectItem>
                <SelectItem value="txt">📝 Plain Text (.txt)</SelectItem>
                <SelectItem value="md">📑 Markdown (.md)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(selectedFormat === 'pdf' || selectedFormat === 'docx') && (
            <div className="space-y-2">
              <Label htmlFor="page-size-select">Page Size</Label>
              <Select
                value={pageSize}
                onValueChange={(value) => setPageSize(value as 'letter' | 'a4')}
              >
                <SelectTrigger id="page-size-select">
                  <SelectValue placeholder="Select page size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letter">US Letter (8.5&quot; × 11&quot;)</SelectItem>
                  <SelectItem value="a4">A4 (210mm × 297mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-md border p-3 bg-muted/30">
            <div className="flex items-start gap-3">
              <FormatIcon className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{EXPORT_FORMAT_LABELS[selectedFormat]}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {FORMAT_DESCRIPTIONS[selectedFormat]}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isLoading} className="gap-2">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Export
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
