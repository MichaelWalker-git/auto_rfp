'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Brain, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from '@/components/ui/dialog';
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

import { buildSaveRequest, useGenerateProposal, useSaveProposal } from '@/lib/hooks/use-proposal';
import type { ProposalDocument, ProposalSection, ProposalSubsection } from '@auto-rfp/shared';
import { ProposalStatus } from '@auto-rfp/shared';

interface GenerateProposalModalProps {
  projectId: string;
}

type PendingDelete =
  | { type: 'section'; sectionIndex: number }
  | { type: 'subsection'; sectionIndex: number; subsectionIndex: number }
  | null;

export const GenerateProposalModal: React.FC<GenerateProposalModalProps> = ({
                                                                              projectId,
                                                                            }) => {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<ProposalDocument>();
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const [savedProposalId, setSavedProposalId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const {
    trigger: triggerSave,
    isMutating: isSaving,
    error: saveError,
  } = useSaveProposal();

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
    if (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : 'Failed to save proposal');
      return;
    }
    setLocalError(null);
  }, [generateError, saveError]);

  const deleteTitle = useMemo(() => {
    if (!pendingDelete) return 'Remove item?';
    return pendingDelete.type === 'section'
      ? 'Remove section?'
      : 'Remove subsection?';
  }, [pendingDelete]);

  const deleteDescription = useMemo(() => {
    if (!pendingDelete || !proposal) return 'This action cannot be undone.';

    if (pendingDelete.type === 'section') {
      const s = proposal.sections[pendingDelete.sectionIndex];
      return `This will remove the section "${s?.title ?? ''}" and all its subsections from the exported PDF.`;
    }

    const s = proposal.sections[pendingDelete.sectionIndex];
    const sub = s?.subsections?.[pendingDelete.subsectionIndex];
    return `This will remove the subsection "${sub?.title ?? ''}" from the exported PDF.`;
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

    const payload = buildSaveRequest({
      id: savedProposalId ?? undefined,
      projectId,
      organizationId: null, // add prop later if needed
      document: proposal,
      status: ProposalStatus.NEW,
      title: proposal.proposalTitle ?? null,
    });

    const saved = await triggerSave(payload);

    if (!saved) throw new Error('Save failed: empty response from API');

    setSavedProposalId(saved.id);
    setProposal(saved.document);
    setSaveMessage('Saved ✅');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  const handleSectionChange = (
    index: number,
    field: keyof ProposalSection,
    value: string,
  ) => {
    setProposal(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], [field]: value };
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
      const subsections = [...section.subsections];
      subsections[subsectionIndex] = {
        ...subsections[subsectionIndex],
        [field]: value,
      };
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
          sections: prev.sections.filter(
            (_: ProposalSection, idx: number) => idx !== pendingDelete.sectionIndex,
          ),
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

  const handlePdfDownload = async () => {
    if (!proposal) return;

    try {
      setIsPdfGenerating(true);

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      let cursorY = 40;
      const lineHeight = 16;
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 40;
      const maxWidth = pageWidth - marginX * 2;

      const addTextBlock = (
        text: string,
        options?: { bold?: boolean; fontSize?: number },
      ) => {
        const { bold = false, fontSize = 11 } = options ?? {};
        doc.setFont('Helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(fontSize);

        const lines = doc.splitTextToSize(text, maxWidth);
        lines.forEach((line: string) => {
          if (cursorY > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            cursorY = 40;
          }
          doc.text(line, marginX, cursorY);
          cursorY += lineHeight;
        });
        cursorY += 4;
      };

      addTextBlock(proposal.proposalTitle || 'Proposal', {
        bold: true,
        fontSize: 18,
      });
      cursorY += 10;

      if (proposal.customerName) addTextBlock(`Customer: ${proposal.customerName}`, { bold: true });
      if (proposal.opportunityId) addTextBlock(`Opportunity ID: ${proposal.opportunityId}`, { bold: true });

      if (proposal.outlineSummary) {
        cursorY += 10;
        addTextBlock('Overview:', { bold: true, fontSize: 13 });
        addTextBlock(proposal.outlineSummary);
      }

      cursorY += 10;

      proposal.sections.forEach((section, sectionIndex) => {
        cursorY += 10;
        addTextBlock(`${sectionIndex + 1}. ${section.title}`, { bold: true, fontSize: 14 });
        if (section.summary) addTextBlock(section.summary);

        section.subsections.forEach((subsection, subsectionIndex) => {
          cursorY += 6;
          addTextBlock(
            `${sectionIndex + 1}.${subsectionIndex + 1} ${subsection.title}`,
            { bold: true, fontSize: 12 },
          );
          addTextBlock(subsection.content);
        });
      });

      const fileName =
        (proposal.proposalTitle || `proposal-${projectId}`).replace(/[^\w\d\-]+/g, '_') +
        '.pdf';

      doc.save(fileName);
    } finally {
      setIsPdfGenerating(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        disabled={isMutating}
        variant="outline"
        size="sm"
        className="gap-1"
      >
        {isMutating && !proposal ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
            Generating proposal...
          </>
        ) : (
          <>
            <Brain className="h-4 w-4"/>
            Generate proposal
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen} modal>
        <DialogContent className="!w-[55vw] !max-w-none h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Generate Proposal</DialogTitle>
            <DialogDescription>
              Review and adjust the generated proposal sections before exporting as PDF.
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
                <Button size="sm" onClick={handleRegenerate}>
                  Generate again
                </Button>
              </div>
            )}

            {isMutating && !proposal && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin mr-2"/>
                <span className="text-sm text-muted-foreground">
                  Generating proposal from AI...
                </span>
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
                        onChange={(e) =>
                          setProposal((p) => (p ? { ...p, proposalTitle: e.target.value } : p))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Customer name</Label>
                      <Input
                        value={proposal.customerName ?? ''}
                        onChange={(e) =>
                          setProposal((p) =>
                            p ? { ...p, customerName: e.target.value || undefined } : p,
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Opportunity ID</Label>
                      <Input
                        value={proposal.opportunityId ?? ''}
                        onChange={(e) =>
                          setProposal((p) =>
                            p ? { ...p, opportunityId: e.target.value || undefined } : p,
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Outline summary</Label>
                      <Textarea
                        rows={3}
                        value={proposal.outlineSummary ?? ''}
                        onChange={(e) =>
                          setProposal((p) =>
                            p ? { ...p, outlineSummary: e.target.value || undefined } : p,
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    {proposal.sections.map((section, sectionIndex) => (
                      <div
                        // ✅ key must be stable even if ids repeat/missing
                        key={`${section.id || 'section'}-${sectionIndex}`}
                        className="border rounded-md p-3 space-y-3 bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm font-semibold">
                            Section {sectionIndex + 1}
                          </Label>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500"
                            onClick={() =>
                              openDeleteConfirm({ type: 'section', sectionIndex })
                            }
                          >
                            <Trash2 className="h-4 w-4"/>
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <Label>Title</Label>
                          <Input
                            value={section.title}
                            onChange={(e) =>
                              handleSectionChange(sectionIndex, 'title', e.target.value)
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Summary</Label>
                          <Textarea
                            rows={3}
                            value={section.summary ?? ''}
                            onChange={(e) =>
                              handleSectionChange(sectionIndex, 'summary', e.target.value)
                            }
                          />
                        </div>

                        <div className="space-y-3">
                          {section.subsections.map((subsection, subsectionIndex) => (
                            <div
                              key={`${subsection.id || 'sub'}-${sectionIndex}-${subsectionIndex}`}
                              className="border rounded-md p-3 space-y-2 bg-background"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-xs font-semibold">
                                  Subsection {sectionIndex + 1}.{subsectionIndex + 1}
                                </Label>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500"
                                  onClick={() =>
                                    openDeleteConfirm({
                                      type: 'subsection',
                                      sectionIndex,
                                      subsectionIndex,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4"/>
                                </Button>
                              </div>

                              <div className="space-y-1">
                                <Label>Title</Label>
                                <Input
                                  value={subsection.title}
                                  onChange={(e) =>
                                    handleSubsectionChange(
                                      sectionIndex,
                                      subsectionIndex,
                                      'title',
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>

                              <div className="space-y-1">
                                <Label>Content</Label>
                                <Textarea
                                  rows={6}
                                  value={subsection.content}
                                  onChange={(e) =>
                                    handleSubsectionChange(
                                      sectionIndex,
                                      subsectionIndex,
                                      'content',
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {proposal.sections.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No sections. You can regenerate the proposal.
                      </p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="mt-4 flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleRegenerate} disabled={isMutating || isSaving}>
                Regenerate from AI
              </Button>

              <Button onClick={handleSave} disabled={!proposal || isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4"/>
                    Save
                  </>
                )}
              </Button>
            </div>

            <Button onClick={handlePdfDownload} disabled={!proposal || isPdfGenerating}>
              {isPdfGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                  Generating PDF...
                </>
              ) : (
                'Generate PDF'
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
            <AlertDialogCancel
              onClick={() => {
                setConfirmOpen(false);
                setPendingDelete(null);
              }}
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction onClick={confirmDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
