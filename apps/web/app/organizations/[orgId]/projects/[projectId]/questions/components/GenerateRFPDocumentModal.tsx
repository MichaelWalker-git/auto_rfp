'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

import {
  useGenerateRFPDocument,
  useRFPDocumentPolling,
  useUpdateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import type { RFPDocumentContent } from '@auto-rfp/core';
import PermissionWrapper from '@/components/permission-wrapper';
import { useCurrentOrganization } from '@/context/organization-context';
import { RichTextEditor } from '@/components/rfp-documents/rich-text-editor';

type Props = {
  projectId: string;
  opportunityId?: string;
  onSave?: () => void;
};

export const GenerateRFPDocumentModal: React.FC<Props> = ({
  projectId,
  opportunityId,
  onSave,
}) => {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<RFPDocumentContent | undefined>();
  const [htmlContent, setHtmlContent] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Track the in-flight generation job so we can poll it
  const [generatingDocumentId, setGeneratingDocumentId] = useState<string | null>(null);
  const [generatingOpportunityId, setGeneratingOpportunityId] = useState<string | null>(null);

  // The document ID created by the generate-document Lambda.
  // We UPDATE this document on save — never create a new one.
  const [generatedDocumentId, setGeneratedDocumentId] = useState<string | null>(null);
  const [generatedOpportunityId, setGeneratedOpportunityId] = useState<string | null>(null);

  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;

  const { trigger: triggerGenerate, isMutating: isEnqueuing, error: enqueueError } = useGenerateRFPDocument(orgId);
  const { trigger: triggerUpdate, isMutating: isUpdating } = useUpdateRFPDocument(orgId);

  // Poll the document until generation completes
  const {
    document: polledDocument,
    isGenerating,
    isError: isPollingError,
    error: pollingError,
  } = useRFPDocumentPolling(
    generatingDocumentId ? projectId : null,
    generatingDocumentId ? (generatingOpportunityId ?? 'default') : null,
    generatingDocumentId,
    generatingDocumentId ? (orgId ?? null) : null,
  );

  const isMutating = isEnqueuing || isGenerating;
  const isSaving = isUpdating;

  // Once polling resolves a completed document, extract its content
  useEffect(() => {
    if (!polledDocument || isGenerating) return;
    if (polledDocument.status === 'GENERATING') return;

    const content = polledDocument.content as RFPDocumentContent | null | undefined;
    if (content) {
      setProposal(content);
      setHtmlContent(content.content ?? '');
    }

    // Store the generated document ID so we can update it on save
    setGeneratedDocumentId(polledDocument.documentId);
    setGeneratedOpportunityId(polledDocument.opportunityId);

    // Stop polling
    setGeneratingDocumentId(null);
    setGeneratingOpportunityId(null);
  }, [polledDocument, isGenerating]);

  // Surface errors from enqueue or polling
  useEffect(() => {
    const err = enqueueError ?? (isPollingError ? pollingError : null);
    if (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to generate proposal');
    } else {
      setLocalError(null);
    }
  }, [enqueueError, isPollingError, pollingError]);

  const startGeneration = useCallback(async () => {
    setProposal(undefined);
    setHtmlContent('');
    setLocalError(null);
    setGeneratingDocumentId(null);
    setGeneratingOpportunityId(null);
    setGeneratedDocumentId(null);
    setGeneratedOpportunityId(null);

    try {
      const result = await triggerGenerate({ projectId, opportunityId });
      if (result?.documentId) {
        setGeneratingDocumentId(result.documentId);
        setGeneratingOpportunityId(result.opportunityId ?? opportunityId ?? 'default');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to start generation');
    }
  }, [triggerGenerate, projectId, opportunityId]);

  const handleOpen = () => {
    setOpen(true);
    if (!proposal && !isMutating) {
      void startGeneration();
    }
  };

  const handleRegenerate = () => {
    void startGeneration();
  };

  const handleHtmlChange = useCallback((html: string) => {
    setHtmlContent(html);
  }, []);

  const handleSave = async () => {
    if (!proposal || !generatedDocumentId) return;
    setSaveMessage(null);
    setLocalError(null);

    try {
      const effectiveOpportunityId = generatedOpportunityId ?? opportunityId ?? 'default';

      // Update the document that was already created by the generate-document Lambda.
      // Never create a new document — that would result in duplicates.
      await triggerUpdate({
        projectId,
        opportunityId: effectiveOpportunityId,
        documentId: generatedDocumentId,
        name: proposal.title || 'Generated Proposal',
        documentType: 'TECHNICAL_PROPOSAL',
        content: {
          title: proposal.title,
          customerName: proposal.customerName,
          outlineSummary: proposal.outlineSummary,
          opportunityId: proposal.opportunityId,
          // Pass HTML — backend will upload to S3
          content: htmlContent || proposal.content,
        },
        title: proposal.title || 'Generated Proposal',
      });

      setSaveMessage('Saved ✅');
      onSave?.();
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save proposal');
    }
  };

  const hasHtml = !!(proposal?.content || htmlContent);
  const canSave = !!proposal && !!generatedDocumentId;

  return (
    <>
      <PermissionWrapper requiredPermission="proposal:create">
        <Button onClick={handleOpen} disabled={isMutating} variant="outline" className="gap-1">
          {isMutating && !proposal ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Brain className="h-4 w-4" />
              Generate Proposal
            </>
          )}
        </Button>
      </PermissionWrapper>

      <Dialog open={open} onOpenChange={setOpen} modal>
        <DialogContent className="!w-[80vw] !max-w-none h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Generate Proposal</DialogTitle>
            <DialogDescription>
              Review and edit the AI-generated proposal, then save it as an RFP document.
            </DialogDescription>
          </DialogHeader>

          <Separator className="shrink-0" />

          {/* Status messages */}
          {localError && (
            <div className="shrink-0 text-sm text-red-500 border border-red-500/30 rounded-md px-3 py-2 bg-red-500/5">
              {localError}
            </div>
          )}
          {saveMessage && (
            <div className="shrink-0 text-sm text-green-600 border border-green-600/30 rounded-md px-3 py-2 bg-green-500/5">
              {saveMessage}
            </div>
          )}

          {/* Loading state */}
          {isMutating && !proposal && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Generating proposal from AI…</span>
            </div>
          )}

          {/* Empty state */}
          {!proposal && !isMutating && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-muted-foreground">No proposal generated yet.</p>
              <Button size="sm" onClick={handleRegenerate}>Generate</Button>
            </div>
          )}

          {/* Proposal editor */}
          {proposal && (
            <Tabs defaultValue={hasHtml ? 'content' : 'metadata'} className="flex flex-col flex-1 min-h-0">
              <TabsList className="shrink-0 self-start mb-2">
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
                <TabsTrigger value="content">Content</TabsTrigger>
              </TabsList>

              {/* Metadata tab */}
              <TabsContent value="metadata" className="flex-1 overflow-y-auto space-y-4 pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Proposal Title</Label>
                    <Input
                      value={proposal.title}
                      onChange={(e) => setProposal((p) => p ? { ...p, title: e.target.value } : p)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Customer Name</Label>
                    <Input
                      value={proposal.customerName ?? ''}
                      onChange={(e) => setProposal((p) => p ? { ...p, customerName: e.target.value || undefined } : p)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Opportunity ID</Label>
                    <Input
                      value={proposal.opportunityId ?? ''}
                      onChange={(e) => setProposal((p) => p ? { ...p, opportunityId: e.target.value || undefined } : p)}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Outline Summary</Label>
                    <Textarea
                      rows={4}
                      value={proposal.outlineSummary ?? ''}
                      onChange={(e) => setProposal((p) => p ? { ...p, outlineSummary: e.target.value || undefined } : p)}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Content tab */}
              <TabsContent value="content" className="flex-1 min-h-0 flex flex-col">
                {hasHtml ? (
                  <RichTextEditor
                    value={htmlContent}
                    onChange={handleHtmlChange}
                    disabled={isSaving}
                    className="flex-1 min-h-0"
                    minHeight="calc(92vh - 260px)"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    No HTML content available. Try regenerating the proposal.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          <Separator className="shrink-0 mt-2" />

          {/* Footer */}
          <div className="shrink-0 pt-3 flex justify-between items-center gap-2">
            <Button variant="outline" onClick={handleRegenerate} disabled={isMutating || isSaving}>
              Regenerate from AI
            </Button>
            <Button onClick={handleSave} disabled={!canSave || isSaving}>
              {isSaving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><Save className="mr-2 h-4 w-4" />Save as RFP Document</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
