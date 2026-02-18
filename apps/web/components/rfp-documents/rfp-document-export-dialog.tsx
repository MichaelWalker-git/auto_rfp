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
  EXPORT_FORMAT_EXTENSIONS,
  type RFPDocumentItem,
  useExportRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
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
  docx: 'Professional Word document using your organization\'s template.',
  pdf: 'Portable Document Format with professional formatting.',
  html: 'Web-ready HTML format for email or web-based submissions.',
  txt: 'Plain text format for email submissions or accessibility.',
  pptx: 'PowerPoint presentation for oral presentations and executive briefs.',
  md: 'Markdown format for version control and collaboration.',
};

/** Formats handled by the /export/ domain (legacy export lambdas) */
const LEGACY_EXPORT_FORMATS = new Set<ExportFormat>(['docx', 'pdf', 'pptx']);

/** Endpoint mapping for legacy export formats */
const LEGACY_EXPORT_ENDPOINTS: Record<string, string> = {
  docx: 'generate-word',
  pdf: 'generate-pdf',
  pptx: 'generate-pptx',
};

export function RFPDocumentExportDialog({ open, onOpenChange, document: doc, orgId }: Props) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');
  const { trigger: exportDocument } = useExportRFPDocument(orgId);

  const handleExport = async () => {
    if (!doc) return;

    try {
      setIsLoading(true);

      let exportUrl: string | null = null;

      if (LEGACY_EXPORT_FORMATS.has(selectedFormat)) {
        // Use the /export/ domain endpoints for docx, pdf, pptx
        const endpoint = LEGACY_EXPORT_ENDPOINTS[selectedFormat];
        const url = `${env.BASE_API_URL}/export/${endpoint}${orgId ? `?orgId=${orgId}` : ''}`;

        const res = await authFetcher(url, {
          method: 'POST',
          body: JSON.stringify({
            projectId: doc.projectId,
            opportunityId: doc.opportunityId,
            proposalId: doc.documentId, // legacy endpoints use proposalId
            documentId: doc.documentId,
            options: selectedFormat === 'pdf' ? { pageSize } : undefined,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Export failed with status ${res.status}`);
        }

        const data = await res.json();
        exportUrl = data.export?.url;
      } else {
        // Use the /rfp-document/export endpoint for html, txt, md
        const data = await exportDocument({
          projectId: doc.projectId,
          opportunityId: doc.opportunityId,
          documentId: doc.documentId,
          format: selectedFormat,
        });
        exportUrl = data.export?.url;
      }

      if (exportUrl) {
        const link = document.createElement('a');
        link.href = exportUrl;
        const ext = EXPORT_FORMAT_EXTENSIONS[selectedFormat] || '';
        link.download = `${doc.title || doc.name || 'document'}${ext}`;
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
          title: 'Export successful',
          description: `Document exported as ${EXPORT_FORMAT_LABELS[selectedFormat]}`,
        });

        onOpenChange(false);
      } else {
        throw new Error('No download URL received');
      }
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

          {selectedFormat === 'pdf' && (
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
}