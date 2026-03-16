'use client';

import { useCallback, useRef, useState } from 'react';
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
import { useCreateTemplate } from '@/lib/hooks/use-templates';
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

export default function CreateTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [isImageUploading, setIsImageUploading] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const { toast } = useToast();
  const { create, isCreating } = useCreateTemplate();
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

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

      await create({
        orgId,
        name: name.trim(),
        category,
        htmlContent: cleanContent,
      });

      toast({
        title: 'Template created',
        description: `"${name.trim()}" is ready to use.`
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
            <h1 className="text-2xl font-bold">Create Template</h1>
            <p className="text-muted-foreground">
              Create a reusable template for RFP document generation
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
            <Select value={category} onValueChange={setCategory} disabled={isDisabled}>
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
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : isImageUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading image…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Create Template
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
