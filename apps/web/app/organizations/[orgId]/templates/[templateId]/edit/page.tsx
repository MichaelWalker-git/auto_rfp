'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Save, X, ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { RichTextEditor, stripPresignedUrlsFromHtml } from '@/components/rfp-documents/rich-text-editor';
import { useUpdateTemplate, useTemplate } from '@/lib/hooks/use-templates';
import { usePresignUpload, usePresignDownload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import type { Editor } from '@tiptap/react';
import { MacroDocumentation } from '@/components/templates/MacroDocumentation';
import { MacroInsertionBar } from '@/components/templates/MacroInsertionBar';
import { TemplateStructureGuidance } from '@/components/templates/TemplateStructureGuidance';

const CATEGORIES = [
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
  const contentInitializedRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const { toast } = useToast();
  const { template, isLoading: isLoadingTemplate } = useTemplate(orgId, templateId);
  const { update, isUpdating } = useUpdateTemplate(orgId, templateId);
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  // Initialize metadata from template
  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [content, setContent] = useState('');
  const metadataInitializedRef = useRef(!!template);

  // Sync metadata when template loads for the first time
  useEffect(() => {
    if (!template || metadataInitializedRef.current) return;
    metadataInitializedRef.current = true;
    setName(template.name ?? '');
    setCategory(template.category ?? '');
  }, [template]);

  // Sync content and resolve s3key: placeholders
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    try {
      const cleanContent = stripPresignedUrlsFromHtml(content);

      await update({
        name: name.trim(),
        category,
        htmlContent: cleanContent,
      });

      toast({
        title: 'Template updated',
        description: `"${name.trim()}" has been saved.`
      });

      router.push(`/organizations/${orgId}/templates`);
    } catch (err) {
      toast({
        title: 'Failed to update template',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const isDisabled = isUpdating || isLoadingTemplate || isResolvingImages || isImageUploading;

  if (isLoadingTemplate) {
    return (
      <div className="container max-w-6xl mx-auto py-6 px-4">
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
      <div className="container max-w-6xl mx-auto py-6 px-4">
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
    <div className="container max-w-6xl mx-auto py-6 px-4">
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
          <div>
            <h1 className="text-2xl font-bold">Edit Template</h1>
            <p className="text-muted-foreground">
              Update template for RFP document generation
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Technical Proposal — DoD"
              disabled={isDisabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <Select key={`category-${category || 'empty'}`} value={category} onValueChange={setCategory} disabled={isDisabled}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Help Documentation */}
        <MacroDocumentation />

        {/* Macro Insertion */}
        <MacroInsertionBar onInsert={insertMacro} disabled={isDisabled} />

        {/* Template Structure Guidance */}
        <TemplateStructureGuidance />

        {/* Content Editor */}
        <div className="space-y-2">
          <Label>
            Template Content{' '}
            <span className="text-xs text-muted-foreground font-normal">
              (Click a variable button above to insert it at cursor position)
            </span>
          </Label>
          {isResolvingImages ? (
            <div className="min-h-[500px] flex items-center justify-center bg-gray-100 rounded-md">
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

        {/* Actions */}
        <Separator />
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/organizations/${orgId}/templates`)}
            disabled={isDisabled}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button type="submit" disabled={isDisabled || !name.trim() || !category}>
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : isImageUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading image…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
