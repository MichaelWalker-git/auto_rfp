'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
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
import { useUpdateTemplate, useTemplate } from '@/lib/hooks/use-templates';
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

export default function EditTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;
  const templateId = params.templateId as string;

  const [isImageUploading, setIsImageUploading] = useState(false);
  const [isResolvingImages, setIsResolvingImages] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDescription, setNewTypeDescription] = useState('');
  const contentInitializedRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const isSavingRef = useRef(false);

  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const { template, isLoading: isLoadingTemplate } = useTemplate(orgId, templateId);
  const { update, isUpdating } = useUpdateTemplate(orgId, templateId);
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

  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [content, setContent] = useState('');
  const metadataInitializedRef = useRef(!!template);

  useEffect(() => {
    if (!template || metadataInitializedRef.current) return;
    metadataInitializedRef.current = true;
    setName(template.name ?? '');
    setCategory(template.category ?? '');
  }, [template]);

  useEffect(() => {
    if (!template || contentInitializedRef.current) return;

    const rawContent = template.htmlContent ?? '';
    const s3KeyMatches = [...rawContent.matchAll(/src="s3key:([^"]+)"/g)];

    if (s3KeyMatches.length === 0) {
      contentInitializedRef.current = true;
      setContent(rawContent);
      return;
    }

    setIsResolvingImages(true);
    const resolveImages = async () => {
      let resolved = rawContent;
      await Promise.all(
        s3KeyMatches.map(async ([, key]) => {
          try {
            const presign = await triggerPresignDownload({ key });
            resolved = resolved.split(`src="s3key:${key}"`).join(`src="${presign.url}"`);
          } catch {
            console.warn(`Failed to resolve s3key: ${key}`);
          }
        }),
      );
      contentInitializedRef.current = true;
      setContent(resolved);
      setIsResolvingImages(false);
    };

    resolveImages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

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

  // ── Upload any unuploaded images before saving ──
  const uploadPendingImages = useCallback(async (html: string): Promise<string> => {
    // Find all <img> tags and check each one
    const imgTagRegex = /<img[^>]*>/gi;
    const imgTags = [...html.matchAll(imgTagRegex)];
    if (!imgTags.length) return html;

    let result = html;
    for (const match of imgTags) {
      const fullTag = match[0];

      // Skip images that already have data-s3-key (already uploaded)
      if (/data-s3-key=/i.test(fullTag)) continue;

      // Skip images with s3key: src (already uploaded, just needs presign)
      if (/src="s3key:/i.test(fullTag)) continue;

      // Extract src — handle both data: URIs and http(s) URLs
      const srcMatch = fullTag.match(/src="([^"]+)"/);
      if (!srcMatch?.[1]) continue;
      const src = srcMatch[1];

      // Only process data: URIs and external http(s) URLs
      if (!src.startsWith('data:') && !src.startsWith('http')) continue;

      console.log(`[uploadPendingImages] Uploading pasted image: ${src.substring(0, 80)}...`);

      try {
        const res = await fetch(src);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) continue;

        const ext = blob.type.split('/')[1]?.split(';')[0] || 'png';
        const file = new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: blob.type });
        const key = await handleUploadImageToS3(file);

        // Build new tag with data-s3-key and s3key: src
        const newTag = fullTag
          .replace(/src="[^"]*"/, `src="s3key:${key}" data-s3-key="${key}"`);
        result = result.replace(fullTag, newTag);
        console.log(`[uploadPendingImages] Uploaded: ${key}`);
      } catch (err) {
        console.warn('Failed to upload pasted image during save:', err);
      }
    }
    return result;
  }, [handleUploadImageToS3]);

  // ── Save logic (shared by Save button and Ctrl+S) ──
  const saveTemplate = useCallback(async () => {
    if (!name.trim() || !category || isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      // Upload any pasted images that haven't been uploaded to S3 yet.
      // We get the raw HTML directly from the editor (before stripPresignedUrlsFromHtml)
      // to ensure we see the actual image src attributes.
      const rawEditorHtml = editorRef.current?.getHTML() ?? content;
      const contentWithUploadedImages = await uploadPendingImages(rawEditorHtml);
      const cleanContent = stripPresignedUrlsFromHtml(contentWithUploadedImages);

      await update({
        name: name.trim(),
        category,
        htmlContent: cleanContent,
      });

      setLastSavedAt(new Date());

      // Invalidate template caches
      await Promise.all([
        mutate((key: unknown) =>
          typeof key === 'string' && key.includes(`/templates/get/${templateId}`),
        ),
        mutate((key: unknown) =>
          typeof key === 'string' && key.includes('/templates/list'),
        ),
      ]);

      toast({
        title: 'Template saved',
        description: `"${name.trim()}" has been saved.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to save template',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      isSavingRef.current = false;
    }
  }, [name, category, content, update, mutate, templateId, toast]);

  // ── Ctrl+S / Cmd+S hotkey ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveTemplate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveTemplate]);

  const isDisabled = isUpdating || isLoadingTemplate || isResolvingImages || isImageUploading;

  if (isLoadingTemplate) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading template…
          </div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <p className="text-muted-foreground">Template not found</p>
          <Button variant="outline" onClick={() => router.push(`/organizations/${orgId}/templates`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Templates
          </Button>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Edit Template</h1>
              {template.currentVersion && (
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  v{template.currentVersion}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {lastSavedAt ? (
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-500" />
                  Saved {lastSavedAt.toLocaleTimeString()}
                </span>
              ) : template.updatedAt ? (
                `Last updated ${new Date(template.updatedAt).toLocaleDateString()}`
              ) : (
                'Press ⌘S to save'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Metadata + Save button — same width as editor column */}
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
              onClick={saveTemplate}
              disabled={isDisabled || !name.trim() || !category}
            >
              {isUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
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
          {isResolvingImages ? (
            <div className="min-h-[500px] flex items-center justify-center bg-muted rounded-md">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading template content…
              </div>
            </div>
          ) : (
            <div className="min-h-[500px]">
              <RichTextEditor
                key={templateId}
                value={content}
                onChange={setContent}
                disabled={isUpdating}
                minHeight="500px"
                onUploadImageToS3={handleUploadImageToS3}
                onGetDownloadUrl={handleGetDownloadUrl}
                onUploadingChange={setIsImageUploading}
                onEditorReady={(editor) => { editorRef.current = editor; }}
              />
            </div>
          )}
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
