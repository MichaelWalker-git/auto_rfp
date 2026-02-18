'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGenerateFOIALetter } from '@/lib/hooks/use-foia-requests';
import { useToast } from '@/components/ui/use-toast';
import { Copy, Download, Mail } from 'lucide-react';
import type { FOIARequestItem } from '@auto-rfp/core';

interface FOIALetterPreviewProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  foiaRequest: FOIARequestItem;
  orgId: string;
  projectId: string;
}

export function FOIALetterPreview({
  isOpen,
  onOpenChange,
  foiaRequest,
  orgId,
  projectId,
}: FOIALetterPreviewProps) {
  const [letter, setLetter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { generateFOIALetter } = useGenerateFOIALetter();
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && foiaRequest) {
      loadLetter();
    }
  }, [isOpen, foiaRequest.id]);

  const loadLetter = async () => {
    setIsLoading(true);
    try {
      const generatedLetter = await generateFOIALetter(orgId, projectId, foiaRequest.id);
      setLetter(generatedLetter);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate letter',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!letter) return;

    try {
      await navigator.clipboard.writeText(letter);
      toast({
        title: 'Copied',
        description: 'Letter copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy letter',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = () => {
    if (!letter) return;

    const blob = new Blob([letter], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FOIA_Request_${foiaRequest.solicitationNumber}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Downloaded',
      description: 'Letter downloaded successfully',
    });
  };

  const handleEmailDraft = () => {
    if (!letter || !foiaRequest.agencyFOIAEmail) return;

    const subject = encodeURIComponent(
      `FOIA Request - Solicitation ${foiaRequest.solicitationNumber}`
    );
    const body = encodeURIComponent(letter);
    window.open(`mailto:${foiaRequest.agencyFOIAEmail}?subject=${subject}&body=${body}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>FOIA Request Letter</DialogTitle>
          <DialogDescription>
            Review the generated FOIA letter before sending to {foiaRequest.agencyName}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : letter ? (
            <div className="bg-muted/50 p-4 rounded-md max-h-[50vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm font-mono">{letter}</pre>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Failed to load letter. Please try again.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              disabled={!letter || isLoading}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              disabled={!letter || isLoading}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {foiaRequest.agencyFOIAEmail && (
              <Button
                type="button"
                onClick={handleEmailDraft}
                disabled={!letter || isLoading}
              >
                <Mail className="h-4 w-4 mr-2" />
                Draft Email
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
