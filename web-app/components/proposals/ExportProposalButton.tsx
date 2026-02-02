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
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useExportProposal } from '@/lib/hooks/use-export-proposal';

interface ExportProposalButtonProps {
  proposalId: string;
  projectId: string;
  opportunityId: string;
  proposalTitle: string;
}

export function ExportProposalButton({
                                       proposalId,
                                       projectId,
                                       opportunityId,
                                       proposalTitle,
                                     }: ExportProposalButtonProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { trigger: exportProposal } = useExportProposal();

  const handleExport = async () => {
    try {
      setIsLoading(true);

      const data = await exportProposal({
        projectId,
        proposalId,
        opportunityId,
      });

      if (data.export?.url) {
        // Download using presigned URL
        const link = document.createElement('a');
        link.href = data.export.url;
        link.download = `${proposalTitle || 'proposal'}.docx`;
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
          title: 'Success',
          description: 'Proposal exported to Word document successfully',
        });

        setIsOpen(false);
      } else {
        throw new Error('No download URL received');
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to export proposal',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileDown className="h-4 w-4"/>
          Export to Word
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Proposal to Word</DialogTitle>
          <DialogDescription>
            Export your proposal as a professional Word document using your organization's template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Your proposal will be formatted and exported to a Word document (.docx) based on your organization's
            template.
          </p>
        </div>
        <div className="flex gap-3">
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
                <Loader2 className="h-4 w-4 animate-spin"/>
                Exporting...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4"/>
                Export
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}