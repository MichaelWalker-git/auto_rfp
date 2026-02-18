'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Brain, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useGenerateProposal } from '@/lib/hooks/use-proposal';
import { useCreateRFPDocument, useUpdateRFPDocument } from '@/lib/hooks/use-rfp-documents';
import type { ProposalDocument, ProposalSection, ProposalSubsection } from '@auto-rfp/core';
import PermissionWrapper from '@/components/permission-wrapper';
import { useCurrentOrganization } from '@/context/organization-context';

type Props = {
  projectId: string;
  opportunityId?: string;
  onSave?: () => void;
};

type PendingDelete =
  | { type: 'section'; sectionIndex: number }
  | { type: 'subsection'; sectionIndex: number; subsectionIndex: number }
  | null;

export const GenerateProposalModal: React.FC<Props> = ({
  projectId,
  opportunityId,
  onSave,
}) => {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<ProposalDocument>();
  const [localError, setLocalError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;

  const { trigger: triggerCreate, isMutating: isCreating } = useCreateRFPDocument(orgId);
  const { trigger: triggerUpdate, isMutating: isUpdating } = useUpdateRFPDocument(orgId);

  const isSaving = isCreating || isUpdating;

  const {
    trigger: triggerGenerate,
    data: generatedProposal,
    isMutating,
    error: generateError,
  } = useGenerateProposal();

  useEffect(() => {
    if (generatedProposal) setProposal(generatedProposal);
  }, [generatedProposal]);

  useEffect(() => {
    if (generateError) {
      setLocalError(generateError instanceof Error ? generateError.message : 'Failed to generate proposal');
      return;
    }
    setLocalError(null);
  }, [generateError]);

  const deleteTitle = useMemo(() => {
    if (!pendingDelete) return 'Remove item?';
    return pendingDelete.type === 'section' ? 'Remove section?' : 'Remove subsection?';
  }, [pendingDelete]);

  const deleteDescription = useMemo(() => {
    if (!pendingDelete || !proposal) return 'This action cannot be undone.';
    if (pendingDelete.type === 'section') {
      const s = proposal.sections[pendingDelete.sectionIndex];
      return `This will remove the section "${s?.title ?? ''}" and all its subsections.`;
    }
    const s = proposal.sections[pendingDelete.sectionIndex];
    const sub = s?.subsections?.[pendingDelete.subsectionIndex];
    return `This will remove the subsection "${sub?.title ?? ''}".`;
  }, [pendingDelete, proposal]);

  const handleOpen = () => {
    setOpen(true);
    if (!proposal && !isMutating) {
      triggerGenerate({ projectId });
    }
  };

  const handleRegenerate = () => triggerGenerate({ projectId });

  const handleSave = async () => {
    if (!proposal) return;

    setSaveMessage(null);
    setLocalError(null);

    try {
      const effectiveOpportunityId = opportunityId || 'default';

      if (savedDocumentId) {
        // Update existing RFP document
        await triggerUpdate({
          projectId,
          opportunityId: effectiveOpportunityId,
          documentId: savedDocumentId,
          name: proposal.proposalTitle || 'Generated Proposal',
          documentType: 'PROPOSAL',
          content: proposal,
          title: proposal.proposalTitle || 'Generated Proposal',
        });
      } else {
        // Create new RFP document of type PROPOSAL
        const result = await triggerCreate({
          projectId,
          opportunityId: effectiveOpportunityId,
          name: proposal.proposalTitle || 'Generated Proposal',
          documentType: 'PROPOSAL',
          mimeType: 'application/json',
          fileSizeBytes: 0,
          // Pass content via the body - the lambda handles content-based documents
          ...({ content: proposal, status: 'NEW', title: proposal.proposalTitle } as any),
        });

        if (result?.document?.documentId) {
          setSavedDocumentId(result.document.documentId);
        }
      }

      setSaveMessage('Saved ✅');
      onSave?.();
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save proposal');
    }
  };

  const handleSectionChange = (index: number, field: keyof ProposalSection, value: string) => {
    setProposal(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const section = sections[index];
      if (!section) return prev;
      sections[index] = { ...section, [field]: value };
      return { ...prev, sections };
    });
  };

  const handleSubsectionChange = (
    sectionIndex: number,
    subsectionIndex: number,
    field: keyof ProposalSubsection,
    value: string,
  ) => {
    setProposal(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const section = sections[sectionIndex];
      if (!section) return prev;
      const subsections = [...section.subsections];
      const subsection = subsections[subsectionIndex];
      if (!subsection) return prev;
      subsections[subsectionIndex] = { ...subsection, [field]: value };
      sections[sectionIndex] = { ...section, subsections };
      return { ...prev, sections };
    });
  };

  const openDeleteConfirm = (payload: Exclude<PendingDelete, null>) => {
    setPendingDelete(payload);
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    setProposal(prev => {
      if (!prev || !pendingDelete) return prev;
      if (pendingDelete.type === 'section') {
        return {
          ...prev,
          sections: prev.sections.filter((_: ProposalSection, idx: number) => idx !== pendingDelete.sectionIndex),
        };
      }
      const { sectionIndex, subsectionIndex } = pendingDelete;
      const sections = [...prev.sections];
      const section = sections[sectionIndex];
      sections[sectionIndex] = {
        ...section,
        subsections: section.subsections.filter((_: ProposalSubsection, idx: number) => idx !== subsectionIndex),
      };
      return { ...prev, sections };
    });
    setConfirmOpen(false);
    setPendingDelete(null);
  };

  return (
    <>
      <PermissionWrapper requiredPermission={'proposal:create'}>
        <Button onClick={handleOpen} disabled={isMutating} variant="outline" className="gap-1">
          {isMutating && !proposal ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating proposal...
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
        <DialogContent className="!w-[55vw] !max-w-none h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Generate Proposal</DialogTitle>
            <DialogDescription>
              Review and adjust the generated proposal. It will be saved as an RFP document.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {localError && (
              <div className="text-sm text-red-500 border border-red-500/30 rounded-md px-3 py-2 bg-red-500/5">
                {localError}
              </div>
            )}

            {saveMessage && (
              <div className="text-sm text-green-600 border border-green-600/30 rounded-md px-3 py-2 bg-green-500/5">
                {saveMessage}
              </div>
            )}

            {!proposal && !isMutating && (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <p className="text-sm text-muted-foreground">No proposal generated yet.</p>
                <Button size="sm" onClick={handleRegenerate}>Generate again</Button>
              </div>
            )}

            {isMutating && !proposal && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Generating proposal from AI...</span>
              </div>
            )}

            {proposal && (
              <ScrollArea className="flex-1 min-h-0 border rounded-md">
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Proposal title</Label>
                      <Input
                        value={proposal.proposalTitle}
                        onChange={(e) => setProposal(p => p ? { ...p, proposalTitle: e.target.value } : p)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Customer name</Label>
                      <Input
                        value={proposal.customerName ?? ''}
                        onChange={(e) => setProposal(p => p ? { ...p, customerName: e.target.value || undefined } : p)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Opportunity ID</Label>
                      <Input
                        value={proposal.opportunityId ?? ''}
                        onChange={(e) => setProposal(p => p ? { ...p, opportunityId: e.target.value || undefined } : p)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Outline summary</Label>
                      <Textarea
                        rows={3}
                        value={proposal.outlineSummary ?? ''}
                        onChange={(e) => setProposal(p => p ? { ...p, outlineSummary: e.target.value || undefined } : p)}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    {proposal.sections.map((section, sectionIndex) => (
                      <div key={`${section.id || 'section'}-${sectionIndex}`} className="border rounded-md p-3 space-y-3 bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm font-semibold">Section {sectionIndex + 1}</Label>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => openDeleteConfirm({ type: 'section', sectionIndex })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <Label>Title</Label>
                          <Input value={section.title} onChange={(e) => handleSectionChange(sectionIndex, 'title', e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Summary</Label>
                          <Textarea rows={3} value={section.summary ?? ''} onChange={(e) => handleSectionChange(sectionIndex, 'summary', e.target.value)} />
                        </div>
                        <div className="space-y-3">
                          {section.subsections.map((subsection, subsectionIndex) => (
                            <div key={`${subsection.id || 'sub'}-${sectionIndex}-${subsectionIndex}`} className="border rounded-md p-3 space-y-2 bg-background">
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-xs font-semibold">Subsection {sectionIndex + 1}.{subsectionIndex + 1}</Label>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => openDeleteConfirm({ type: 'subsection', sectionIndex, subsectionIndex })}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="space-y-1">
                                <Label>Title</Label>
                                <Input value={subsection.title} onChange={(e) => handleSubsectionChange(sectionIndex, subsectionIndex, 'title', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <Label>Content</Label>
                                <Textarea rows={6} value={subsection.content} onChange={(e) => handleSubsectionChange(sectionIndex, subsectionIndex, 'content', e.target.value)} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {proposal.sections.length === 0 && (
                      <p className="text-xs text-muted-foreground">No sections. You can regenerate the proposal.</p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="mt-4 flex justify-between items-center gap-2">
            <Button variant="outline" onClick={handleRegenerate} disabled={isMutating || isSaving}>
              Regenerate from AI
            </Button>
            <Button onClick={handleSave} disabled={!proposal || isSaving}>
              {isSaving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
              ) : (
                <><Save className="mr-2 h-4 w-4" />Save as RFP Document</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setConfirmOpen(false); setPendingDelete(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};