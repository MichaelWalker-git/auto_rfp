'use client';

import React, { useEffect, useState } from 'react';
import { Brain, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useGenerateProposal } from '@/lib/hooks/use-proposal';
import {
  type RFPDocumentType,
  RFP_DOCUMENT_TYPES,
  useCreateRFPDocument,
  useUpdateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import type { ProposalDocument, ProposalSection, ProposalSubsection } from '@auto-rfp/shared';
import PermissionWrapper from '@/components/permission-wrapper';

/** 
 * Document types that support AI generation (aligned with template categories).
 * Note: These types must match those defined in shared/src/schemas/rfp-document.ts
 * After schema update, run `pnpm -w build` in the shared package.
 */
const GENERATABLE_TYPES_CONFIG: { key: string; label: string }[] = [
  { key: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { key: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { key: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { key: 'PRICE_VOLUME', label: 'Price Volume' },
  { key: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { key: 'CERTIFICATIONS', label: 'Certifications' },
];

const GENERATABLE_TYPES = GENERATABLE_TYPES_CONFIG.map(t => t.key);

function getDocTypeLabel(key: string): string {
  const config = GENERATABLE_TYPES_CONFIG.find(t => t.key === key);
  if (config) return config.label;
  return (RFP_DOCUMENT_TYPES as Record<string, string>)[key] ?? key;
}

interface GenerateDocumentDialogProps {
  projectId: string;
  opportunityId: string;
  orgId: string;
  onSuccess?: () => void;
}

export function GenerateDocumentDialog({
  projectId,
  opportunityId,
  orgId,
  onSuccess,
}: GenerateDocumentDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<RFPDocumentType>('TECHNICAL_PROPOSAL');
  const [document, setDocument] = useState<ProposalDocument | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isGeneratable = GENERATABLE_TYPES.includes(selectedType);

  const { trigger: triggerGenerate, isMutating: isGenerating, error: generateError } = useGenerateProposal();
  const { trigger: triggerCreate, isMutating: isCreating } = useCreateRFPDocument(orgId);
  const { trigger: triggerUpdate, isMutating: isUpdating } = useUpdateRFPDocument(orgId);

  const isSaving = isCreating || isUpdating;
  const isBusy = isGenerating || isSaving;

  useEffect(() => {
    if (generateError) {
      setLocalError(generateError instanceof Error ? generateError.message : 'Generation failed');
    }
  }, [generateError]);

  const handleOpen = () => {
    setIsOpen(true);
    setDocument(null);
    setSavedDocumentId(null);
    setSaveMessage(null);
    setLocalError(null);
  };

  const handleGenerate = async () => {
    if (!isGeneratable) return;
    setLocalError(null);
    try {
      const result = await triggerGenerate({
        projectId,
        documentType: selectedType,
      });
      if (result) setDocument(result);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Generation failed');
    }
  };

  const handleSave = async () => {
    if (!document) return;
    setSaveMessage(null);
    setLocalError(null);

    try {
      if (savedDocumentId) {
        await triggerUpdate({
          projectId,
          opportunityId,
          documentId: savedDocumentId,
          name: document.proposalTitle || `Generated ${RFP_DOCUMENT_TYPES[selectedType]}`,
          documentType: selectedType,
          content: document,
          title: document.proposalTitle,
        });
      } else {
        const result = await triggerCreate({
          projectId,
          opportunityId,
          name: document.proposalTitle || `Generated ${RFP_DOCUMENT_TYPES[selectedType]}`,
          documentType: selectedType,
          mimeType: 'application/json',
          fileSizeBytes: 0,
          ...({ content: document, status: 'NEW', title: document.proposalTitle } as any),
        });
        if (result?.document?.documentId) {
          setSavedDocumentId(result.document.documentId);
        }
      }
      setSaveMessage('Saved ✅');
      onSuccess?.();
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleSectionChange = (index: number, field: keyof ProposalSection, value: string) => {
    setDocument(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], [field]: value };
      return { ...prev, sections };
    });
  };

  const handleSubsectionChange = (sIdx: number, subIdx: number, field: keyof ProposalSubsection, value: string) => {
    setDocument(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const section = { ...sections[sIdx] };
      const subsections = [...section.subsections];
      subsections[subIdx] = { ...subsections[subIdx], [field]: value };
      section.subsections = subsections;
      sections[sIdx] = section;
      return { ...prev, sections };
    });
  };

  const removeSection = (index: number) => {
    setDocument(prev => {
      if (!prev) return prev;
      return { ...prev, sections: prev.sections.filter((_, i) => i !== index) };
    });
  };

  const removeSubsection = (sIdx: number, subIdx: number) => {
    setDocument(prev => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const section = { ...sections[sIdx] };
      section.subsections = section.subsections.filter((_, i) => i !== subIdx);
      sections[sIdx] = section;
      return { ...prev, sections };
    });
  };

  return (
    <>
      <PermissionWrapper requiredPermission="proposal:create">
        <Button size="sm" variant="outline" onClick={handleOpen} className="h-8 text-xs gap-1">
          <Brain className="h-3.5 w-3.5" />
          Generate
        </Button>
      </PermissionWrapper>

      <Dialog open={isOpen} onOpenChange={setIsOpen} modal>
        <DialogContent className="!w-[55vw] !max-w-none h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Generate RFP Document</DialogTitle>
            <DialogDescription>
              Select a document type and generate content using AI.
            </DialogDescription>
          </DialogHeader>

          {/* Document type selector - only show types that support generation */}
          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select value={selectedType} onValueChange={(v) => setSelectedType(v as RFPDocumentType)} disabled={isBusy || !!document}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATABLE_TYPES_CONFIG.map(({ key, label }) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status messages */}
          <div className="flex flex-col gap-2">
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
          </div>

          {/* Content area */}
          <div className="flex-1 min-h-0 flex flex-col">
            {!document && !isGenerating && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 flex-1">
                <Brain className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {isGeneratable
                    ? 'Click "Generate" to create content using AI based on your project questions.'
                    : `Upload a ${RFP_DOCUMENT_TYPES[selectedType]} document instead.`}
                </p>
                {isGeneratable && (
                  <Button onClick={handleGenerate} disabled={isBusy}>
                    <Brain className="h-4 w-4 mr-2" />
                    Generate {RFP_DOCUMENT_TYPES[selectedType]}
                  </Button>
                )}
              </div>
            )}

            {isGenerating && !document && (
              <div className="flex items-center justify-center py-10 flex-1">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Generating {RFP_DOCUMENT_TYPES[selectedType]} from AI...</span>
              </div>
            )}

            {document && (
              <ScrollArea className="flex-1 min-h-0 border rounded-md">
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Title</Label>
                      <Input value={document.proposalTitle} onChange={(e) => setDocument(d => d ? { ...d, proposalTitle: e.target.value } : d)} disabled={isBusy} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Customer Name</Label>
                      <Input value={document.customerName ?? ''} onChange={(e) => setDocument(d => d ? { ...d, customerName: e.target.value || undefined } : d)} disabled={isBusy} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Summary</Label>
                      <Textarea rows={3} value={document.outlineSummary ?? ''} onChange={(e) => setDocument(d => d ? { ...d, outlineSummary: e.target.value || undefined } : d)} disabled={isBusy} />
                    </div>
                  </div>

                  {document.sections.map((section, sIdx) => (
                    <div key={section.id || sIdx} className="border rounded-md p-3 space-y-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Section {sIdx + 1}</Label>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeSection(sIdx)} disabled={isBusy}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input value={section.title} onChange={(e) => handleSectionChange(sIdx, 'title', e.target.value)} disabled={isBusy} placeholder="Section title" />
                      <Textarea rows={2} value={section.summary ?? ''} onChange={(e) => handleSectionChange(sIdx, 'summary', e.target.value)} disabled={isBusy} placeholder="Summary" />

                      {section.subsections.map((sub, subIdx) => (
                        <div key={sub.id || subIdx} className="border rounded-md p-3 space-y-2 bg-background">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold">{sIdx + 1}.{subIdx + 1}</Label>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => removeSubsection(sIdx, subIdx)} disabled={isBusy}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Input value={sub.title} onChange={(e) => handleSubsectionChange(sIdx, subIdx, 'title', e.target.value)} disabled={isBusy} placeholder="Subsection title" />
                          <Textarea rows={5} value={sub.content} onChange={(e) => handleSubsectionChange(sIdx, subIdx, 'content', e.target.value)} disabled={isBusy} placeholder="Content" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex justify-between items-center gap-2 pt-2 border-t">
            <div className="flex gap-2">
              {document && isGeneratable && (
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isBusy}>
                  Regenerate
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsOpen(false)} disabled={isBusy}>
                Cancel
              </Button>
              {document && (
                <Button size="sm" onClick={handleSave} disabled={isBusy}>
                  {isSaving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-1" />Save</>}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}