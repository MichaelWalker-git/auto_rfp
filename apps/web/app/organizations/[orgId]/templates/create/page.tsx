'use client';

import { useCallback, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Save, ArrowLeft, FileText, Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { RichTextEditor, stripPresignedUrlsFromHtml } from '@/components/rfp-documents/rich-text-editor';
import { useCreateTemplate } from '@/lib/hooks/use-templates';
import { useCustomDocumentTypes, useSaveCustomDocumentType } from '@/lib/hooks/use-rfp-documents';
import { usePresignUpload, usePresignDownload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import type { Editor } from '@tiptap/react';
import { MacroInsertionBar } from '@/components/templates/MacroInsertionBar';

const BUILT_IN_CATEGORIES = [
  { value: 'COVER_LETTER', label: 'Cover Letter' },
  { value: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { value: 'UNDERSTANDING_OF_REQUIREMENTS', label: 'Understanding of Requirements' },
  { value: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { value: 'PROJECT_PLAN', label: 'Project Plan' },
  { value: 'TEAM_QUALIFICATIONS', label: 'Team Qualifications' },
  { value: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { value: 'COST_PROPOSAL', label: 'Cost Proposal' },
  { value: 'MANAGEMENT_APPROACH', label: 'Management Approach' },
  { value: 'RISK_MANAGEMENT', label: 'Risk Management' },
  { value: 'COMPLIANCE_MATRIX', label: 'Compliance Matrix' },
  { value: 'CERTIFICATIONS', label: 'Certifications' },
  { value: 'APPENDICES', label: 'Appendices' },
  { value: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { value: 'PRICE_VOLUME', label: 'Price Volume' },
  { value: 'QUALITY_MANAGEMENT', label: 'Quality Management Plan' },
  { value: 'CLARIFYING_QUESTIONS', label: 'Clarifying Questions' },
  { value: 'CUSTOM', label: 'Custom' },
];

export default function CreateTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDescription, setNewTypeDescription] = useState('');
  const editorRef = useRef<Editor | null>(null);

  const { toast } = useToast();
  const { create, isCreating } = useCreateTemplate();
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();
  const { customTypes, mutate: mutateCustomTypes } = useCustomDocumentTypes(orgId);
  const { trigger: saveCustomType } = useSaveCustomDocumentType(orgId);

  // Merge built-in + custom categories
  const builtInValues = new Set(BUILT_IN_CATEGORIES.map((c) => c.value));
  const allCategories = [
    ...BUILT_IN_CATEGORIES,
    ...customTypes
      .filter((ct) => !builtInValues.has(ct.slug))
      .map((ct) => ({ value: ct.slug, label: ct.name })),
  ];

  const insertMacro = (key: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  };

  const handleUploadImageToS3 = useCallback(async (file: File): Promise<string> => {
    const prefix = `${orgId}/template-images`;
    const presign = await triggerPresignUpload({ fileName: file.name, contentType: file.type, prefix });
    await uploadFileToS3(presign.url, presign.method, file);
    return presign.key;
  }, [orgId, triggerPresignUpload]);

  const handleGetDownloadUrl = useCallback(async (key: string): Promise<string> => {
    const presign = await triggerPresignDownload({ key });
    return presign.url;
  }, [triggerPresignDownload]);

  const handleCreateType = async () => {
    if (!newTypeName.trim()) return;
    try {
      const result = await saveCustomType({ name: newTypeName.trim(), description: newTypeDescription.trim() || null });
      await mutateCustomTypes();
      setCategory(result.item.slug);
      setCreateTypeOpen(false);
      setNewTypeName('');
      setNewTypeDescription('');
      toast({ title: 'Document type created' });
    } catch {
      toast({ title: 'Failed to create document type', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    try {
      const cleanContent = stripPresignedUrlsFromHtml(content);

      await create({
        orgId,
        name: name.trim(),
        category,
        htmlContent: cleanContent,
      });

      toast({
        title: 'Template created',
        description: `"${name.trim()}" is ready to use.`,
      });

      router.push(`/organizations/${orgId}/templates`);
    } catch (err) {
      toast({
        title: 'Failed to create template',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const isDisabled = isCreating || isImageUploading;

  return (
    <div className="container mx-auto py-6 px-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/organizations/${orgId}/templates`}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title="Back to Templates"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Create Template</h1>
            <p className="text-muted-foreground text-sm">
              Create a reusable template for RFP document generation
            </p>
          </div>
        </div>
      </div>

      {/* Metadata + Save button */}
      <div className="flex gap-6 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Technical Proposal — DoD"
                disabled={isDisabled}
              />
            </div>

            <div className="w-64 space-y-2">
              <Label>Category *</Label>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={categoryOpen}
                    disabled={isDisabled}
                    className={cn('w-full justify-between', !category && 'text-muted-foreground')}
                  >
                    <span className="truncate">
                      {allCategories.find((c) => c.value === category)?.label || 'Select category…'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search categories…" />
                    <CommandList>
                      <CommandEmpty>No categories found.</CommandEmpty>
                      <CommandGroup>
                        {allCategories.map((c) => (
                          <CommandItem
                            key={c.value}
                            value={c.label}
                            onSelect={() => {
                              setCategory(c.value);
                              setCategoryOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', category === c.value ? 'opacity-100' : 'opacity-0')} />
                            {c.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandItem
                        onSelect={() => {
                          setCategoryOpen(false);
                          setCreateTypeOpen(true);
                        }}
                        className="cursor-pointer"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Create new document type
                      </CommandItem>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <Button
              onClick={handleSave}
              disabled={isDisabled || !name.trim() || !category}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </div>
        </div>
        {/* Spacer matching sidebar width */}
        <div className="w-72 shrink-0 hidden lg:block" />
      </div>

      {/* Editor + Right sidebar */}
      <div className="flex gap-6">
        <div className="flex-1 min-w-0 space-y-2">
          <Label>Template Content</Label>
          <div className="min-h-[500px]">
            <RichTextEditor
              value={content}
              onChange={setContent}
              disabled={isDisabled}
              minHeight="500px"
              onUploadImageToS3={handleUploadImageToS3}
              onGetDownloadUrl={handleGetDownloadUrl}
              onUploadingChange={setIsImageUploading}
              onEditorReady={(editor) => { editorRef.current = editor; }}
            />
          </div>
        </div>

        {/* Right sidebar: Variables */}
        <div className="w-72 shrink-0 hidden lg:block">
          <div className="sticky top-4">
            <MacroInsertionBar onInsert={insertMacro} disabled={isDisabled} />
          </div>
        </div>
      </div>

      {/* Mobile: show variables below editor */}
      <div className="lg:hidden mt-6">
        <MacroInsertionBar onInsert={insertMacro} disabled={isDisabled} />
      </div>

      {/* Create Document Type Dialog */}
      <Dialog open={createTypeOpen} onOpenChange={setCreateTypeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Document Type</DialogTitle>
            <DialogDescription>
              Add a custom document type for your organization. The description helps the AI generate better content.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="typeName">Name *</Label>
              <Input
                id="typeName"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="e.g., NDA, Oral Presentation, References"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="typeDescription">Description</Label>
              <Textarea
                id="typeDescription"
                value={newTypeDescription}
                onChange={(e) => setNewTypeDescription(e.target.value)}
                placeholder="Describe what this document type is for. This helps the AI generate better content."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTypeOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateType} disabled={!newTypeName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
