'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useGenerateDebriefingLetter } from '@/lib/hooks/use-debriefing';
import { useToast } from '@/components/ui/use-toast';
import { Copy, Download, Mail } from 'lucide-react';
import type { DebriefingItem } from '@auto-rfp/core';

interface DebriefingLetterPreviewProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  debriefing: DebriefingItem;
  orgId: string;
  projectId: string;
  opportunityId: string;
}

export const DebriefingLetterPreview = ({
  isOpen,
  onOpenChange,
  debriefing,
  orgId,
  projectId,
  opportunityId,
}: DebriefingLetterPreviewProps) => {
  const [letter, setLetter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { generateDebriefingLetter } = useGenerateDebriefingLetter();
  const { toast } = useToast();
  const hasFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !debriefing) {
      hasFetchedRef.current = null;
      return;
    }

    const fetchKey = `${orgId}#${projectId}#${opportunityId}#${debriefing.debriefId}`;
    if (hasFetchedRef.current === fetchKey) return;
    hasFetchedRef.current = fetchKey;

    let cancelled = false;
    const loadLetter = async () => {
      setIsLoading(true);
      try {
        const generatedLetter = await generateDebriefingLetter(orgId, projectId, opportunityId, debriefing.debriefId);
        if (!cancelled) setLetter(generatedLetter);
      } catch (error: unknown) {
        if (!cancelled) {
          toast({
            title: 'Error',
            description: error instanceof Error ? error.message : 'Failed to generate letter',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadLetter();
    return () => { cancelled = true; };
  }, [isOpen, debriefing, orgId, projectId, opportunityId, generateDebriefingLetter, toast]);

  const handleCopy = async () => {
    if (!letter) return;

    try {
      await navigator.clipboard.writeText(letter);
      toast({
        title: 'Copied',
        description: 'Letter copied to clipboard',
      });
    } catch {
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
    a.download = `Debriefing_Request_${debriefing.solicitationNumber ?? 'unknown'}_${new Date().toISOString().split('T')[0]}.txt`;
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
    if (!letter || !debriefing.contractingOfficerEmail) return;

    const subject = encodeURIComponent(
      `POST-AWARD DEBRIEFING REQUEST — Solicitation No. ${debriefing.solicitationNumber ?? ''}, ${debriefing.contractTitle ?? ''}`
    );
    const body = encodeURIComponent(letter);
    window.open(`mailto:${debriefing.contractingOfficerEmail}?subject=${subject}&body=${body}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Debriefing Request Letter</DialogTitle>
          <DialogDescription>
            Review the generated debriefing request letter{debriefing.contractingOfficerName ? ` for ${debriefing.contractingOfficerName}` : ''}.
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
            {debriefing.contractingOfficerEmail && (
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
};
