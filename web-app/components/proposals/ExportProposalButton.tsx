'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FileDown, Loader2, FileText, FileType, Presentation, Code, Package } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  type ExportFormat,
  FORMAT_EXTENSIONS,
  FORMAT_LABELS,
  useExportProposal,
} from '@/lib/hooks/use-export-proposal';

interface ExportProposalButtonProps {
  proposalId: string;
  projectId: string;
  opportunityId: string;
  proposalTitle: string;
}

const FORMAT_ICONS: Record<ExportFormat, typeof FileDown> = {
  docx: FileText,
  pdf: FileDown,
  html: Code,
  txt: FileType,
  pptx: Presentation,
  md: FileType,
  batch: Package,
};

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  docx: 'Professional Word document using your organization\'s template.',
  pdf: 'Portable Document Format with professional formatting.',
  html: 'Web-ready HTML format for email or web-based submissions.',
  txt: 'Plain text format for email submissions or accessibility.',
  pptx: 'PowerPoint presentation for oral presentations and executive briefs.',
  md: 'Markdown format for version control and collaboration.',
  batch: 'Download all text-based formats (HTML, TXT, MD) in a single ZIP file.',
};

export function ExportProposalButton({
  proposalId,
  projectId,
  opportunityId,
  proposalTitle,
}: ExportProposalButtonProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [pageSize, setPageSize] = useState<'letter' | 'a4'>('letter');
  const { trigger: exportProposal } = useExportProposal();

  const handleExport = async () => {
    try {
      setIsLoading(true);

      const data = await exportProposal({
        projectId,
        proposalId,
        opportunityId,
        format: selectedFormat,
        options: selectedFormat === 'pdf' ? { pageSize } : undefined,
      });

      if (data.export?.url) {
        const link = document.createElement('a');
        link.href = data.export.url;
        const ext = FORMAT_EXTENSIONS[selectedFormat] || '';
        link.download = `${proposalTitle || 'proposal'}${ext}`;
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
          title: 'Export successful',
          description: `Proposal exported as ${FORMAT_LABELS[selectedFormat]}`,
        });

        setIsOpen(false);
      } else {
        throw new Error('No download URL received');
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description:
          error instanceof Error ? error.message : 'Failed to export proposal',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const FormatIcon = FORMAT_ICONS[selectedFormat];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileDown className="h-4 w-4" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Export Proposal</DialogTitle>
          <DialogDescription>
            Choose a format to export your proposal. Different agencies may require different submission formats.
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
                <SelectItem value="html">🌐 HTML (.html)</SelectItem>
                <SelectItem value="txt">📝 Plain Text (.txt)</SelectItem>
                <SelectItem value="pptx">📊 PowerPoint (.pptx)</SelectItem>
                <SelectItem value="md">📑 Markdown (.md)</SelectItem>
                <SelectItem value="batch">📦 All Formats (.zip)</SelectItem>
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
                <p className="text-sm font-medium">{FORMAT_LABELS[selectedFormat]}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {FORMAT_DESCRIPTIONS[selectedFormat]}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLoading}
          >
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