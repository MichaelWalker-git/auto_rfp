'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';
import { useConfirmDraft, useDiscardDraft } from '@/lib/hooks/use-extraction';
import { Check, X, Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { mutate } from 'swr';
import { DraftReviewCard, type AnyDraft } from '@/components/extraction';

interface PendingDraftsSectionProps {
  orgId: string;
  drafts: AnyDraft[];
  title: string;
  description: string;
  mutateKey: string;
  onRefresh: () => Promise<unknown> | void;
  /** Start expanded (default: true) */
  defaultOpen?: boolean;
}

export const PendingDraftsSection = ({
  orgId,
  drafts,
  title,
  description,
  mutateKey,
  onRefresh,
  defaultOpen = true,
}: PendingDraftsSectionProps) => {
  const [showDrafts, setShowDrafts] = useState(defaultOpen);
  const [bulkProcessing, setBulkProcessing] = useState<'accept' | 'discard' | null>(null);
  
  const { toast } = useToast();
  const { confirmDraft } = useConfirmDraft();
  const { discardDraft } = useDiscardDraft();

  // Get draft ID based on type
  const getDraftId = (draft: AnyDraft): string => {
    if ('projectId' in draft) return draft.projectId;
    return draft.draftId;
  };

  // Get draft type for API calls
  const getDraftType = (draft: AnyDraft): 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM' => {
    if ('projectId' in draft && 'title' in draft && 'client' in draft) return 'PAST_PERFORMANCE';
    if ('targetType' in draft && draft.targetType === 'LABOR_RATE') return 'LABOR_RATE';
    return 'BOM_ITEM';
  };

  const handleAcceptAll = async () => {
    if (drafts.length === 0) return;
    if (!confirm(`Are you sure you want to accept all ${drafts.length} drafts?`)) return;
    
    setBulkProcessing('accept');
    let successCount = 0;
    let failCount = 0;
    
    for (const draft of drafts) {
      try {
        await confirmDraft({ orgId, draftId: getDraftId(draft), draftType: getDraftType(draft) });
        successCount++;
      } catch {
        failCount++;
      }
    }
    
    setBulkProcessing(null);
    await onRefresh();
    mutate((key: string) => typeof key === 'string' && key.includes(mutateKey));
    
    if (failCount === 0) {
      toast({ title: 'All Accepted', description: `${successCount} items have been added.` });
    } else {
      toast({ title: 'Partially Accepted', description: `${successCount} accepted, ${failCount} failed.`, variant: 'destructive' });
    }
  };

  const handleDiscardAll = async () => {
    if (drafts.length === 0) return;
    if (!confirm(`Are you sure you want to discard all ${drafts.length} drafts?`)) return;
    
    setBulkProcessing('discard');
    let successCount = 0;
    let failCount = 0;
    
    for (const draft of drafts) {
      try {
        await discardDraft({ orgId, draftId: getDraftId(draft), draftType: getDraftType(draft) });
        successCount++;
      } catch {
        failCount++;
      }
    }
    
    setBulkProcessing(null);
    await onRefresh();
    
    if (failCount === 0) {
      toast({ title: 'All Discarded', description: `${successCount} drafts have been removed.` });
    } else {
      toast({ title: 'Partially Discarded', description: `${successCount} discarded, ${failCount} failed.`, variant: 'destructive' });
    }
  };

  const handleDraftSuccess = async () => {
    await onRefresh();
    mutate((key: string) => typeof key === 'string' && key.includes(mutateKey));
  };

  if (drafts.length === 0) return null;

  return (
    <Collapsible open={showDrafts} onOpenChange={setShowDrafts} defaultOpen={defaultOpen}>
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                {title} ({drafts.length})
              </CardTitle>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" disabled={bulkProcessing !== null} onClick={handleDiscardAll}>
                  {bulkProcessing === 'discard' ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Discarding...</>
                  ) : (
                    <><X className="h-3 w-3 mr-1" />Discard All</>
                  )}
                </Button>
                <Button variant="default" size="sm" disabled={bulkProcessing !== null} onClick={handleAcceptAll}>
                  {bulkProcessing === 'accept' ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Accepting...</>
                  ) : (
                    <><Check className="h-3 w-3 mr-1" />Accept All</>
                  )}
                </Button>
                {showDrafts ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground ml-2" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground ml-2" />
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div className="space-y-4">
              {drafts.map((draft) => (
                <DraftReviewCard
                  key={getDraftId(draft)}
                  draft={draft}
                  orgId={orgId}
                  onSuccess={handleDraftSuccess}
                  disabled={bulkProcessing !== null}
                />
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
