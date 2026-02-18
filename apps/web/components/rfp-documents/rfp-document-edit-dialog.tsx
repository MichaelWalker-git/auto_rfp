'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { type RFPDocumentItem, type RFPDocumentType, RFP_DOCUMENT_TYPES, useUpdateRFPDocument } from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
  onSuccess?: () => void;
}

export function RFPDocumentEditDialog({ open, onOpenChange, document: doc, orgId, onSuccess }: Props) {
  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState<RFPDocumentType>('OTHER');
  const [content, setContent] = useState<Record<string, any> | null>(null);

  const isContentBased = doc?.documentType === 'TECHNICAL_PROPOSAL' || doc?.content != null;

  useEffect(() => {
    if (doc) {
      setName(doc.name);
      setDescription(doc.description ?? '');
      setDocumentType(doc.documentType);
      setContent(doc.content ? structuredClone(doc.content) : null);
    }
  }, [doc]);

  const handleSave = useCallback(async () => {
    if (!doc || !name.trim()) return;
    try {
      const updatePayload: Record<string, any> = {
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
        name: name.trim(),
        description: description.trim() || null,
        documentType,
      };

      if (isContentBased && content) {
        updatePayload.content = content;
        updatePayload.title = content.proposalTitle || name.trim();
      }

      await updateDocument(updatePayload as any);
      toast({ title: 'Document updated', description: `"${name.trim()}" has been updated.` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not update document', variant: 'destructive' });
    }
  }, [doc, name, description, documentType, content, isContentBased, updateDocument, toast, onOpenChange, onSuccess]);

  // Content editing helpers
  const setContentField = (key: string, value: any) => {
    setContent(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const setSectionField = (sectionIndex: number, key: string, value: any) => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = [...(prev.sections || [])];
      sections[sectionIndex] = { ...sections[sectionIndex], [key]: value };
      return { ...prev, sections };
    });
  };

  const setSubsectionField = (sectionIndex: number, subIndex: number, key: string, value: any) => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = [...(prev.sections || [])];
      const section = { ...sections[sectionIndex] };
      const subsections = [...(section.subsections || [])];
      subsections[subIndex] = { ...subsections[subIndex], [key]: value };
      section.subsections = subsections;
      sections[sectionIndex] = section;
      return { ...prev, sections };
    });
  };

  const addSection = () => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = [...(prev.sections || [])];
      sections.push({
        id: crypto.randomUUID(),
        title: 'New Section',
        summary: '',
        subsections: [],
      });
      return { ...prev, sections };
    });
  };

  const removeSection = (index: number) => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = (prev.sections || []).filter((_: any, i: number) => i !== index);
      return { ...prev, sections };
    });
  };

  const addSubsection = (sectionIndex: number) => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = [...(prev.sections || [])];
      const section = { ...sections[sectionIndex] };
      section.subsections = [...(section.subsections || []), {
        id: crypto.randomUUID(),
        title: 'New Subsection',
        content: '',
      }];
      sections[sectionIndex] = section;
      return { ...prev, sections };
    });
  };

  const removeSubsection = (sectionIndex: number, subIndex: number) => {
    setContent(prev => {
      if (!prev) return prev;
      const sections = [...(prev.sections || [])];
      const section = { ...sections[sectionIndex] };
      section.subsections = (section.subsections || []).filter((_: any, i: number) => i !== subIndex);
      sections[sectionIndex] = section;
      return { ...prev, sections };
    });
  };

  if (!doc) return null;

  const dialogSize = isContentBased ? '!w-[60vw] !max-w-none h-[85vh]' : 'sm:max-w-md';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogSize} flex flex-col`}>
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
          <DialogDescription>
            {isContentBased ? 'Edit the document metadata and content.' : 'Update the metadata for this document.'}
          </DialogDescription>
        </DialogHeader>

        {isContentBased ? (
          <Tabs defaultValue="content" className="flex-1 min-h-0 flex flex-col">
            <TabsList>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
            </TabsList>

            <TabsContent value="metadata" className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Document Name *</Label>
                <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isMutating} />
              </div>
              <div className="space-y-1.5">
                <Label>Document Type</Label>
                <Select value={documentType} onValueChange={(v) => setDocumentType(v as RFPDocumentType)} disabled={isMutating}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RFP_DOCUMENT_TYPES).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={isMutating} />
              </div>
            </TabsContent>

            <TabsContent value="content" className="flex-1 min-h-0">
              <ScrollArea className="h-[calc(85vh-220px)] border rounded-md">
                <div className="p-4 space-y-4">
                  {content && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Title</Label>
                          <Input
                            value={content.proposalTitle || ''}
                            onChange={(e) => setContentField('proposalTitle', e.target.value)}
                            disabled={isMutating}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Customer Name</Label>
                          <Input
                            value={content.customerName || ''}
                            onChange={(e) => setContentField('customerName', e.target.value || undefined)}
                            disabled={isMutating}
                          />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Summary</Label>
                          <Textarea
                            rows={3}
                            value={content.outlineSummary || ''}
                            onChange={(e) => setContentField('outlineSummary', e.target.value || undefined)}
                            disabled={isMutating}
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        {(content.sections || []).map((section: any, sIdx: number) => (
                          <div key={section.id || sIdx} className="border rounded-md p-3 space-y-3 bg-muted/30">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm font-semibold">Section {sIdx + 1}</Label>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeSection(sIdx)} disabled={isMutating}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Title</Label>
                              <Input value={section.title || ''} onChange={(e) => setSectionField(sIdx, 'title', e.target.value)} disabled={isMutating} />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Summary</Label>
                              <Textarea rows={2} value={section.summary || ''} onChange={(e) => setSectionField(sIdx, 'summary', e.target.value)} disabled={isMutating} />
                            </div>

                            {(section.subsections || []).map((sub: any, subIdx: number) => (
                              <div key={sub.id || subIdx} className="border rounded-md p-3 space-y-2 bg-background">
                                <div className="flex items-center justify-between gap-2">
                                  <Label className="text-xs font-semibold">Subsection {sIdx + 1}.{subIdx + 1}</Label>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeSubsection(sIdx, subIdx)} disabled={isMutating}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                                <div className="space-y-1">
                                  <Label>Title</Label>
                                  <Input value={sub.title || ''} onChange={(e) => setSubsectionField(sIdx, subIdx, 'title', e.target.value)} disabled={isMutating} />
                                </div>
                                <div className="space-y-1">
                                  <Label>Content</Label>
                                  <Textarea rows={5} value={sub.content || ''} onChange={(e) => setSubsectionField(sIdx, subIdx, 'content', e.target.value)} disabled={isMutating} />
                                </div>
                              </div>
                            ))}

                            <Button variant="outline" size="sm" onClick={() => addSubsection(sIdx)} disabled={isMutating}>
                              <Plus className="h-4 w-4 mr-1" /> Add Subsection
                            </Button>
                          </div>
                        ))}

                        <Button variant="outline" onClick={addSection} disabled={isMutating}>
                          <Plus className="h-4 w-4 mr-1" /> Add Section
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Document Name *</Label>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isMutating} />
            </div>
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Select value={documentType} onValueChange={(v) => setDocumentType(v as RFPDocumentType)} disabled={isMutating}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RFP_DOCUMENT_TYPES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={isMutating} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>Cancel</Button>
          <Button onClick={handleSave} disabled={isMutating || !name.trim()}>
            {isMutating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
