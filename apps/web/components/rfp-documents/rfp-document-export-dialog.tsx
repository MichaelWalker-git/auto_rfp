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
 * Trigger a file download from a URL or open in new tab for PDFs.
 *
 * For PDFs we pre-open a blank tab *before* the async export call so the
 * browser treats it as a user-initiated popup (avoids popup-blocker).
 * After the export resolves we navigate that tab to the presigned URL.
 * If the tab was blocked anyway, we fall back to an `<a>` download link.
 */
const downloadFromUrl = (
  url: string,
  fileName: string,
  format: ExportFormat,
  preOpenedTab: Window | null = null,
) => {
  if (format === 'pdf') {
    // If we already pre-opened a tab, navigate it to the PDF URL
    if (preOpenedTab && !preOpenedTab.closed) {
      preOpenedTab.location.href = url;
    } else {
      // Fallback: try window.open (may be blocked) then anchor download
      const tab = window.open(url, '_blank');
      if (!tab || tab.closed) {
        // Popup was blocked — fall back to anchor download
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  } else {
    // For other formats, trigger download via anchor
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
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

    // For PDFs, pre-open a blank tab *synchronously* inside the click handler
    // so the browser treats it as a user-initiated popup and doesn't block it.
    // We'll navigate this tab to the presigned URL once the export completes.
    let pdfTab: Window | null = null;
    if (selectedFormat === 'pdf') {
      pdfTab = window.open('about:blank', '_blank');
      // Show a loading message in the pre-opened tab
      if (pdfTab) {
        pdfTab.document.title = 'Generating PDF…';
        pdfTab.document.body.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#555;">
            <div style="text-align:center;">
              <p style="font-size:1.25rem;margin-bottom:0.5rem;">Generating PDF…</p>
              <p style="font-size:0.875rem;color:#999;">This may take a few seconds.</p>
            </div>
          </div>
        `;
      }
    }

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
        // Close the pre-opened tab if the export failed
        if (pdfTab && !pdfTab.closed) pdfTab.close();
        throw new Error('Export failed — no download URL returned.');
      }

      // Download the exported file from the presigned S3 URL
      const fileName = result.export.fileName || `${doc.title || doc.name || 'document'}.${selectedFormat}`;
      downloadFromUrl(result.export.url, fileName, selectedFormat, pdfTab);

      toast({
        title: 'Export successful',
        description: `Document exported as ${EXPORT_FORMAT_LABELS[selectedFormat]}.`,
      });

      onOpenChange(false);
    } catch (error) {
      // Close the pre-opened tab on error
      if (pdfTab && !pdfTab.closed) pdfTab.close();

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
